import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { prisma } from '@synora/database';
import { createApp } from '../../app';
import { initConfig } from '../../config';

describe('folders routes (M5)', () => {
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

  it('creates, lists, renames, and deletes a folder', async () => {
    const owner = await register('folder-owner');
    const workspace = await createWorkspace(owner.accessToken, 'Folder Co');

    const created = await request(app)
      .post(`/api/workspaces/${workspace.id}/folders`)
      .set('Cookie', owner.accessToken)
      .send({ name: 'Marketing' });
    expect(created.status).toBe(201);

    const listed = await request(app)
      .get(`/api/workspaces/${workspace.id}/folders`)
      .set('Cookie', owner.accessToken);
    // The list endpoint returns the folder array directly, matching the
    // web client (lib/api/folders.ts). It briefly returned `{ items }`
    // while this route was serving conversation folders by mistake.
    expect(listed.body.data).toHaveLength(1);

    const renamed = await request(app)
      .patch(`/api/workspaces/${workspace.id}/folders/${created.body.data.id}`)
      .set('Cookie', owner.accessToken)
      .send({ name: 'Growth' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data.name).toBe('Growth');

    const deleted = await request(app)
      .delete(`/api/workspaces/${workspace.id}/folders/${created.body.data.id}`)
      .set('Cookie', owner.accessToken);
    expect(deleted.status).toBe(200);
  });

  it('supports nested folders', async () => {
    const owner = await register('nested-owner');
    const workspace = await createWorkspace(owner.accessToken, 'Nested Co');

    const parent = await request(app)
      .post(`/api/workspaces/${workspace.id}/folders`)
      .set('Cookie', owner.accessToken)
      .send({ name: 'Parent' });

    const child = await request(app)
      .post(`/api/workspaces/${workspace.id}/folders`)
      .set('Cookie', owner.accessToken)
      .send({ name: 'Child', parentId: parent.body.data.id });

    expect(child.status).toBe(201);
    expect(child.body.data.parentId).toBe(parent.body.data.id);
  });

  it('returns 403 when a VIEWER tries to create a folder', async () => {
    const owner = await register('folderviewer-owner');
    const viewer = await register('folderviewer-viewer');
    const workspace = await createWorkspace(owner.accessToken, 'Viewer Folder Co');
    await prisma.workspaceMember.create({
      data: { workspaceId: workspace.id, userId: viewer.userId, role: 'VIEWER' },
    });

    const res = await request(app)
      .post(`/api/workspaces/${workspace.id}/folders`)
      .set('Cookie', viewer.accessToken)
      .send({ name: 'Should Fail' });

    expect(res.status).toBe(403);
  });

  it('returns 404 for a non-member', async () => {
    const owner = await register('foldernonmember-owner');
    const stranger = await register('foldernonmember-stranger');
    const workspace = await createWorkspace(owner.accessToken, 'Hidden Folder Co');

    const res = await request(app)
      .get(`/api/workspaces/${workspace.id}/folders`)
      .set('Cookie', stranger.accessToken);

    expect(res.status).toBe(404);
  });
});
