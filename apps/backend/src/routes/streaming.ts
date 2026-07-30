/**
 * Server-Sent Events (SSE) streaming endpoint
 */

import { Router, Request, Response } from 'express';
import { prisma } from '@synora/database';
import { requireAuth } from '../middleware/auth';
import { requireMembership } from '../services/checks';
import { requirePermission } from '../services/permissions';
import { logger } from '../utils/logger';
import { Redis } from 'ioredis';

const router = Router();
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

/**
 * GET /api/conversations/:conversationId/stream
 * Subscribe to message generation stream
 */
router.get(
  '/api/conversations/:conversationId/stream',
  requireAuth,
  async (req: Request, res: Response) => {
    const { conversationId } = req.params;
    const { messageId, workspaceId } = req.query;

    try {
      if (!messageId || typeof messageId !== 'string') {
        return res.status(400).json({ error: 'messageId required' });
      }

      if (!workspaceId || typeof workspaceId !== 'string') {
        return res.status(400).json({ error: 'workspaceId required' });
      }

      const membership = await requireMembership(req.user!.id, workspaceId);
      requirePermission(membership.role, 'message:read');

      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId }
      });

      if (!conversation || conversation.workspaceId !== workspaceId) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      const message = await prisma.message.findUnique({
        where: { id: messageId as string }
      });

      if (!message || message.conversationId !== conversationId) {
        return res.status(404).json({ error: 'Message not found' });
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');

      logger.info('[Streaming] Connection opened', {
        conversationId,
        messageId,
        userId: req.user!.id
      });

      const job = await prisma.streamingJob.findFirst({
        where: { messageId: messageId as string }
      });

      if (!job) {
        res.write(`event: error\ndata: ${JSON.stringify({ code: 'JOB_NOT_FOUND', message: 'No job' })}\n\n`);
        res.end();
        return;
      }

      const subscriber = redis.duplicate();
      const streamChannel = `job:${job.id}:stream`;

      subscriber.subscribe(streamChannel, (err) => {
        if (err) {
          logger.error('[Streaming] Subscribe error', { error: err.message });
          res.write(`event: error\ndata: ${JSON.stringify({ code: 'SUBSCRIBE_ERROR', message: err.message })}\n\n`);
          res.end();
        }
      });

      subscriber.on('message', (channel, message) => {
        try {
          const event = JSON.parse(message);
          res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`);
        } catch (err) {
          logger.error('[Streaming] Parse error', { error: err });
        }
      });

      const heartbeatInterval = setInterval(() => {
        res.write(`event: heartbeat\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);
      }, 30000);

      req.on('close', () => {
        clearInterval(heartbeatInterval);
        subscriber.unsubscribe();
        subscriber.disconnect();
        logger.info('[Streaming] Connection closed', { conversationId, messageId });
      });

      res.on('error', (err) => {
        logger.error('[Streaming] Response error', { error: err.message });
        clearInterval(heartbeatInterval);
        subscriber.unsubscribe();
        subscriber.disconnect();
      });
    } catch (err: any) {
      logger.error('[Streaming] Error', { error: err.message });
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      }
    }
  }
);

/**
 * POST /api/conversations/:conversationId/stream/:jobId/cancel
 * Cancel an in-flight stream
 */
router.post(
  '/api/conversations/:conversationId/stream/:jobId/cancel',
  requireAuth,
  async (req: Request, res: Response) => {
    const { conversationId, jobId } = req.params;

    try {
      const job = await prisma.streamingJob.findUnique({
        where: { id: jobId }
      });

      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }

      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId }
      });

      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      const membership = await requireMembership(req.user!.id, conversation.workspaceId);
      requirePermission(membership.role, 'message:manage');

      await prisma.streamingJob.update({
        where: { id: jobId },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date()
        }
      });

      await redis.publish(
        `job:${jobId}:control`,
        JSON.stringify({
          action: 'cancel',
          timestamp: new Date().toISOString()
        })
      );

      logger.info('[Streaming] Cancellation requested', {
        jobId,
        conversationId,
        userId: req.user!.id
      });

      res.json({ success: true, jobId });
    } catch (err: any) {
      logger.error('[Cancel] Error', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
