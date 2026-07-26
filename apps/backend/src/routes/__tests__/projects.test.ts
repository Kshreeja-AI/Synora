import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { prisma } from '@synora/database';
import { createApp } from '../../app';
import { initConfig } from '../../config';

describe('projects routes (M5)', () => {
  let app: Express;
  const testEmails: string[] = [];
  const testWorkspaceIds: string[] = [];

  beforeAll(async () => {
    const config = await initConfig();
    app = createApp(config);
  });

  afterEach(async () => {
    if (testWorkspaceIds.length > 0) {
      await prisma.workspace.deleteMany({ where: { id: { in: testWorkspaceIds } } });
      testWorkspaceIds.length = 0;
    }
    if (testEmails.length > 0) {
      await prisma.user.deleteMany({ where: { email: { in: testEmails } } });
      testEmails.length = 0;
    }
  });

  function uniqueEmail(prefix: string): string {
    const email = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    testEmails.push(email);
    return email;
  }

  async function register(prefix: string) {
    const email = uniqueEmail(prefix);
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email, password: 'a-valid-password-123' });
    const data = res.body.data as { accessToken: string; user: { id: string } };
    return { accessToken: data.accessToken, userId: data.user.id, email };
  }

  async function createWorkspace(accessToken: string, name: string) {
    const res = await request(app)
      .post('/api/workspaces')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name });
    testWorkspaceIds.push(res.body.data.id);
    return res.body.data as { id: string };
  }

  describe('personal projects (no workspace)', () => {
    it('creates and lists a personal project', async () => {
      const user = await register('personal');

      const created = await request(app)
        .post('/api/projects')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ name: 'My Project' });
      expect(created.status).toBe(201);
      expect(created.body.data.workspaceId).toBeNull();

      const list = await request(app)
        .get('/api/projects')
        .set('Authorization', `Bearer ${user.accessToken}`);
      expect(list.body.data).toHaveLength(1);
    });

    it('returns 404 for a project owned by someone else', async () => {
      const owner = await register('personal-owner');
      const stranger = await register('personal-stranger');
      const created = await request(app)
        .post('/api/projects')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ name: 'Private Project' });

      const res = await request(app)
        .get(`/api/projects/${created.body.data.id}`)
        .set('Authorization', `Bearer ${stranger.accessToken}`);
      expect(res.status).toBe(404);
    });
  });

  describe('workspace projects', () => {
    it('lets an EDITOR create a workspace project', async () => {
      const owner = await register('editor-owner');
      const editor = await register('editor-user');
      const workspace = await createWorkspace(owner.accessToken, 'Editor Co');
      await prisma.workspaceMember.create({
        data: { workspaceId: workspace.id, userId: editor.userId, role: 'EDITOR' },
      });

      const res = await request(app)
        .post('/api/projects')
        .set('Authorization', `Bearer ${editor.accessToken}`)
        .send({ name: 'Shared Project', workspaceId: workspace.id });

      expect(res.status).toBe(201);
      expect(res.body.data.workspaceId).toBe(workspace.id);
    });

    it('returns 403 when a VIEWER tries to create a workspace project', async () => {
      const owner = await register('viewer-owner');
      const viewer = await register('viewer-user');
      const workspace = await createWorkspace(owner.accessToken, 'Viewer Co');
      await prisma.workspaceMember.create({
        data: { workspaceId: workspace.id, userId: viewer.userId, role: 'VIEWER' },
      });

      const res = await request(app)
        .post('/api/projects')
        .set('Authorization', `Bearer ${viewer.accessToken}`)
        .send({ name: 'Should Fail', workspaceId: workspace.id });

      expect(res.status).toBe(403);
    });

    it('returns 404 when creating a project in a workspace the caller does not belong to', async () => {
      const owner = await register('notmember-owner');
      const stranger = await register('notmember-stranger');
      const workspace = await createWorkspace(owner.accessToken, 'Not Member Co');

      const res = await request(app)
        .post('/api/projects')
        .set('Authorization', `Bearer ${stranger.accessToken}`)
        .send({ name: 'Should 404', workspaceId: workspace.id });

      expect(res.status).toBe(404);
    });

    it('lists only projects for the given workspace', async () => {
      const owner = await register('list-owner');
      const workspace = await createWorkspace(owner.accessToken, 'List Projects Co');
      await request(app)
        .post('/api/projects')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ name: 'In Workspace', workspaceId: workspace.id });
      await request(app)
        .post('/api/projects')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ name: 'Personal Only' });

      const res = await request(app)
        .get(`/api/projects?workspaceId=${workspace.id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe('In Workspace');
    });

    it('lets any member view a workspace project, and any member with permission update/delete it', async () => {
      const owner = await register('rw-owner');
      const member = await register('rw-member');
      const workspace = await createWorkspace(owner.accessToken, 'RW Co');
      await prisma.workspaceMember.create({
        data: { workspaceId: workspace.id, userId: member.userId, role: 'MEMBER' },
      });
      const created = await request(app)
        .post('/api/projects')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ name: 'Viewable', workspaceId: workspace.id });

      const viewed = await request(app)
        .get(`/api/projects/${created.body.data.id}`)
        .set('Authorization', `Bearer ${member.accessToken}`);
      expect(viewed.status).toBe(200);

      const updateByMember = await request(app)
        .patch(`/api/projects/${created.body.data.id}`)
        .set('Authorization', `Bearer ${member.accessToken}`)
        .send({ name: 'Renamed By Member' });
      expect(updateByMember.status).toBe(403);

      const updateByOwner = await request(app)
        .patch(`/api/projects/${created.body.data.id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ name: 'Renamed By Owner' });
      expect(updateByOwner.status).toBe(200);

      const deleted = await request(app)
        .delete(`/api/projects/${created.body.data.id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(deleted.status).toBe(200);
    });
  });
});
