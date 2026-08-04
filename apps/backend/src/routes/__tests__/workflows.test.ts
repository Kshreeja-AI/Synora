import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { prisma } from '@synora/database';
import { createApp } from '../../app';
import { initConfig } from '../../config';
import { resetAgents } from '../../agents/agent-registry';
import { resetRuns } from '../../agents/run-engine';
import { InMemoryKeyedStore, setAgentRunStore } from '../../agents/agent-stores';
import { resetWorkflows, setWorkflowStore } from '../../workflows/workflow-registry';
import { resetSchedules, setScheduleStore, type WorkflowSchedule } from '../../workflows/schedule';
import type { AgentRun } from '../../agents/types';
import type { WorkflowDefinition } from '../../workflows/types';

// No network: see the note in agents.test.ts. The test environment carries
// a placeholder provider key, and workflows still resolve a runtime for the
// tool runner and generator even though they need no planner.
vi.mock('../../ai/resolver', () => ({
  resolveTextGenerationProvider: vi.fn(async () => {
    throw new Error('no provider configured (test)');
  }),
  resolveProvider: vi.fn(async () => {
    throw new Error('no provider configured (test)');
  }),
}));

/**
 * Workflow HTTP surface.
 *
 * The interesting assertions here are the ones that would let a workflow
 * become a way around a control that agents enforce — forbidden tools,
 * approval gates, workspace isolation — plus the one property unique to
 * workflows: an unrunnable sequence is refused when SAVED, with a 400 that
 * names the problem, rather than accepted and failed later.
 */
