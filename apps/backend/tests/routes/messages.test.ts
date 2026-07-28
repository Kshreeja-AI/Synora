import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { initializeApp } from '../../src/index';
import { prisma } from '@synora/database';
import { MessageRole } from '@prisma/client';

describe('Messages Routes', () => {
  let app: any;
  let workspaceId: string;
  let userId: string;
  let conversationId: string;
  let token: string;

  beforeEach(async () => {
    const { app: expressApp } = await initializeApp();
    app = expressApp;

    // Create test user and workspace
    const user = await prisma.user.create({
      data: {
        email: `test-${Date.now()}@example.com`,
        name: 'Test User',
      },
    });
    userId = user.id;

    const workspace = await prisma.workspace.create({
      data: {
        name: 'Test Workspace',
        slug: `test-workspace-${Date.now()}`,
      },
    });
    workspaceId = workspace.id;

    await prisma.workspaceMember.create({
      data: {
        userId,
        workspaceId,
        role: 'OWNER',
      },
    });

    const conversation = await prisma.conversation.create({
      data: {
        workspaceId,
        title: 'Test Conversation',
        provider: 'anthropic',
        model: 'claude-3-sonnet',
      },
    });
    conversationId = conversation.id;

    // Generate JWT token
    const jwt = require('jsonwebtoken');
    token = jwt.sign({ userId, workspaceId }, process.env.JWT_SECRET || 'test-secret', {
      expiresIn: '24h',
    });
  });

  afterEach(async () => {
    await prisma.message.deleteMany({ where: { conversationId } });
    await prisma.conversation.deleteMany({ where: { id: conversationId } });
    await prisma.workspaceMember.deleteMany({ where: { workspaceId } });
    await prisma.workspace.delete({ where: { id: workspaceId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  describe('POST /api/workspaces/:workspaceId/conversations/:conversationId/messages', () => {
    it('should create a user message', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          content: 'Hello, Claude!',
          role: MessageRole.USER,
        });

      expect(response.status).toBe(201);
      expect(response.body.data.content).toBe('Hello, Claude!');
      expect(response.body.data.role).toBe(MessageRole.USER);
    });

    it('should create an assistant message', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          content: 'Hello! How can I help?',
          role: MessageRole.ASSISTANT,
        });

      expect(response.status).toBe(201);
      expect(response.body.data.role).toBe(MessageRole.ASSISTANT);
    });
  });

  describe('GET /api/workspaces/:workspaceId/conversations/:conversationId/messages', () => {
    beforeEach(async () => {
      await prisma.message.create({
        data: {
          conversationId,
          content: 'First message',
          role: MessageRole.USER,
        },
      });
      await prisma.message.create({
        data: {
          conversationId,
          content: 'Second message',
          role: MessageRole.ASSISTANT,
        },
      });
    });

    it('should get conversation messages', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.data[0].content).toBe('First message');
    });

    it('should support pagination', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/conversations/${conversationId}/messages`)
        .query({ skip: 0, take: 1 })
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
    });
  });

  describe('GET /api/workspaces/:workspaceId/conversations/:conversationId/stream', () => {
    let messageId: string;

    beforeEach(async () => {
      const msg = await prisma.message.create({
        data: {
          conversationId,
          content: 'Pre-generated response',
          role: MessageRole.ASSISTANT,
        },
      });
      messageId = msg.id;
    });

    it('should stream message tokens', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/conversations/${conversationId}/stream`)
        .query({ messageId })
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('text/event-stream');
    });

    it('should return 400 without messageId', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/conversations/${conversationId}/stream`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(400);
    });
  });

  describe('PATCH /api/workspaces/:workspaceId/conversations/:conversationId/messages/:messageId', () => {
    let messageId: string;

    beforeEach(async () => {
      const msg = await prisma.message.create({
        data: {
          conversationId,
          content: 'Original content',
          role: MessageRole.USER,
        },
      });
      messageId = msg.id;
    });

    it('should update message', async () => {
      const response = await request(app)
        .patch(
          `/api/workspaces/${workspaceId}/conversations/${conversationId}/messages/${messageId}`
        )
        .set('Authorization', `Bearer ${token}`)
        .send({
          content: 'Updated content',
        });

      expect(response.status).toBe(200);
      expect(response.body.data.content).toBe('Updated content');
    });
  });

  describe('DELETE /api/workspaces/:workspaceId/conversations/:conversationId/messages/:messageId', () => {
    let messageId: string;

    beforeEach(async () => {
      const msg = await prisma.message.create({
        data: {
          conversationId,
          content: 'Message to delete',
          role: MessageRole.USER,
        },
      });
      messageId = msg.id;
    });

    it('should delete message', async () => {
      const response = await request(app)
        .delete(
          `/api/workspaces/${workspaceId}/conversations/${conversationId}/messages/${messageId}`
        )
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);

      const found = await prisma.message.findUnique({
        where: { id: messageId },
      });
      expect(found).toBeNull();
    });
  });

  describe('POST /api/workspaces/:workspaceId/conversations/:conversationId/messages/:messageId/attachments', () => {
    let messageId: string;

    beforeEach(async () => {
      const msg = await prisma.message.create({
        data: {
          conversationId,
          content: 'Message with attachment',
          role: MessageRole.USER,
        },
      });
      messageId = msg.id;
    });

    it('should add attachment to message', async () => {
      const response = await request(app)
        .post(
          `/api/workspaces/${workspaceId}/conversations/${conversationId}/messages/${messageId}/attachments`
        )
        .set('Authorization', `Bearer ${token}`)
        .send({
          url: 'https://example.com/file.pdf',
          mimeType: 'application/pdf',
          name: 'document.pdf',
          size: 1024,
        });

      expect(response.status).toBe(201);
      expect(response.body.data.name).toBe('document.pdf');
    });
  });
});
