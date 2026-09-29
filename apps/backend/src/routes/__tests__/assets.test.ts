import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { prisma } from '@synora/database';
import { createApp } from '../../app';
import { initConfig } from '../../config';

describe('assets routes (M5)', () => {
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

  async function createWorkspace(accessToken: string, name: string) {
    const res = await request(app)
      .post('/api/workspaces')
      .set('Cookie', accessToken)
      .send({ name });
    testWorkspaceIds.push(res.body.data.id);
    return res.body.data as { id: string };
  }

  it('uploads, lists, and deletes an asset', async () => {
    const owner = await register('asset-owner');
    const workspace = await createWorkspace(owner.accessToken, 'Asset Co');

    const uploaded = await request(app)
      .post(`/api/workspaces/${workspace.id}/assets`)
      .set('Cookie', owner.accessToken)
      .attach('file', Buffer.from('hello world'), { filename: 'notes.txt', contentType: 'text/plain' });

    expect(uploaded.status).toBe(201);
    expect(uploaded.body.data).toMatchObject({ name: 'notes.txt', mimeType: 'text/plain', size: 11 });

    const listed = await request(app)
      .get(`/api/workspaces/${workspace.id}/assets`)
      .set('Cookie', owner.accessToken);
    expect(listed.body.data).toHaveLength(1);

    const deleted = await request(app)
      .delete(`/api/workspaces/${workspace.id}/assets/${uploaded.body.data.id}`)
      .set('Cookie', owner.accessToken);
    expect(deleted.status).toBe(200);

    const listedAfter = await request(app)
      .get(`/api/workspaces/${workspace.id}/assets`)
      .set('Cookie', owner.accessToken);
    expect(listedAfter.body.data).toHaveLength(0);
  });

  it('lets a MEMBER upload but not delete assets', async () => {
    const owner = await register('assetmember-owner');
    const member = await register('assetmember-member');
    const workspace = await createWorkspace(owner.accessToken, 'Member Asset Co');
    await prisma.workspaceMember.create({
      data: { workspaceId: workspace.id, userId: member.userId, role: 'MEMBER' },
    });

    const uploaded = await request(app)
      .post(`/api/workspaces/${workspace.id}/assets`)
      .set('Cookie', member.accessToken)
      .attach('file', Buffer.from('member file'), { filename: 'member.txt', contentType: 'text/plain' });
    expect(uploaded.status).toBe(201);

    const deleted = await request(app)
      .delete(`/api/workspaces/${workspace.id}/assets/${uploaded.body.data.id}`)
      .set('Cookie', member.accessToken);
    expect(deleted.status).toBe(403);
  });

  it('returns 403 when a VIEWER tries to upload', async () => {
    const owner = await register('assetviewer-owner');
    const viewer = await register('assetviewer-viewer');
    const workspace = await createWorkspace(owner.accessToken, 'Viewer Asset Co');
    await prisma.workspaceMember.create({
      data: { workspaceId: workspace.id, userId: viewer.userId, role: 'VIEWER' },
    });

    const res = await request(app)
      .post(`/api/workspaces/${workspace.id}/assets`)
      .set('Cookie', viewer.accessToken)
      .attach('file', Buffer.from('nope'), { filename: 'nope.txt', contentType: 'text/plain' });

    expect(res.status).toBe(403);
  });

  it('returns 400 when no file is provided', async () => {
    const owner = await register('assetnofile-owner');
    const workspace = await createWorkspace(owner.accessToken, 'No File Co');

    const res = await request(app)
      .post(`/api/workspaces/${workspace.id}/assets`)
      .set('Cookie', owner.accessToken);

    expect(res.status).toBe(400);
  });

  it('returns 404 for a non-member', async () => {
    const owner = await register('assetnonmember-owner');
    const stranger = await register('assetnonmember-stranger');
    const workspace = await createWorkspace(owner.accessToken, 'Hidden Asset Co');

    const res = await request(app)
      .get(`/api/workspaces/${workspace.id}/assets`)
      .set('Cookie', stranger.accessToken);

    expect(res.status).toBe(404);
  });
});
