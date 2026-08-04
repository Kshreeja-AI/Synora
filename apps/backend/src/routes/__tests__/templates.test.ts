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
