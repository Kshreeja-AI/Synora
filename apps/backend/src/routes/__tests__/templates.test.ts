import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { prisma } from '@synora/database';
import { createApp } from '../../app';
import { initConfig } from '../../config';
import { resetAgents } from '../../agents/agent-registry';
import { resetRuns } from '../../agents/run-engine';
import {
  InMemoryKeyedStore,
  setAgentDefinitionStore,
  setAgentRunStore,
} from '../../agents/agent-stores';
import { resetWorkflows, setWorkflowStore } from '../../workflows/workflow-registry';
import {
  resetWorkspaceTemplates,
  setWorkspaceTemplateStore,
  type WorkspaceTemplate,
} from '../../agents/workspace-templates';
import { TEMPLATES } from '../../agents/templates';
import type { AgentDefinition, AgentRun } from '../../agents/types';
import type { WorkflowDefinition } from '../../workflows/types';

// No network: the test environment carries a placeholder provider key, and
// starting a run resolves a runtime for the tool runner and generator.
vi.mock('../../ai/resolver', () => ({
  resolveTextGenerationProvider: vi.fn(async () => {
    throw new Error('no provider configured (test)');
  }),
  resolveProvider: vi.fn(async () => {
    throw new Error('no provider configured (test)');
  }),
}));

/**
 * Template HTTP surface.
 *
 * The assertion that matters is that instantiating produces something
 * REAL: a definition the ordinary registry knows about, which the ordinary
 * run endpoint can actually execute. A template that produced a decorative
 * record would be a demo, and the whole point of shipping these is that
 * the blank page is the obstacle, not the machinery behind it.
 */
