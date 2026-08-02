import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { prisma } from '@synora/database';
import { createApp } from '../../app';
import { initConfig } from '../../config';

describe('workspaces routes (M4)', () => {
  let app: Express;
  const testEmails: string[] = [];
  // Workspace has no direct FK to User (membership is via the join table),
  // so deleting test Users never cascades to the Workspace rows they
  // created — without tracking and deleting them here too, slugs like
  // 'acme-inc' accumulate across repeated local runs and break these
  // hardcoded-slug assertions on the second run.
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

  function cookieHeader(setCookieHeaders: string | string[] | undefined): string {
    const cookies = Array.isArray(setCookieHeaders) ? setCookieHeaders : setCookieHeaders ? [setCookieHeaders] : [];
    return cookies.map((c) => c.split(';')[0]).join('; ');
  }

  async function register(prefix: string) {
    const email = uniqueEmail(prefix);
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email, password: 'a-valid-password-123' });
    const data = res.body.data as { user: { id: string } };
    return { accessToken: cookieHeader(res.headers['set-cookie']), userId: data.user.id, email };
  }

  async function createWorkspace(accessToken: string, body: Record<string, unknown>) {
    const res = await request(app)
      .post('/api/workspaces')
      .set('Cookie', accessToken)
      .send(body);
    if (res.body?.data?.id) {
      testWorkspaceIds.push(res.body.data.id);
    }
    return res;
  }

  describe('POST /api/workspaces', () => {
    it('creates a workspace and makes the creator the OWNER', async () => {
      const user = await register('create');

      const res = await createWorkspace(user.accessToken, { name: 'Acme Inc' });

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        name: 'Acme Inc',
        slug: 'acme-inc',
        role: 'OWNER',
        memberCount: 1,
      });
    });

    it('generates a unique slug on name collision', async () => {
      const userA = await register('slug-a');
      const userB = await register('slug-b');

      const first = await createWorkspace(userA.accessToken, { name: 'Collision Co' });
      const second = await createWorkspace(userB.accessToken, { name: 'Collision Co' });

      expect(first.body.data.slug).toBe('collision-co');
      expect(second.body.data.slug).toBe('collision-co-2');
    });

    it('rejects an empty name', async () => {
      const user = await register('invalid');

      const res = await request(app)
        .post('/api/workspaces')
        .set('Cookie', user.accessToken)
        .send({ name: '' });

      expect(res.status).toBe(400);
    });

    it('requires authentication', async () => {
      const res = await request(app).post('/api/workspaces').send({ name: 'No Auth' });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/workspaces', () => {
    it('lists only the workspaces the caller is a member of', async () => {
      const userA = await register('list-a');
      const userB = await register('list-b');

      await createWorkspace(userA.accessToken, { name: 'Mine' });
      await createWorkspace(userB.accessToken, { name: 'Not Mine' });

      const res = await request(app)
        .get('/api/workspaces')
        .set('Cookie', userA.accessToken);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe('Mine');
    });
  });

  describe('GET /api/workspaces/:id', () => {
    it('returns the workspace for a member', async () => {
      const user = await register('get-member');
      const created = await createWorkspace(user.accessToken, { name: 'Visible' });

      const res = await request(app)
        .get(`/api/workspaces/${created.body.data.id}`)
        .set('Cookie', user.accessToken);

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Visible');
    });

    it('returns 404 (not 403) for a non-member', async () => {
      const owner = await register('get-owner');
      const stranger = await register('get-stranger');
      const created = await createWorkspace(owner.accessToken, { name: 'Private' });

      const res = await request(app)
        .get(`/api/workspaces/${created.body.data.id}`)
        .set('Cookie', stranger.accessToken);

      expect(res.status).toBe(404);
    });

    it('returns 404 for a nonexistent workspace id', async () => {
      const user = await register('get-missing');
      const res = await request(app)
        .get('/api/workspaces/does-not-exist')
        .set('Cookie', user.accessToken);

      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /api/workspaces/:id', () => {
    it('lets the owner rename the workspace', async () => {
      const owner = await register('patch-owner');
      const created = await createWorkspace(owner.accessToken, { name: 'Old Name' });

      const res = await request(app)
        .patch(`/api/workspaces/${created.body.data.id}`)
        .set('Cookie', owner.accessToken)
        .send({ name: 'New Name' });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('New Name');
      // Renaming never changes the slug once assigned.
      expect(res.body.data.slug).toBe('old-name');
    });

    it('returns 403 when a non-owner member tries to rename', async () => {
      const owner = await register('patch-forbidden-owner');
      const member = await register('patch-forbidden-member');
      const created = await createWorkspace(owner.accessToken, { name: 'Owned' });

      await prisma.workspaceMember.create({
        data: { userId: member.userId, workspaceId: created.body.data.id, role: 'MEMBER' },
      });

      const res = await request(app)
        .patch(`/api/workspaces/${created.body.data.id}`)
        .set('Cookie', member.accessToken)
        .send({ name: 'Hijacked' });

      expect(res.status).toBe(403);
    });

    it('returns 404 for a non-member', async () => {
      const owner = await register('patch-404-owner');
      const stranger = await register('patch-404-stranger');
      const created = await createWorkspace(owner.accessToken, { name: 'Untouchable' });

      const res = await request(app)
        .patch(`/api/workspaces/${created.body.data.id}`)
        .set('Cookie', stranger.accessToken)
        .send({ name: 'Nope' });

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/workspaces/:id/members', () => {
    it('lists members for a workspace the caller belongs to', async () => {
      const owner = await register('members-owner');
      const created = await createWorkspace(owner.accessToken, { name: 'Team' });

      const res = await request(app)
        .get(`/api/workspaces/${created.body.data.id}/members`)
        .set('Cookie', owner.accessToken);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0]).toMatchObject({ role: 'OWNER', user: { email: owner.email } });
    });

    it('returns 404 for a non-member', async () => {
      const owner = await register('members-404-owner');
      const stranger = await register('members-404-stranger');
      const created = await createWorkspace(owner.accessToken, { name: 'Hidden Team' });

      const res = await request(app)
        .get(`/api/workspaces/${created.body.data.id}/members`)
        .set('Cookie', stranger.accessToken);

      expect(res.status).toBe(404);
    });
  });

  describe('workspace creation notification', () => {
    it('creates a real in-app notification when a workspace is created', async () => {
      const user = await register('notif');
      const created = await createWorkspace(user.accessToken, { name: 'Notify Me' });

      expect(created.status).toBe(201);

      const res = await request(app)
        .get('/api/notifications')
        .set('Cookie', user.accessToken);

      expect(res.body.data.notifications).toHaveLength(1);
      expect(res.body.data.notifications[0]).toMatchObject({
        type: 'WORKSPACE',
        title: 'Workspace created',
      });
      expect(res.body.data.unreadCount).toBe(1);
    });
  });
});
