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

  describe('personal projects (no workspace)', () => {
    it('creates and lists a personal project', async () => {
      const user = await register('personal');

      const created = await request(app)
        .post('/api/projects')
        .set('Cookie', user.accessToken)
        .send({ name: 'My Project' });
      expect(created.status).toBe(201);
      expect(created.body.data.workspaceId).toBeNull();

      const list = await request(app)
        .get('/api/projects')
        .set('Cookie', user.accessToken);
      expect(list.body.data).toHaveLength(1);
    });

    it('returns 404 for a project owned by someone else', async () => {
      const owner = await register('personal-owner');
      const stranger = await register('personal-stranger');
      const created = await request(app)
        .post('/api/projects')
        .set('Cookie', owner.accessToken)
        .send({ name: 'Private Project' });

      const res = await request(app)
        .get(`/api/projects/${created.body.data.id}`)
        .set('Cookie', stranger.accessToken);
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
        .set('Cookie', editor.accessToken)
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
        .set('Cookie', viewer.accessToken)
        .send({ name: 'Should Fail', workspaceId: workspace.id });

      expect(res.status).toBe(403);
    });

    it('returns 404 when creating a project in a workspace the caller does not belong to', async () => {
      const owner = await register('notmember-owner');
      const stranger = await register('notmember-stranger');
      const workspace = await createWorkspace(owner.accessToken, 'Not Member Co');

      const res = await request(app)
        .post('/api/projects')
        .set('Cookie', stranger.accessToken)
        .send({ name: 'Should 404', workspaceId: workspace.id });

      expect(res.status).toBe(404);
    });

    it('lists only projects for the given workspace', async () => {
      const owner = await register('list-owner');
      const workspace = await createWorkspace(owner.accessToken, 'List Projects Co');
      await request(app)
        .post('/api/projects')
        .set('Cookie', owner.accessToken)
        .send({ name: 'In Workspace', workspaceId: workspace.id });
      await request(app)
        .post('/api/projects')
        .set('Cookie', owner.accessToken)
        .send({ name: 'Personal Only' });

      const res = await request(app)
        .get(`/api/projects?workspaceId=${workspace.id}`)
        .set('Cookie', owner.accessToken);

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
        .set('Cookie', owner.accessToken)
        .send({ name: 'Viewable', workspaceId: workspace.id });

      const viewed = await request(app)
        .get(`/api/projects/${created.body.data.id}`)
        .set('Cookie', member.accessToken);
      expect(viewed.status).toBe(200);

      const updateByMember = await request(app)
        .patch(`/api/projects/${created.body.data.id}`)
        .set('Cookie', member.accessToken)
        .send({ name: 'Renamed By Member' });
      // requirePermission() deliberately returns 404, not 403, for a
      // permission-denied request -- it never reveals resource existence
      // to a caller who isn't allowed to touch it (see its docstring).
      expect(updateByMember.status).toBe(404);

      const updateByOwner = await request(app)
        .patch(`/api/projects/${created.body.data.id}`)
        .set('Cookie', owner.accessToken)
        .send({ name: 'Renamed By Owner' });
      expect(updateByOwner.status).toBe(200);

      const deleted = await request(app)
        .delete(`/api/projects/${created.body.data.id}`)
        .set('Cookie', owner.accessToken);
      expect(deleted.status).toBe(200);
    });
  });

  /**
   * A project as the work inside it.
   *
   * Before this, a project could hold files and generated media and
   * nothing else — the conversations where the thinking happened lived
   * somewhere else entirely, so opening a project told you what had been
   * produced but never how, or what was still unfinished. These
   * assertions are about that: the work gathers, the chronology is real,
   * and filing cannot reach across workspaces.
   */
  describe('the project workspace view', () => {
    async function makeProject(cookie: string, workspaceId: string, body: object = {}) {
      const res = await request(app)
        .post('/api/projects')
        .set('Cookie', cookie)
        .send({ name: 'Market research', workspaceId, ...body });
      return res.body.data as { id: string; goal: string | null };
    }

    async function makeConversation(cookie: string, workspaceId: string, title: string) {
      const res = await request(app)
        .post(`/api/workspaces/${workspaceId}/conversations`)
        .set('Cookie', cookie)
        .send({ title, provider: 'anthropic', model: 'claude-sonnet-5' });
      return res.body.data as { id: string };
    }

    it('carries a goal, so a project can say what "done" looks like', async () => {
      const user = await register('proj-goal');
      const ws = await createWorkspace(user.accessToken, 'Goal Co');

      const project = await makeProject(user.accessToken, ws.id, {
        goal: 'Decide whether to enter the German market by March.',
      });
      // A description says what the project IS; a goal says what finishing
      // it would mean, which is the thing progress can be read against.
      expect(project.goal).toBe('Decide whether to enter the German market by March.');

      const view = await request(app)
        .get(`/api/projects/${project.id}/workspace`)
        .set('Cookie', user.accessToken);
      expect(view.status).toBe(200);
      expect(view.body.data.project.goal).toContain('German market');
    });

    it('gathers the work — a filed conversation appears in the project', async () => {
      const user = await register('proj-gather');
      const ws = await createWorkspace(user.accessToken, 'Gather Co');
      const project = await makeProject(user.accessToken, ws.id);
      const conversation = await makeConversation(user.accessToken, ws.id, 'Competitor pricing');

      const filed = await request(app)
        .patch(`/api/workspaces/${ws.id}/conversations/${conversation.id}`)
        .set('Cookie', user.accessToken)
        .send({ projectId: project.id });
      expect(filed.status).toBe(200);

      const view = await request(app)
        .get(`/api/projects/${project.id}/workspace`)
        .set('Cookie', user.accessToken);
      expect(view.body.data.counts.conversation).toBe(1);
      expect(
        (view.body.data.timeline as { title: string; kind: string }[]).some(
          (e) => e.kind === 'conversation' && e.title === 'Competitor pricing',
        ),
      ).toBe(true);
      // The "continue where I left off" answer, named once so every
      // surface agrees what continuing means.
      expect(view.body.data.resumeConversationId).toBe(conversation.id);
    });

    it('takes a conversation back out again when filed to null', async () => {
      const user = await register('proj-unfile');
      const ws = await createWorkspace(user.accessToken, 'Unfile Co');
      const project = await makeProject(user.accessToken, ws.id);
      const conversation = await makeConversation(user.accessToken, ws.id, 'Stray thought');

      await request(app)
        .patch(`/api/workspaces/${ws.id}/conversations/${conversation.id}`)
        .set('Cookie', user.accessToken)
        .send({ projectId: project.id });
      await request(app)
        .patch(`/api/workspaces/${ws.id}/conversations/${conversation.id}`)
        .set('Cookie', user.accessToken)
        .send({ projectId: null });

      const view = await request(app)
        .get(`/api/projects/${project.id}/workspace`)
        .set('Cookie', user.accessToken);
      // Explicit null means "take it out"; omitting the field would have
      // left it where it was.
      expect(view.body.data.counts.conversation).toBe(0);
      expect(view.body.data.resumeConversationId).toBeNull();
    });

    it('refuses to file a conversation into another workspace\'s project', async () => {
      const owner = await register('proj-mine');
      const stranger = await register('proj-theirs');
      const ws = await createWorkspace(owner.accessToken, 'Mine Co');
      const theirWs = await createWorkspace(stranger.accessToken, 'Theirs Co');
      const theirProject = await makeProject(stranger.accessToken, theirWs.id);
      const conversation = await makeConversation(owner.accessToken, ws.id, 'Mine');

      const filed = await request(app)
        .patch(`/api/workspaces/${ws.id}/conversations/${conversation.id}`)
        .set('Cookie', owner.accessToken)
        .send({ projectId: theirProject.id });

      // 404, not 403: an accept/reject answer that distinguished them
      // would reveal which project ids exist elsewhere.
      expect(filed.status).toBe(404);
    });

    it('hides the project workspace view from another workspace', async () => {
      const owner = await register('proj-view-mine');
      const stranger = await register('proj-view-theirs');
      const ws = await createWorkspace(owner.accessToken, 'View Co');
      const project = await makeProject(owner.accessToken, ws.id);

      expect(
        (await request(app).get(`/api/projects/${project.id}/workspace`)).status,
      ).toBe(401);
      expect(
        (
          await request(app)
            .get(`/api/projects/${project.id}/workspace`)
            .set('Cookie', stranger.accessToken)
        ).status,
      ).toBe(404);
    });

    it('turns a conversation into a project in one action', async () => {
      const user = await register('proj-promote');
      const ws = await createWorkspace(user.accessToken, 'Promote Co');
      const conversation = await makeConversation(
        user.accessToken,
        ws.id,
        'Should we enter Germany?',
      );

      const promoted = await request(app)
        .post(`/api/workspaces/${ws.id}/conversations/${conversation.id}/project`)
        .set('Cookie', user.accessToken)
        .send({});

      expect(promoted.status).toBe(201);
      // The name comes from the conversation, because it already has one
      // the person chose — a dialog would ask a question whose answer is
      // known.
      expect(promoted.body.data.name).toBe('Should we enter Germany?');

      const view = await request(app)
        .get(`/api/projects/${promoted.body.data.projectId}/workspace`)
        .set('Cookie', user.accessToken);
      // Created AND filed: the two halves of one intention.
      expect(view.body.data.counts.conversation).toBe(1);
      expect(view.body.data.resumeConversationId).toBe(conversation.id);
    });

    it('refuses to promote a conversation that is already in a project', async () => {
      const user = await register('proj-promote-twice');
      const ws = await createWorkspace(user.accessToken, 'Twice Co');
      const conversation = await makeConversation(user.accessToken, ws.id, 'Already filed');

      await request(app)
        .post(`/api/workspaces/${ws.id}/conversations/${conversation.id}/project`)
        .set('Cookie', user.accessToken)
        .send({});
      const again = await request(app)
        .post(`/api/workspaces/${ws.id}/conversations/${conversation.id}/project`)
        .set('Cookie', user.accessToken)
        .send({});

      // Otherwise a second press would silently strand the first project,
      // empty, with the conversation moved out of it.
      expect(again.status).toBe(400);
      expect(JSON.stringify(again.body)).toMatch(/already in a project/);
    });

    it('will not let promoting be a way around the create-project permission', async () => {
      const owner = await register('proj-promote-owner');
      const viewer = await register('proj-promote-viewer');
      const ws = await createWorkspace(owner.accessToken, 'Perm Co');
      await prisma.workspaceMember.create({
        data: { workspaceId: ws.id, userId: viewer.userId, role: 'VIEWER' },
      });
      const conversation = await makeConversation(owner.accessToken, ws.id, 'Theirs');

      const promoted = await request(app)
        .post(`/api/workspaces/${ws.id}/conversations/${conversation.id}/project`)
        .set('Cookie', viewer.accessToken)
        .send({});

      // A VIEWER cannot create a project directly; promoting must respect
      // the same control rather than route around it.
      expect([403, 404]).toContain(promoted.status);
    });

    it('gathers a canvas into the project alongside the conversations', async () => {
      const user = await register('proj-canvas');
      const ws = await createWorkspace(user.accessToken, 'Canvas Proj Co');
      const project = await makeProject(user.accessToken, ws.id);

      const canvas = (
        await request(app)
          .post(`/api/workspaces/${ws.id}/canvases`)
          .set('Cookie', user.accessToken)
          .send({ title: 'Market map' })
      ).body.data as { id: string };

      const filed = await request(app)
        .patch(`/api/workspaces/${ws.id}/canvases/${canvas.id}`)
        .set('Cookie', user.accessToken)
        .send({ projectId: project.id });
      expect(filed.status).toBe(200);

      const view = await request(app)
        .get(`/api/projects/${project.id}/workspace`)
        .set('Cookie', user.accessToken);
      // A canvas is where arranging happens; a project holding the
      // conversations but not the canvas would still be missing part of
      // the work.
      expect(view.body.data.counts.canvas).toBe(1);
      expect(
        (view.body.data.timeline as { kind: string; title: string }[]).some(
          (e) => e.kind === 'canvas' && e.title === 'Market map',
        ),
      ).toBe(true);
    });

    it('refuses to file a canvas into another workspace\'s project', async () => {
      const owner = await register('proj-canvas-mine');
      const stranger = await register('proj-canvas-theirs');
      const ws = await createWorkspace(owner.accessToken, 'Canvas Mine Co');
      const theirWs = await createWorkspace(stranger.accessToken, 'Canvas Theirs Co');
      const theirProject = await makeProject(stranger.accessToken, theirWs.id);
      const canvas = (
        await request(app)
          .post(`/api/workspaces/${ws.id}/canvases`)
          .set('Cookie', owner.accessToken)
          .send({ title: 'Mine' })
      ).body.data as { id: string };

      const filed = await request(app)
        .patch(`/api/workspaces/${ws.id}/canvases/${canvas.id}`)
        .set('Cookie', owner.accessToken)
        .send({ projectId: theirProject.id });

      expect(filed.status).toBe(404);
    });

    it('takes a canvas back out again when filed to null', async () => {
      const user = await register('proj-canvas-unfile');
      const ws = await createWorkspace(user.accessToken, 'Canvas Unfile Co');
      const project = await makeProject(user.accessToken, ws.id);
      const canvas = (
        await request(app)
          .post(`/api/workspaces/${ws.id}/canvases`)
          .set('Cookie', user.accessToken)
          .send({ title: 'Stray' })
      ).body.data as { id: string };

      await request(app)
        .patch(`/api/workspaces/${ws.id}/canvases/${canvas.id}`)
        .set('Cookie', user.accessToken)
        .send({ projectId: project.id });
      const removed = await request(app)
        .patch(`/api/workspaces/${ws.id}/canvases/${canvas.id}`)
        .set('Cookie', user.accessToken)
        .send({ projectId: null });
      expect(removed.body.data.projectId).toBeUndefined();

      const view = await request(app)
        .get(`/api/projects/${project.id}/workspace`)
        .set('Cookie', user.accessToken);
      expect(view.body.data.counts.canvas).toBe(0);
    });

    it('renames a canvas without unfiling it', async () => {
      const user = await register('proj-canvas-rename');
      const ws = await createWorkspace(user.accessToken, 'Canvas Rename Co');
      const project = await makeProject(user.accessToken, ws.id);
      const canvas = (
        await request(app)
          .post(`/api/workspaces/${ws.id}/canvases`)
          .set('Cookie', user.accessToken)
          .send({ title: 'Before' })
      ).body.data as { id: string };
      await request(app)
        .patch(`/api/workspaces/${ws.id}/canvases/${canvas.id}`)
        .set('Cookie', user.accessToken)
        .send({ projectId: project.id });

      const renamed = await request(app)
        .patch(`/api/workspaces/${ws.id}/canvases/${canvas.id}`)
        .set('Cookie', user.accessToken)
        .send({ title: 'After' });

      // An omitted projectId means "leave it alone" — otherwise every
      // rename would quietly evict the canvas from its project.
      expect(renamed.body.data.title).toBe('After');
      expect(renamed.body.data.projectId).toBe(project.id);
    });

    async function makeAgent(cookie: string, workspaceId: string, name: string) {
      const res = await request(app)
        .post(`/api/workspaces/${workspaceId}/agents`)
        .set('Cookie', cookie)
        .send({ name, instructions: 'Do the task carefully.' });
      return res.body.data as { id: string };
    }

    async function startAgentRun(
      cookie: string,
      workspaceId: string,
      agentId: string,
      body: object,
    ) {
      return request(app)
        .post(`/api/workspaces/${workspaceId}/agents/${agentId}/runs`)
        .set('Cookie', cookie)
        .send(body);
    }

    it('gathers an agent run into the project alongside the conversations', async () => {
      const user = await register('proj-run');
      const ws = await createWorkspace(user.accessToken, 'Run Proj Co');
      const project = await makeProject(user.accessToken, ws.id);
      const agent = await makeAgent(user.accessToken, ws.id, 'Researcher');

      const started = await startAgentRun(user.accessToken, ws.id, agent.id, {
        task: 'Summarise the competitive landscape',
        projectId: project.id,
      });
      expect(started.status).toBe(201);
      expect(started.body.data.run.projectId).toBe(project.id);

      const view = await request(app)
        .get(`/api/projects/${project.id}/workspace`)
        .set('Cookie', user.accessToken);
      // A run is where the AI actually did something as part of this
      // project's work — a project holding conversations and documents
      // but not what an agent did in service of them would still be
      // missing part of the picture.
      expect(view.body.data.counts.agentRun).toBe(1);
      const entry = (
        view.body.data.timeline as { kind: string; title: string; detail?: string }[]
      ).find((e) => e.kind === 'agentRun');
      expect(entry?.title).toBe('Summarise the competitive landscape');
      expect(entry?.detail).toContain('Researcher');
    });

    it("refuses to file an agent run into another workspace's project", async () => {
      const owner = await register('proj-run-mine');
      const stranger = await register('proj-run-theirs');
      const ws = await createWorkspace(owner.accessToken, 'Run Mine Co');
      const theirWs = await createWorkspace(stranger.accessToken, 'Run Theirs Co');
      const theirProject = await makeProject(stranger.accessToken, theirWs.id);
      const agent = await makeAgent(owner.accessToken, ws.id, 'Researcher');

      const started = await startAgentRun(owner.accessToken, ws.id, agent.id, {
        task: 'Do the thing',
        projectId: theirProject.id,
      });

      // 404, not 403 — the same rule as everywhere else a project id is
      // accepted as a claim of access rather than trusted as a bare
      // foreign key.
      expect(started.status).toBe(404);
    });

    it('404s a run filed against a project id that does not exist', async () => {
      const user = await register('proj-run-missing');
      const ws = await createWorkspace(user.accessToken, 'Run Missing Co');
      const agent = await makeAgent(user.accessToken, ws.id, 'Researcher');

      const started = await startAgentRun(user.accessToken, ws.id, agent.id, {
        task: 'Do the thing',
        projectId: 'proj_does_not_exist',
      });
      expect(started.status).toBe(404);
    });

    it('starts a run with no project just fine — filing is optional', async () => {
      const user = await register('proj-run-none');
      const ws = await createWorkspace(user.accessToken, 'Run None Co');
      const agent = await makeAgent(user.accessToken, ws.id, 'Researcher');

      const started = await startAgentRun(user.accessToken, ws.id, agent.id, {
        task: 'Do the thing',
      });
      expect(started.status).toBe(201);
      expect(started.body.data.run.projectId).toBeUndefined();
    });

    it('reports an empty project honestly rather than failing', async () => {
      const user = await register('proj-empty');
      const ws = await createWorkspace(user.accessToken, 'Empty Co');
      const project = await makeProject(user.accessToken, ws.id);

      const view = await request(app)
        .get(`/api/projects/${project.id}/workspace`)
        .set('Cookie', user.accessToken);

      expect(view.status).toBe(200);
      expect(view.body.data.timeline).toEqual([]);
      // Facts, not judgements: "nothing has happened yet" is for the
      // person to interpret.
      expect(view.body.data.lastActivityAt).toBeNull();
      expect(view.body.data.resumeConversationId).toBeNull();
    });
  });
});