describe('template routes', () => {
  let app: Express;
  const testEmails: string[] = [];
  const testWorkspaceIds: string[] = [];

  beforeAll(async () => {
    const config = await initConfig();
    app = createApp(config);
  });

  beforeEach(() => {
    resetAgents();
    resetRuns();
    resetWorkflows();
    setAgentDefinitionStore(new InMemoryKeyedStore<AgentDefinition>());
    setAgentRunStore(new InMemoryKeyedStore<AgentRun>());
    setWorkflowStore(new InMemoryKeyedStore<WorkflowDefinition>());
    resetWorkspaceTemplates();
    setWorkspaceTemplateStore(new InMemoryKeyedStore<WorkspaceTemplate>());
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
    return { cookie: cookieHeader(res.headers['set-cookie']), userId: res.body.data.user.id as string };
  }

  async function createWorkspace(cookie: string, name: string) {
    const res = await request(app).post('/api/workspaces').set('Cookie', cookie).send({ name });
    testWorkspaceIds.push(res.body.data.id);
    return res.body.data as { id: string };
  }

  const agentTemplate = TEMPLATES.find((t) => t.kind === 'agent')!;
  const workflowTemplate = TEMPLATES.find((t) => t.kind === 'workflow')!;

  it('lists templates, filterable by kind', async () => {
    const owner = await register('tpl-list');
    const ws = await createWorkspace(owner.cookie, 'Tpl Co');

    const all = await request(app)
      .get(`/api/workspaces/${ws.id}/agent-templates`)
      .set('Cookie', owner.cookie);
    expect(all.status).toBe(200);
    expect(all.body.data.length).toBe(TEMPLATES.length);

    const agents = await request(app)
      .get(`/api/workspaces/${ws.id}/agent-templates?kind=agent`)
      .set('Cookie', owner.cookie);
    expect(agents.body.data.every((t: { kind: string }) => t.kind === 'agent')).toBe(true);
  });

  it('requires authentication', async () => {
    const owner = await register('tpl-auth');
    const ws = await createWorkspace(owner.cookie, 'Tpl Co');
    expect((await request(app).get(`/api/workspaces/${ws.id}/agent-templates`)).status).toBe(401);
  });

  it('instantiates an agent that the ordinary agent endpoints then see', async () => {
    const owner = await register('tpl-agent');
    const ws = await createWorkspace(owner.cookie, 'Tpl Co');

    const res = await request(app)
      .post(`/api/workspaces/${ws.id}/agent-templates/${agentTemplate.id}/instantiate`)
      .set('Cookie', owner.cookie)
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.data.kind).toBe('agent');
    expect(res.body.data.agent.instructions).toBe(agentTemplate.instructions);
    // Fail closed, and empty on purpose: a template cannot name a tool id
    // that may not exist in this workspace.
    expect(res.body.data.agent.allowedTools).toEqual([]);
    expect(res.body.data.agent.approvalPolicy).toBe('mutations');
    expect(res.body.data.agent.memoryAccess).toBe('none');

    // Not a decorative record: the normal listing endpoint sees it.
    const listed = await request(app)
      .get(`/api/workspaces/${ws.id}/agents`)
      .set('Cookie', owner.cookie);
    expect(listed.body.data.map((a: { id: string }) => a.id)).toContain(res.body.data.agent.id);
  });

  it('instantiates a workflow that actually runs', async () => {
    const owner = await register('tpl-workflow');
    const ws = await createWorkspace(owner.cookie, 'Tpl Co');

    const created = await request(app)
      .post(`/api/workspaces/${ws.id}/agent-templates/${workflowTemplate.id}/instantiate`)
      .set('Cookie', owner.cookie)
      .send({});
    expect(created.status).toBe(201);
    expect(created.body.data.kind).toBe('workflow');

    const run = await request(app)
      .post(`/api/workspaces/${ws.id}/workflows/${created.body.data.workflow.id}/runs`)
      .set('Cookie', owner.cookie)
      .send({ task: 'from a template' });

    // The whole point of shipping templates: what comes out is a real
    // thing that executes, not a stub that looks like one.
    expect(run.status).toBe(201);
    expect(run.body.data.run.state).toBe('completed');
    expect(run.body.data.run.plan.origin).toBe('authored');
  });

  it('accepts a name override and defaults to the template name', async () => {
    const owner = await register('tpl-name');
    const ws = await createWorkspace(owner.cookie, 'Tpl Co');

    const named = await request(app)
      .post(`/api/workspaces/${ws.id}/agent-templates/${agentTemplate.id}/instantiate`)
      .set('Cookie', owner.cookie)
      .send({ name: 'My editor' });
    expect(named.body.data.agent.name).toBe('My editor');

    const defaulted = await request(app)
      .post(`/api/workspaces/${ws.id}/agent-templates/${agentTemplate.id}/instantiate`)
      .set('Cookie', owner.cookie)
      .send({});
    expect(defaulted.body.data.agent.name).toBe(agentTemplate.name);
  });

  it('answers 404 for a template that does not exist', async () => {
    const owner = await register('tpl-missing');
    const ws = await createWorkspace(owner.cookie, 'Tpl Co');

    const res = await request(app)
      .post(`/api/workspaces/${ws.id}/agent-templates/tpl_nope/instantiate`)
      .set('Cookie', owner.cookie)
      .send({});
    expect(res.status).toBe(404);
  });

  describe('saving your own templates', () => {
    async function makeAgentWithTool(cookie: string, workspaceId: string) {
      const tool = await prisma.toolDefinition.create({
        data: {
          workspaceId,
          name: 'echo',
          displayName: 'Echo',
          description: 'echoes',
          category: 'http',
          type: 'HTTP',
          inputSchema: {},
          config: { url: 'https://example.com/echo' },
        },
      });
      const agent = await request(app)
        .post(`/api/workspaces/${workspaceId}/agents`)
        .set('Cookie', cookie)
        .send({
          name: 'My tuned agent',
          instructions: 'Do the specific thing this team needs, in the way we prefer.',
          allowedTools: [tool.id],
        });
      return { tool, agent: agent.body.data };
    }

    it('saves an agent as a template that then appears in the list', async () => {
      const owner = await register('tpl-save');
      const ws = await createWorkspace(owner.cookie, 'Tpl Co');
      const { agent } = await makeAgentWithTool(owner.cookie, ws.id);

      const saved = await request(app)
        .post(`/api/workspaces/${ws.id}/agent-templates`)
        .set('Cookie', owner.cookie)
        .send({ agentId: agent.id, outcome: 'I want another one of these.' });

      expect(saved.status).toBe(201);
      expect(saved.body.data.instructions).toBe(agent.instructions);
      expect(saved.body.data.outcome).toBe('I want another one of these.');

      const listed = await request(app)
        .get(`/api/workspaces/${ws.id}/agent-templates`)
        .set('Cookie', owner.cookie);
      expect(listed.body.data.map((t: { id: string }) => t.id)).toContain(saved.body.data.id);
    });

    it('carries the tools forward when they still exist', async () => {
      const owner = await register('tpl-save-tools');
      const ws = await createWorkspace(owner.cookie, 'Tpl Co');
      const { tool, agent } = await makeAgentWithTool(owner.cookie, ws.id);

      const saved = await request(app)
        .post(`/api/workspaces/${ws.id}/agent-templates`)
        .set('Cookie', owner.cookie)
        .send({ agentId: agent.id });

      const created = await request(app)
        .post(`/api/workspaces/${ws.id}/agent-templates/${saved.body.data.id}/instantiate`)
        .set('Cookie', owner.cookie)
        .send({});

      // A workspace template MAY name tool ids, because it never leaves
      // the workspace where those ids mean something.
      expect(created.body.data.agent.allowedTools).toEqual([tool.id]);
      expect(created.body.data.droppedTools).toEqual([]);
    });

    it('reports a tool that has been deleted since, rather than granting a dead id', async () => {
      const owner = await register('tpl-save-dropped');
      const ws = await createWorkspace(owner.cookie, 'Tpl Co');
      const { tool, agent } = await makeAgentWithTool(owner.cookie, ws.id);

      const saved = await request(app)
        .post(`/api/workspaces/${ws.id}/agent-templates`)
        .set('Cookie', owner.cookie)
        .send({ agentId: agent.id });

      await prisma.toolDefinition.delete({ where: { id: tool.id } });

      const created = await request(app)
        .post(`/api/workspaces/${ws.id}/agent-templates/${saved.body.data.id}/instantiate`)
        .set('Cookie', owner.cookie)
        .send({});

      // Granting the dead id would produce a ready-looking agent that
      // fails on first use. Dropping it silently would be the narrowing
      // this codebase refuses. So: dropped, and said out loud.
      expect(created.status).toBe(201);
      expect(created.body.data.agent.allowedTools).toEqual([]);
      expect(created.body.data.droppedTools).toEqual([tool.id]);
    });

    it('saves a workflow with its steps, and running the result works', async () => {
      const owner = await register('tpl-save-wf');
      const ws = await createWorkspace(owner.cookie, 'Tpl Co');
      const workflow = await request(app)
        .post(`/api/workspaces/${ws.id}/workflows`)
        .set('Cookie', owner.cookie)
        .send({
          name: 'Our nightly thing',
          approvalPolicy: 'nothing',
          steps: [{ id: 's1', kind: 'generate', description: 'do it', input: 'go' }],
        });

      const saved = await request(app)
        .post(`/api/workspaces/${ws.id}/agent-templates`)
        .set('Cookie', owner.cookie)
        .send({ workflowId: workflow.body.data.id });
      expect(saved.body.data.kind).toBe('workflow');
      expect(saved.body.data.steps).toHaveLength(1);

      const created = await request(app)
        .post(`/api/workspaces/${ws.id}/agent-templates/${saved.body.data.id}/instantiate`)
        .set('Cookie', owner.cookie)
        .send({});
      const run = await request(app)
        .post(`/api/workspaces/${ws.id}/workflows/${created.body.data.workflow.id}/runs`)
        .set('Cookie', owner.cookie)
        .send({ task: 't' });
      expect(run.body.data.run.state).toBe('completed');
    });

    it('requires exactly one source', async () => {
      const owner = await register('tpl-save-both');
      const ws = await createWorkspace(owner.cookie, 'Tpl Co');

      for (const body of [{}, { agentId: 'a', workflowId: 'w' }]) {
        const res = await request(app)
          .post(`/api/workspaces/${ws.id}/agent-templates`)
          .set('Cookie', owner.cookie)
          .send(body);
        expect(res.status).toBe(400);
      }
    });

    it('cannot save something from another workspace', async () => {
      const owner = await register('tpl-save-owner');
      const stranger = await register('tpl-save-stranger');
      const ws = await createWorkspace(owner.cookie, 'Tpl Co');
      const strangerWs = await createWorkspace(stranger.cookie, 'Other Co');
      const { agent } = await makeAgentWithTool(owner.cookie, ws.id);

      const res = await request(app)
        .post(`/api/workspaces/${strangerWs.id}/agent-templates`)
        .set('Cookie', stranger.cookie)
        .send({ agentId: agent.id });
      expect(res.status).toBe(404);
    });

    it('deletes a saved template but not the built-in catalogue', async () => {
      const owner = await register('tpl-save-delete');
      const ws = await createWorkspace(owner.cookie, 'Tpl Co');
      const { agent } = await makeAgentWithTool(owner.cookie, ws.id);
      const saved = await request(app)
        .post(`/api/workspaces/${ws.id}/agent-templates`)
        .set('Cookie', owner.cookie)
        .send({ agentId: agent.id });

      expect(
        (
          await request(app)
            .delete(`/api/workspaces/${ws.id}/agent-templates/${saved.body.data.id}`)
            .set('Cookie', owner.cookie)
        ).status,
      ).toBe(200);

      // A built-in is not this workspace's to delete.
      const builtIn = await request(app)
        .delete(`/api/workspaces/${ws.id}/agent-templates/${agentTemplate.id}`)
        .set('Cookie', owner.cookie);
      expect(builtIn.status).toBe(404);

      const listed = await request(app)
        .get(`/api/workspaces/${ws.id}/agent-templates`)
        .set('Cookie', owner.cookie);
      expect(listed.body.data.map((t: { id: string }) => t.id)).toContain(agentTemplate.id);
    });

    it('keeps saved templates out of other workspaces', async () => {
      const owner = await register('tpl-save-scope');
      const stranger = await register('tpl-save-scope-2');
      const ws = await createWorkspace(owner.cookie, 'Tpl Co');
      const strangerWs = await createWorkspace(stranger.cookie, 'Other Co');
      const { agent } = await makeAgentWithTool(owner.cookie, ws.id);
      const saved = await request(app)
        .post(`/api/workspaces/${ws.id}/agent-templates`)
        .set('Cookie', owner.cookie)
        .send({ agentId: agent.id });

      const theirs = await request(app)
        .get(`/api/workspaces/${strangerWs.id}/agent-templates`)
        .set('Cookie', stranger.cookie);
      expect(theirs.body.data.map((t: { id: string }) => t.id)).not.toContain(saved.body.data.id);
    });
  });

  it('creates the definition in the caller\'s workspace only', async () => {
    const owner = await register('tpl-scope');
    const stranger = await register('tpl-scope-stranger');
    const ws = await createWorkspace(owner.cookie, 'Tpl Co');
    const strangerWs = await createWorkspace(stranger.cookie, 'Other Co');

    await request(app)
      .post(`/api/workspaces/${ws.id}/agent-templates/${agentTemplate.id}/instantiate`)
      .set('Cookie', owner.cookie)
      .send({});

    const strangerList = await request(app)
      .get(`/api/workspaces/${strangerWs.id}/agents`)
      .set('Cookie', stranger.cookie);
    expect(strangerList.body.data).toEqual([]);
  });
});
