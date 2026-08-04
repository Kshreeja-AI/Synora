import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { prisma } from '@synora/database';
import { createApp } from '../../app';
import { initConfig } from '../../config';
import { InMemoryKeyedStore } from '../../agents/agent-stores';
import { resetCanvases, setCanvasStore } from '../../canvas/canvas-store';
import { CANVAS_LIMITS, type CanvasDocument } from '../../canvas/types';

/**
 * Canvas HTTP surface.
 *
 * The assertions worth having here are the boundary ones: workspace
 * isolation, and that the store's specific validation messages reach the
 * caller as 400s rather than being flattened into "invalid block". A
 * person who placed a block off the surface is better served by being told
 * that than by a generic rejection.
 */
describe('canvas routes', () => {
  let app: Express;
  const testEmails: string[] = [];
  const testWorkspaceIds: string[] = [];

  beforeAll(async () => {
    const config = await initConfig();
    app = createApp(config);
  });

  beforeEach(() => {
    resetCanvases();
    setCanvasStore(new InMemoryKeyedStore<CanvasDocument>());
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

  function cookieHeader(setCookieHeaders: string | string[] | undefined): string {
    const cookies = Array.isArray(setCookieHeaders)
      ? setCookieHeaders
      : setCookieHeaders
        ? [setCookieHeaders]
        : [];
    return cookies.map((c) => c.split(';')[0]).join('; ');
  }

  async function register(prefix: string) {
    const email = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    testEmails.push(email);
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email, password: 'a-valid-password-123' });
    return { cookie: cookieHeader(res.headers['set-cookie']) };
  }

  async function createWorkspace(cookie: string, name: string) {
    const res = await request(app).post('/api/workspaces').set('Cookie', cookie).send({ name });
    testWorkspaceIds.push(res.body.data.id);
    return res.body.data as { id: string };
  }

  async function makeCanvas(cookie: string, workspaceId: string, title = 'Launch plan') {
    return request(app)
      .post(`/api/workspaces/${workspaceId}/canvases`)
      .set('Cookie', cookie)
      .send({ title });
  }

  it('creates an empty canvas', async () => {
    const owner = await register('canvas-owner');
    const ws = await createWorkspace(owner.cookie, 'Canvas Co');

    const res = await makeCanvas(owner.cookie, ws.id);
    expect(res.status).toBe(201);
    expect(res.body.data.blocks).toEqual([]);
    expect(res.body.data.archived).toBe(false);
  });

  it('requires authentication and hides other workspaces', async () => {
    const owner = await register('canvas-owner-2');
    const stranger = await register('canvas-stranger');
    const ws = await createWorkspace(owner.cookie, 'Private Co');
    const canvas = (await makeCanvas(owner.cookie, ws.id)).body.data;

    expect((await request(app).get(`/api/workspaces/${ws.id}/canvases`)).status).toBe(401);

    const strangerWs = await createWorkspace(stranger.cookie, 'Other Co');
    const cross = await request(app)
      .get(`/api/workspaces/${strangerWs.id}/canvases/${canvas.id}`)
      .set('Cookie', stranger.cookie);
    expect(cross.status).toBe(404);
  });

  it('adds, moves and removes a block', async () => {
    const owner = await register('canvas-blocks');
    const ws = await createWorkspace(owner.cookie, 'Canvas Co');
    const canvas = (await makeCanvas(owner.cookie, ws.id)).body.data;

    const added = await request(app)
      .post(`/api/workspaces/${ws.id}/canvases/${canvas.id}/blocks`)
      .set('Cookie', owner.cookie)
      .send({ kind: 'note', content: 'Remember the launch date', x: 10, y: 20 });
    expect(added.status).toBe(201);

    const moved = await request(app)
      .patch(`/api/workspaces/${ws.id}/canvases/${canvas.id}/blocks/${added.body.data.id}`)
      .set('Cookie', owner.cookie)
      .send({ x: 200, y: 300 });
    expect(moved.body.data.x).toBe(200);
    expect(moved.body.data.content).toBe('Remember the launch date');

    const removed = await request(app)
      .delete(`/api/workspaces/${ws.id}/canvases/${canvas.id}/blocks/${added.body.data.id}`)
      .set('Cookie', owner.cookie);
    expect(removed.status).toBe(200);

    const after = await request(app)
      .get(`/api/workspaces/${ws.id}/canvases/${canvas.id}`)
      .set('Cookie', owner.cookie);
    expect(after.body.data.blocks).toEqual([]);
  });

  it('tells the caller specifically what was wrong with a block', async () => {
    const owner = await register('canvas-bad-block');
    const ws = await createWorkspace(owner.cookie, 'Canvas Co');
    const canvas = (await makeCanvas(owner.cookie, ws.id)).body.data;

    const offSurface = await request(app)
      .post(`/api/workspaces/${ws.id}/canvases/${canvas.id}/blocks`)
      .set('Cookie', owner.cookie)
      .send({ kind: 'text', content: 'lost', x: CANVAS_LIMITS.maxCoordinate + 1, y: 0 });
    expect(offSurface.status).toBe(400);
    // Specific, not "invalid block": the caller can act on this.
    expect(JSON.stringify(offSurface.body)).toMatch(/cannot be found again/);

    const deadLink = await request(app)
      .post(`/api/workspaces/${ws.id}/canvases/${canvas.id}/blocks`)
      .set('Cookie', owner.cookie)
      .send({ kind: 'link', content: 'somewhere', x: 0, y: 0 });
    expect(deadLink.status).toBe(400);
    expect(JSON.stringify(deadLink.body)).toMatch(/must name what it points at/);
  });

  it('links a block to a run by id', async () => {
    const owner = await register('canvas-link');
    const ws = await createWorkspace(owner.cookie, 'Canvas Co');
    const canvas = (await makeCanvas(owner.cookie, ws.id)).body.data;

    const res = await request(app)
      .post(`/api/workspaces/${ws.id}/canvases/${canvas.id}/blocks`)
      .set('Cookie', owner.cookie)
      .send({ kind: 'link', content: 'Last night’s run', target: 'run', targetId: 'run_42', x: 0, y: 0 });

    expect(res.status).toBe(201);
    // Ids only — never a copied snapshot that could drift out of date.
    expect(res.body.data.targetId).toBe('run_42');
  });

  it('renames and archives without destroying anything', async () => {
    const owner = await register('canvas-archive');
    const ws = await createWorkspace(owner.cookie, 'Canvas Co');
    const canvas = (await makeCanvas(owner.cookie, ws.id)).body.data;

    const renamed = await request(app)
      .patch(`/api/workspaces/${ws.id}/canvases/${canvas.id}`)
      .set('Cookie', owner.cookie)
      .send({ title: 'Q4 plan' });
    expect(renamed.body.data.title).toBe('Q4 plan');

    await request(app)
      .delete(`/api/workspaces/${ws.id}/canvases/${canvas.id}`)
      .set('Cookie', owner.cookie);

    const listed = await request(app)
      .get(`/api/workspaces/${ws.id}/canvases`)
      .set('Cookie', owner.cookie);
    expect(listed.body.data).toHaveLength(0);

    const stillThere = await request(app)
      .get(`/api/workspaces/${ws.id}/canvases/${canvas.id}`)
      .set('Cookie', owner.cookie);
    expect(stillThere.status).toBe(200);
  });
});
