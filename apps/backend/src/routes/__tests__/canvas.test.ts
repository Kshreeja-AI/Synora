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

  describe('connections', () => {
    async function canvasWithTwoBlocks(cookie: string, workspaceId: string) {
      const canvas = (await makeCanvas(cookie, workspaceId)).body.data;
      const block = async (x: number) =>
        (
          await request(app)
            .post(`/api/workspaces/${workspaceId}/canvases/${canvas.id}/blocks`)
            .set('Cookie', cookie)
            .send({ kind: 'text', content: 'x', x, y: 0 })
        ).body.data;
      return { canvas, a: await block(0), b: await block(300) };
    }

    it('connects two blocks and shows the line on the canvas', async () => {
      const owner = await register('canvas-connect');
      const ws = await createWorkspace(owner.cookie, 'Canvas Co');
      const { canvas, a, b } = await canvasWithTwoBlocks(owner.cookie, ws.id);

      const res = await request(app)
        .post(`/api/workspaces/${ws.id}/canvases/${canvas.id}/connections`)
        .set('Cookie', owner.cookie)
        .send({ from: a.id, to: b.id, label: 'then' });

      expect(res.status).toBe(201);

      const read = await request(app)
        .get(`/api/workspaces/${ws.id}/canvases/${canvas.id}`)
        .set('Cookie', owner.cookie);
      expect(read.body.data.connections).toHaveLength(1);
      expect(read.body.data.connections[0].label).toBe('then');
    });

    it('refuses an endpoint that is not on the canvas, with a 400 that says why', async () => {
      const owner = await register('canvas-connect-bad');
      const ws = await createWorkspace(owner.cookie, 'Canvas Co');
      const { canvas, a } = await canvasWithTwoBlocks(owner.cookie, ws.id);

      const res = await request(app)
        .post(`/api/workspaces/${ws.id}/canvases/${canvas.id}/connections`)
        .set('Cookie', owner.cookie)
        .send({ from: a.id, to: 'block_nope' });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(/blocks that exist/);
    });

    it('deleting a block deletes the lines that touched it', async () => {
      const owner = await register('canvas-connect-cascade');
      const ws = await createWorkspace(owner.cookie, 'Canvas Co');
      const { canvas, a, b } = await canvasWithTwoBlocks(owner.cookie, ws.id);
      await request(app)
        .post(`/api/workspaces/${ws.id}/canvases/${canvas.id}/connections`)
        .set('Cookie', owner.cookie)
        .send({ from: a.id, to: b.id });

      await request(app)
        .delete(`/api/workspaces/${ws.id}/canvases/${canvas.id}/blocks/${b.id}`)
        .set('Cookie', owner.cookie);

      const read = await request(app)
        .get(`/api/workspaces/${ws.id}/canvases/${canvas.id}`)
        .set('Cookie', owner.cookie);
      // A line to a block that no longer exists is drawn from nothing to
      // nothing, so it goes with the block.
      expect(read.body.data.connections).toEqual([]);
    });

    it('disconnects, and answers 404 for a connection that is already gone', async () => {
      const owner = await register('canvas-disconnect');
      const ws = await createWorkspace(owner.cookie, 'Canvas Co');
      const { canvas, a, b } = await canvasWithTwoBlocks(owner.cookie, ws.id);
      const conn = (
        await request(app)
          .post(`/api/workspaces/${ws.id}/canvases/${canvas.id}/connections`)
          .set('Cookie', owner.cookie)
          .send({ from: a.id, to: b.id })
      ).body.data;

      const first = await request(app)
        .delete(`/api/workspaces/${ws.id}/canvases/${canvas.id}/connections/${conn.id}`)
        .set('Cookie', owner.cookie);
      expect(first.status).toBe(200);

      const second = await request(app)
        .delete(`/api/workspaces/${ws.id}/canvases/${canvas.id}/connections/${conn.id}`)
        .set('Cookie', owner.cookie);
      expect(second.status).toBe(404);
    });

    it('hides connections on another workspace\'s canvas', async () => {
      const owner = await register('canvas-conn-owner');
      const stranger = await register('canvas-conn-stranger');
      const ws = await createWorkspace(owner.cookie, 'Canvas Co');
      const { canvas, a, b } = await canvasWithTwoBlocks(owner.cookie, ws.id);
      const strangerWs = await createWorkspace(stranger.cookie, 'Other Co');

      const cross = await request(app)
        .post(`/api/workspaces/${strangerWs.id}/canvases/${canvas.id}/connections`)
        .set('Cookie', stranger.cookie)
        .send({ from: a.id, to: b.id });
      expect(cross.status).toBe(404);
    });
  });

  /**
   * Resolving what a link block points at.
   *
   * A block stores a bare id, and nothing stops someone typing an id
   * belonging to another workspace — so the assertion that matters most
   * here is that a foreign id resolves to `missing` rather than to
   * somebody else's title. Without that, a link block would be a way to
   * read other people's conversation names one id at a time.
   */
  describe('link resolution', () => {
    async function addLink(
      cookie: string,
      workspaceId: string,
      canvasId: string,
      target: string,
      targetId: string,
    ) {
      const res = await request(app)
        .post(`/api/workspaces/${workspaceId}/canvases/${canvasId}/blocks`)
        .set('Cookie', cookie)
        .send({ kind: 'link', content: 'a link', target, targetId, x: 0, y: 0 });
      return res.body.data as { id: string };
    }

    async function resolve(cookie: string, workspaceId: string, canvasId: string) {
      const res = await request(app)
        .get(`/api/workspaces/${workspaceId}/canvases/${canvasId}/links`)
        .set('Cookie', cookie);
      return res;
    }

    it('resolves a workflow link to its real name, read now rather than copied', async () => {
      const owner = await register('canvas-link-wf');
      const ws = await createWorkspace(owner.cookie, 'Canvas Co');
      const canvas = (await makeCanvas(owner.cookie, ws.id)).body.data;

      const workflow = (
        await request(app)
          .post(`/api/workspaces/${ws.id}/workflows`)
          .set('Cookie', owner.cookie)
          .send({
            name: 'Nightly report',
            steps: [{ id: 's1', kind: 'generate', description: 'step', input: 'summarise' }],
          })
      ).body.data;
      const block = await addLink(owner.cookie, ws.id, canvas.id, 'workflow', workflow.id);

      const res = await resolve(owner.cookie, ws.id, canvas.id);
      expect(res.status).toBe(200);
      const link = (res.body.data as { blockId: string; title?: string; detail?: string }[]).find(
        (l) => l.blockId === block.id,
      );
      // The name comes from the workflow, not from a copy taken when the
      // link was made — so renaming it cannot leave the canvas showing an
      // old name with nothing to say it is lying.
      expect(link?.title).toBe('Nightly report');
      expect(link?.detail).toContain('1 step');
    });

    it('reports a target that does not exist as missing, without saying why', async () => {
      const owner = await register('canvas-link-gone');
      const ws = await createWorkspace(owner.cookie, 'Canvas Co');
      const canvas = (await makeCanvas(owner.cookie, ws.id)).body.data;
      const block = await addLink(owner.cookie, ws.id, canvas.id, 'run', 'run_that_never_was');

      const res = await resolve(owner.cookie, ws.id, canvas.id);
      const link = (res.body.data as { blockId: string; missing?: boolean; title?: string }[]).find(
        (l) => l.blockId === block.id,
      );
      expect(link?.missing).toBe(true);
      expect(link?.title).toBeUndefined();
    });

    it('will not resolve another workspace\'s id, even into a bare title', async () => {
      const owner = await register('canvas-link-mine');
      const stranger = await register('canvas-link-theirs');
      const ws = await createWorkspace(owner.cookie, 'Canvas Co');
      const theirWs = await createWorkspace(stranger.cookie, 'Secret Co');
      const canvas = (await makeCanvas(owner.cookie, ws.id)).body.data;

      // A workflow that exists, but not here.
      const theirWorkflow = (
        await request(app)
          .post(`/api/workspaces/${theirWs.id}/workflows`)
          .set('Cookie', stranger.cookie)
          .send({
            name: 'Acquisition due diligence',
            steps: [{ id: 's1', kind: 'generate', description: 'step', input: 'summarise' }],
          })
      ).body.data;
      const block = await addLink(owner.cookie, ws.id, canvas.id, 'workflow', theirWorkflow.id);

      const res = await resolve(owner.cookie, ws.id, canvas.id);
      const link = (res.body.data as { blockId: string; missing?: boolean; title?: string }[]).find(
        (l) => l.blockId === block.id,
      );
      // The name of somebody else's workflow is exactly the thing a link
      // block must not become a way to read.
      expect(link?.missing).toBe(true);
      expect(JSON.stringify(res.body)).not.toContain('Acquisition due diligence');
    });

    it('returns nothing for a canvas with no link blocks, rather than failing', async () => {
      const owner = await register('canvas-link-none');
      const ws = await createWorkspace(owner.cookie, 'Canvas Co');
      const canvas = (await makeCanvas(owner.cookie, ws.id)).body.data;
      await request(app)
        .post(`/api/workspaces/${ws.id}/canvases/${canvas.id}/blocks`)
        .set('Cookie', owner.cookie)
        .send({ kind: 'note', content: 'just a note', x: 0, y: 0 });

      const res = await resolve(owner.cookie, ws.id, canvas.id);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it('guards the links path with auth and workspace access', async () => {
      const owner = await register('canvas-link-guard');
      const stranger = await register('canvas-link-guard-2');
      const ws = await createWorkspace(owner.cookie, 'Canvas Co');
      const canvas = (await makeCanvas(owner.cookie, ws.id)).body.data;

      expect(
        (await request(app).get(`/api/workspaces/${ws.id}/canvases/${canvas.id}/links`)).status,
      ).toBe(401);

      const theirWs = await createWorkspace(stranger.cookie, 'Other Co');
      // 404, not 403: the same discipline as every other canvas route.
      expect((await resolve(stranger.cookie, theirWs.id, canvas.id)).status).toBe(404);
    });
  });
});
