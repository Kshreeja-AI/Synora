import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { initializeApp } from '../../src/index';
import { prisma } from '@synora/database';

describe('Conversations Routes', () => {
  let app: any;
  let workspaceId: string;
  let userId: string;
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

    // Generate JWT token for auth
    const jwt = require('jsonwebtoken');
    token = jwt.sign({ userId, workspaceId }, process.env.JWT_SECRET || 'test-secret', {
      expiresIn: '24h',
    });
  });

  afterEach(async () => {
    await prisma.message.deleteMany({ where: { conversation: { workspaceId } } });
    await prisma.conversation.deleteMany({ where: { workspaceId } });
    await prisma.workspaceMember.deleteMany({ where: { workspaceId } });
    await prisma.workspace.delete({ where: { id: workspaceId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  describe('POST /api/workspaces/:workspaceId/conversations', () => {
    it('should create a conversation', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${workspaceId}/conversations`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'Test Conversation',
          provider: 'anthropic',
          model: 'claude-3-sonnet',
        });

      expect(response.status).toBe(201);
      expect(response.body.data.title).toBe('Test Conversation');
      expect(response.body.data.provider).toBe('anthropic');
    });
  });

  describe('GET /api/workspaces/:workspaceId/conversations', () => {
    beforeEach(async () => {
      await prisma.conversation.create({
        data: {
          workspaceId,
          title: 'First Conversation',
          provider: 'anthropic',
          model: 'claude-3-sonnet',
        },
      });
    });

    it('should list conversations', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/conversations`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data.conversations).toHaveLength(1);
      expect(response.body.data.conversations[0].title).toBe('First Conversation');
      expect(response.body.data.total).toBe(1);
    });
  });

  describe('GET /api/workspaces/:workspaceId/conversations/:conversationId', () => {
    let conversationId: string;

    beforeEach(async () => {
      const conv = await prisma.conversation.create({
        data: {
          workspaceId,
          title: 'Single Conversation',
          provider: 'anthropic',
          model: 'claude-3-sonnet',
        },
      });
      conversationId = conv.id;
    });

    it('should get single conversation', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${workspaceId}/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data.title).toBe('Single Conversation');
    });
  });

  describe('PATCH /api/workspaces/:workspaceId/conversations/:conversationId', () => {
    let conversationId: string;

    beforeEach(async () => {
      const conv = await prisma.conversation.create({
        data: {
          workspaceId,
          title: 'Original Title',
          provider: 'anthropic',
          model: 'claude-3-sonnet',
        },
      });
      conversationId = conv.id;
    });

    it('should update conversation', async () => {
      const response = await request(app)
        .patch(`/api/workspaces/${workspaceId}/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'Updated Title',
        });

      expect(response.status).toBe(200);
      expect(response.body.data.title).toBe('Updated Title');
    });
  });

  describe('DELETE /api/workspaces/:workspaceId/conversations/:conversationId', () => {
    let conversationId: string;

    beforeEach(async () => {
      const conv = await prisma.conversation.create({
        data: {
          workspaceId,
          title: 'To Delete',
          provider: 'anthropic',
          model: 'claude-3-sonnet',
        },
      });
      conversationId = conv.id;
    });

    it('should delete conversation (soft delete)', async () => {
      const response = await request(app)
        .delete(`/api/workspaces/${workspaceId}/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data.status).toBe('DELETED');

      const found = await prisma.conversation.findUnique({
        where: { id: conversationId },
      });
      expect(found).not.toBeNull();
      expect(found?.status).toBe('DELETED');
    });
  });
});