describe('workflow routes', () => {
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
    resetSchedules();
    setAgentRunStore(new InMemoryKeyedStore<AgentRun>());
    setWorkflowStore(new InMemoryKeyedStore<WorkflowDefinition>());
    setScheduleStore(new InMemoryKeyedStore<WorkflowSchedule>());
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

  const generateStep = (id: string) => ({
    id,
    kind: 'generate' as const,
    description: `step ${id}`,
    input: 'summarise',
  });

  async function makeWorkflow(cookie: string, workspaceId: string, body: Record<string, unknown> = {}) {
    return request(app)
      .post(`/api/workspaces/${workspaceId}/workflows`)
      .set('Cookie', cookie)
      .send({ name: 'Nightly report', steps: [generateStep('s1')], ...body });
  }

  it('creates a workflow with fail-closed defaults', async () => {
    const owner = await register('wf-owner');
    const ws = await createWorkspace(owner.cookie, 'WF Co');

    const res = await makeWorkflow(owner.cookie, ws.id);

    expect(res.status).toBe(201);
    expect(res.body.data.allowedTools).toEqual([]);
    expect(res.body.data.approvalPolicy).toBe('mutations');
    expect(res.body.data.version).toBe(1);
  });

  it('refuses at save time a workflow naming a tool it may not call', async () => {
    const owner = await register('wf-forbidden');
    const ws = await createWorkspace(owner.cookie, 'WF Co');

    const res = await makeWorkflow(owner.cookie, ws.id, {
      steps: [{ id: 's1', kind: 'tool', description: 'exfiltrate', toolId: 'exfil', input: 'x' }],
    });

    // 400, not 201-then-fail-later. Saving a workflow that can never run
    // would look ready and fail the first time it mattered.
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/not permitted to call/);
  });

  it('requires authentication and hides other workspaces', async () => {
    const owner = await register('wf-owner-2');
    const stranger = await register('wf-stranger');
    const ws = await createWorkspace(owner.cookie, 'Private Co');
    const created = await makeWorkflow(owner.cookie, ws.id);

    expect((await request(app).get(`/api/workspaces/${ws.id}/workflows`)).status).toBe(401);

    const strangerWs = await createWorkspace(stranger.cookie, 'Other Co');
    const cross = await request(app)
      .get(`/api/workspaces/${strangerWs.id}/workflows/${created.body.data.id}`)
      .set('Cookie', stranger.cookie);
    expect(cross.status).toBe(404);
  });

  it('editing creates a new version and keeps the old one runnable', async () => {
    const owner = await register('wf-version');
    const ws = await createWorkspace(owner.cookie, 'WF Co');
    const v1 = (await makeWorkflow(owner.cookie, ws.id)).body.data;

    const patched = await request(app)
      .patch(`/api/workspaces/${ws.id}/workflows/${v1.id}`)
      .set('Cookie', owner.cookie)
      .send({ name: 'Weekly report' });

    expect(patched.status).toBe(200);
    expect(patched.body.data.version).toBe(2);
    expect(patched.body.data.previousVersionId).toBe(v1.id);

    const history = await request(app)
      .get(`/api/workspaces/${ws.id}/workflows/${v1.id}/history`)
      .set('Cookie', owner.cookie);
    expect(history.body.data).toHaveLength(2);
  });

  it('runs the authored steps and reports the plan as authored', async () => {
    const owner = await register('wf-run');
    const ws = await createWorkspace(owner.cookie, 'WF Co');
    const wf = (await makeWorkflow(owner.cookie, ws.id, { approvalPolicy: 'nothing' })).body.data;

    const res = await request(app)
      .post(`/api/workspaces/${ws.id}/workflows/${wf.id}/runs`)
      .set('Cookie', owner.cookie)
      .send({ task: 'the monthly one' });

    expect(res.status).toBe(201);
    expect(res.body.data.run.state).toBe('completed');
    // Not 'local' and not 'model': nothing was improvised, so neither
    // label would be true.
    expect(res.body.data.run.plan.origin).toBe('authored');
    expect(res.body.data.runtime.mode).toBe('authored');
    expect(res.body.data.runtime.notice).toMatch(/^AUTHORED:/);
  });

  it('dry-runs a workflow end to end without creating a run or touching the tool', async () => {
    const owner = await register('wf-dry');
    const ws = await createWorkspace(owner.cookie, 'WF Co');
    const tool = await prisma.toolDefinition.create({
      data: {
        workspaceId: ws.id,
        name: 'echo',
        displayName: 'Echo',
        description: 'echoes input',
        category: 'http',
        type: 'HTTP',
        inputSchema: {},
        config: { url: 'https://example.com/echo' },
      },
    });
    const wf = (
      await makeWorkflow(owner.cookie, ws.id, {
        allowedTools: [tool.id],
        approvalPolicy: 'mutations',
        // Undeclared mutability defaults to mutating, so this pauses.
        steps: [{ id: 's1', kind: 'tool', description: 'call echo', toolId: tool.id, input: 'x' }],
      })
    ).body.data;

    const res = await request(app)
      .post(`/api/workspaces/${ws.id}/workflows/${wf.id}/dry-run`)
      .set('Cookie', owner.cookie)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.executed).toBe(false);
    expect(res.body.data.wouldStart).toBe(true);
    expect(res.body.data.blockers).toEqual([]);
    expect(res.body.data.steps[0].pausesForApproval).toBe(true);
    expect(res.body.data.steps[0].problems).toEqual([]);

    // Nothing ran: no run exists for this workflow, and the tool was never
    // actually invoked (no execution record was created for it).
    const runs = await request(app)
      .get(`/api/workspaces/${ws.id}/agents/runs`)
      .set('Cookie', owner.cookie);
    expect(runs.body.data).toEqual([]);
    const executionCount = await prisma.toolExecution.count({ where: { toolId: tool.id } });
    expect(executionCount).toBe(0);
  });

  it('reports a tool that does not exist as a blocker, not a 500', async () => {
    const owner = await register('wf-dry-ghost');
    const ws = await createWorkspace(owner.cookie, 'WF Co');
    const wf = (
      await makeWorkflow(owner.cookie, ws.id, {
        allowedTools: ['ghost-tool'],
        steps: [{ id: 's1', kind: 'tool', description: 'call it', toolId: 'ghost-tool', input: 'x', mutating: false }],
      })
    ).body.data;

    const res = await request(app)
      .post(`/api/workspaces/${ws.id}/workflows/${wf.id}/dry-run`)
      .set('Cookie', owner.cookie)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.wouldStart).toBe(false);
    expect(res.body.data.steps[0].problems.join(' ')).toMatch(/does not exist/);
  });

  it('requires authentication and hides other workspaces on the dry-run endpoint', async () => {
    const owner = await register('wf-dry-auth');
    const stranger = await register('wf-dry-stranger');
    const ws = await createWorkspace(owner.cookie, 'WF Co');
    const wf = (await makeWorkflow(owner.cookie, ws.id)).body.data;

    expect(
      (await request(app).post(`/api/workspaces/${ws.id}/workflows/${wf.id}/dry-run`).send({})).status,
    ).toBe(401);

    const strangerWs = await createWorkspace(stranger.cookie, 'Other Co');
    const cross = await request(app)
      .post(`/api/workspaces/${strangerWs.id}/workflows/${wf.id}/dry-run`)
      .set('Cookie', stranger.cookie)
      .send({});
    expect(cross.status).toBe(404);
  });

  it('parks for approval and resumes through the shared run endpoint', async () => {
    const owner = await register('wf-approve');
    const ws = await createWorkspace(owner.cookie, 'WF Co');
    const wf = (
      await makeWorkflow(owner.cookie, ws.id, {
        allowedTools: ['writer'],
        approvalPolicy: 'everything',
        steps: [{ id: 's1', kind: 'tool', description: 'write', toolId: 'writer', input: 'x', mutating: false }],
      })
    ).body.data;

    const started = await request(app)
      .post(`/api/workspaces/${ws.id}/workflows/${wf.id}/runs`)
      .set('Cookie', owner.cookie)
      .send({ task: 't' });
    expect(started.body.data.run.state).toBe('awaiting_approval');

    // Approval goes through the agent run endpoint, which must resolve a
    // WORKFLOW definition. An agent-only resolver would fail this with
    // "definition disappeared during the run".
    const approved = await request(app)
      .post(`/api/workspaces/${ws.id}/agents/runs/${started.body.data.run.id}/steps/s1/approve`)
      .set('Cookie', owner.cookie)
      .send({});

    expect(approved.status).toBe(200);
    expect(approved.body.data.run.steps[0].approvedBy).toBe(owner.userId);
  });

  it('schedules a workflow and lists the schedule', async () => {
    const owner = await register('wf-sched');
    const ws = await createWorkspace(owner.cookie, 'WF Co');
    const wf = (await makeWorkflow(owner.cookie, ws.id)).body.data;

    const created = await request(app)
      .post(`/api/workspaces/${ws.id}/workflows/${wf.id}/schedules`)
      .set('Cookie', owner.cookie)
      .send({ kind: 'daily', atMinuteUtc: 540 });

    expect(created.status).toBe(201);
    expect(created.body.data.enabled).toBe(true);
    expect(created.body.data.missedOccurrences).toBe(0);
    // The creator is recorded because a scheduled run executes as them —
    // a clock must not confer authority nobody has.
    expect(created.body.data.createdBy).toBe(owner.userId);

    const listed = await request(app)
      .get(`/api/workspaces/${ws.id}/workflows/${wf.id}/schedules`)
      .set('Cookie', owner.cookie);
    expect(listed.body.data).toHaveLength(1);
  });

  it('refuses a schedule shape it does not fully understand', async () => {
    const owner = await register('wf-sched-bad');
    const ws = await createWorkspace(owner.cookie, 'WF Co');
    const wf = (await makeWorkflow(owner.cookie, ws.id)).body.data;

    const res = await request(app)
      .post(`/api/workspaces/${ws.id}/workflows/${wf.id}/schedules`)
      .set('Cookie', owner.cookie)
      .send({ kind: 'interval', intervalMs: 60_000, atMinuteUtc: 540 });

    expect(res.status).toBe(400);
  });

  it('will not schedule an archived workflow', async () => {
    const owner = await register('wf-sched-archived');
    const ws = await createWorkspace(owner.cookie, 'WF Co');
    const wf = (await makeWorkflow(owner.cookie, ws.id)).body.data;
    await request(app)
      .delete(`/api/workspaces/${ws.id}/workflows/${wf.id}`)
      .set('Cookie', owner.cookie);

    const res = await request(app)
      .post(`/api/workspaces/${ws.id}/workflows/${wf.id}/schedules`)
      .set('Cookie', owner.cookie)
      .send({ kind: 'daily', atMinuteUtc: 540 });
    expect(res.status).toBe(400);
  });

  it('guards the schedules path with auth, not just the workflows path', async () => {
    const owner = await register('wf-sched-auth');
    const ws = await createWorkspace(owner.cookie, 'WF Co');
    const wf = (await makeWorkflow(owner.cookie, ws.id)).body.data;
    const sched = (
      await request(app)
        .post(`/api/workspaces/${ws.id}/workflows/${wf.id}/schedules`)
        .set('Cookie', owner.cookie)
        .send({ kind: 'daily', atMinuteUtc: 540 })
    ).body.data;

    // Schedules sit at their own path. A router.use only covers the prefix
    // it names, so this endpoint needs its own guard — pinned because an
    // unauthenticated mutation endpoint is exactly the kind of gap that
    // appears silently when a second resource joins a router.
    expect(
      (await request(app).patch(`/api/workspaces/${ws.id}/schedules/${sched.id}`).send({ enabled: false }))
        .status,
    ).toBe(401);
    expect(
      (await request(app).delete(`/api/workspaces/${ws.id}/schedules/${sched.id}`)).status,
    ).toBe(401);
  });

  it('pauses and deletes a schedule', async () => {
    const owner = await register('wf-sched-pause');
    const ws = await createWorkspace(owner.cookie, 'WF Co');
    const wf = (await makeWorkflow(owner.cookie, ws.id)).body.data;
    const sched = (
      await request(app)
        .post(`/api/workspaces/${ws.id}/workflows/${wf.id}/schedules`)
        .set('Cookie', owner.cookie)
        .send({ kind: 'interval', intervalMs: 3_600_000 })
    ).body.data;

    const paused = await request(app)
      .patch(`/api/workspaces/${ws.id}/schedules/${sched.id}`)
      .set('Cookie', owner.cookie)
      .send({ enabled: false });
    expect(paused.body.data.enabled).toBe(false);

    expect(
      (
        await request(app)
          .delete(`/api/workspaces/${ws.id}/schedules/${sched.id}`)
          .set('Cookie', owner.cookie)
      ).status,
    ).toBe(200);
  });

  it('archives rather than deletes, and an archived workflow starts no runs', async () => {
    const owner = await register('wf-archive');
    const ws = await createWorkspace(owner.cookie, 'WF Co');
    const wf = (await makeWorkflow(owner.cookie, ws.id)).body.data;

    const archived = await request(app)
      .delete(`/api/workspaces/${ws.id}/workflows/${wf.id}`)
      .set('Cookie', owner.cookie);
    expect(archived.body.data.archived).toBe(true);

    const run = await request(app)
      .post(`/api/workspaces/${ws.id}/workflows/${wf.id}/runs`)
      .set('Cookie', owner.cookie)
      .send({ task: 't' });
    expect(run.status).toBe(400);
  });
});
