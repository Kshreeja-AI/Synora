import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { prisma } from '@synora/database';
import { createApp } from '../../app';
import { initConfig } from '../../config';
import { resetAgents } from '../../agents/agent-registry';
import { resetRuns } from '../../agents/run-engine';
import { InMemoryKeyedStore, setAgentDefinitionStore, setAgentRunStore } from '../../agents/agent-stores';
import type { AgentDefinition, AgentRun } from '../../agents/types';

/**
 * NO NETWORK. The test environment carries a placeholder ANTHROPIC_API_KEY,
 * and provider resolution treats "a key exists" as "a provider is
 * available" — so without this mock these tests made real outbound calls
 * and failed on a 401 from a vendor. Forcing resolution to fail pins the
 * runtime into its local branch, which is both hermetic and the branch this
 * file is actually about: what a caller is told when no model is available.
 * The model branch is covered in `agents/__tests__/agent-runtime.test.ts`.
 */
vi.mock('../../ai/resolver', () => ({
  resolveTextGenerationProvider: vi.fn(async () => {
    throw new Error('no provider configured (test)');
  }),
  resolveProvider: vi.fn(async () => {
    throw new Error('no provider configured (test)');
  }),
}));

/**
 * Agent HTTP surface.
 *
 * These tests exist because the engine underneath was fully tested and
 * completely unreachable — the interesting failures at this layer are not
 * "does the engine work" but "does the boundary preserve what the engine
 * guarantees": workspace isolation, fail-closed defaults, immutable
 * versions, and the honesty label that says what produced a run.
 */
describe('agent routes', () => {
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
    setAgentDefinitionStore(new InMemoryKeyedStore<AgentDefinition>());
    setAgentRunStore(new InMemoryKeyedStore<AgentRun>());
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
    const cookies = Array.isArray(setCookieHeaders)
      ? setCookieHeaders
      : setCookieHeaders
        ? [setCookieHeaders]
        : [];
    return cookies.map((c) => c.split(';')[0]).join('; ');
  }

  async function register(prefix: string) {
    const email = uniqueEmail(prefix);
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email, password: 'a-valid-password-123' });
    return {
      cookie: cookieHeader(res.headers['set-cookie']),
      userId: res.body.data.user.id as string,
      email,
    };
  }

  async function createWorkspace(cookie: string, name: string) {
    const res = await request(app).post('/api/workspaces').set('Cookie', cookie).send({ name });
    testWorkspaceIds.push(res.body.data.id);
    return res.body.data as { id: string };
  }

  async function makeAgent(
    cookie: string,
    workspaceId: string,
    body: Record<string, unknown> = {},
  ) {
    const res = await request(app)
      .post(`/api/workspaces/${workspaceId}/agents`)
      .set('Cookie', cookie)
      .send({ name: 'Researcher', instructions: 'be brief', ...body });
    return res;
  }

  // --- Definitions -------------------------------------------------------

  it('creates an agent with fail-closed defaults', async () => {
    const owner = await register('agent-owner');
    const ws = await createWorkspace(owner.cookie, 'Agent Co');

    const res = await makeAgent(owner.cookie, ws.id);

    expect(res.status).toBe(201);
    // Unspecified means NO tools, not all tools, and anything that mutates
    // pauses for a human. The API must not loosen what the registry closed.
    expect(res.body.data.allowedTools).toEqual([]);
    expect(res.body.data.approvalPolicy).toBe('mutations');
    expect(res.body.data.version).toBe(1);
    expect(res.body.data.archived).toBe(false);
  });

  it('refuses an agent with no instructions', async () => {
    const owner = await register('agent-noinstr');
    const ws = await createWorkspace(owner.cookie, 'Agent Co');

    // An agent with no stated behaviour is an undefined executor, and one
    // with tool access is not a thing to create quietly.
    const res = await makeAgent(owner.cookie, ws.id, { instructions: '' });
    expect(res.status).toBe(400);
  });

  it('requires authentication', async () => {
    const owner = await register('agent-anon');
    const ws = await createWorkspace(owner.cookie, 'Agent Co');

    const res = await request(app).get(`/api/workspaces/${ws.id}/agents`);
    expect(res.status).toBe(401);
  });

  it('answers 404, not 403, for an agent in another workspace', async () => {
    const owner = await register('agent-owner-x');
    const stranger = await register('agent-stranger');
    const ws = await createWorkspace(owner.cookie, 'Private Co');
    const strangerWs = await createWorkspace(stranger.cookie, 'Other Co');
    const created = await makeAgent(owner.cookie, ws.id);

    // Asking through a workspace the stranger DOES belong to: the agent is
    // simply not there. Never confirm the existence of what a caller may
    // not see.
    const res = await request(app)
      .get(`/api/workspaces/${strangerWs.id}/agents/${created.body.data.id}`)
      .set('Cookie', stranger.cookie);
    expect(res.status).toBe(404);

    // And the workspace itself is equally invisible to a non-member.
    const viaOwnersWorkspace = await request(app)
      .get(`/api/workspaces/${ws.id}/agents`)
      .set('Cookie', stranger.cookie);
    expect(viaOwnersWorkspace.status).toBe(404);
  });

  it('editing creates a new version and leaves the old one resolvable', async () => {
    const owner = await register('agent-version');
    const ws = await createWorkspace(owner.cookie, 'Agent Co');
    const v1 = (await makeAgent(owner.cookie, ws.id)).body.data;

    const patched = await request(app)
      .patch(`/api/workspaces/${ws.id}/agents/${v1.id}`)
      .set('Cookie', owner.cookie)
      .send({ instructions: 'be thorough' });

    expect(patched.status).toBe(200);
    expect(patched.body.data.version).toBe(2);
    expect(patched.body.data.id).not.toBe(v1.id);
    expect(patched.body.data.previousVersionId).toBe(v1.id);

    // The old version must still resolve exactly as it was, because runs
    // recorded against it name it as their configuration.
    const oldStill = await request(app)
      .get(`/api/workspaces/${ws.id}/agents/${v1.id}`)
      .set('Cookie', owner.cookie);
    expect(oldStill.status).toBe(200);
    expect(oldStill.body.data.instructions).toBe('be brief');

    const history = await request(app)
      .get(`/api/workspaces/${ws.id}/agents/${v1.id}/history`)
      .set('Cookie', owner.cookie);
    expect(history.body.data.map((a: AgentDefinition) => a.version)).toEqual([1, 2]);

    // Listing shows the latest of the lineage once, not both versions.
    const listed = await request(app)
      .get(`/api/workspaces/${ws.id}/agents`)
      .set('Cookie', owner.cookie);
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0].version).toBe(2);
  });

  it('archives rather than deletes, and an archived agent starts no runs', async () => {
    const owner = await register('agent-archive');
    const ws = await createWorkspace(owner.cookie, 'Agent Co');
    const agent = (await makeAgent(owner.cookie, ws.id)).body.data;

    const archived = await request(app)
      .delete(`/api/workspaces/${ws.id}/agents/${agent.id}`)
      .set('Cookie', owner.cookie);
    expect(archived.status).toBe(200);
    expect(archived.body.data.archived).toBe(true);

    // Still resolvable — history references it.
    const stillThere = await request(app)
      .get(`/api/workspaces/${ws.id}/agents/${agent.id}`)
      .set('Cookie', owner.cookie);
    expect(stillThere.status).toBe(200);

    const run = await request(app)
      .post(`/api/workspaces/${ws.id}/agents/${agent.id}/runs`)
      .set('Cookie', owner.cookie)
      .send({ task: 'generate hello' });
    expect(run.status).toBe(400);
  });

  // --- Runs --------------------------------------------------------------

  it('starts a run and labels what produced the plan', async () => {
    const owner = await register('agent-run');
    const ws = await createWorkspace(owner.cookie, 'Agent Co');
    const agent = (await makeAgent(owner.cookie, ws.id, { approvalPolicy: 'nothing' })).body.data;

    const res = await request(app)
      .post(`/api/workspaces/${ws.id}/agents/${agent.id}/runs`)
      .set('Cookie', owner.cookie)
      .send({ task: 'generate a summary' });

    expect(res.status).toBe(201);
    expect(res.body.data.run.state).toBe('completed');

    // The provenance label is not optional decoration: no response shape
    // carries a run without saying what produced it, so a UI cannot render
    // deterministic scaffolding as if it were model intelligence.
    const { runtime } = res.body.data;
    expect(runtime.mode).toBe('local');
    expect(runtime.notice).toMatch(/^LOCAL:/);
    expect(runtime.notice).toMatch(/not model intelligence/);
    expect(runtime.planOrigin).toBe('local-deterministic');
  });

  it('refuses the whole run when the plan names a tool the agent may not call', async () => {
    const owner = await register('agent-forbidden');
    const ws = await createWorkspace(owner.cookie, 'Agent Co');
    // allowedTools defaults to empty, so ANY tool step is forbidden.
    const agent = (await makeAgent(owner.cookie, ws.id, { approvalPolicy: 'nothing' })).body.data;

    const res = await request(app)
      .post(`/api/workspaces/${ws.id}/agents/${agent.id}/runs`)
      .set('Cookie', owner.cookie)
      .send({ task: 'tool:secret-exfil everything' });

    expect(res.status).toBe(201);
    // Refused whole, not partially executed with the bad step skipped.
    expect(res.body.data.run.state).toBe('failed');
    expect(res.body.data.run.error).toMatch(/not permitted to call/);
    expect(res.body.data.run.steps).toHaveLength(0);
  });

  it('refuses a run before execution when the workspace budget is exhausted', async () => {
    const owner = await register('agent-budget');
    const ws = await createWorkspace(owner.cookie, 'Broke Co');
    const agent = (await makeAgent(owner.cookie, ws.id, { approvalPolicy: 'nothing' })).body.data;

    // Opting into billing: a credits account exists and is empty. The
    // budget must bind BEFORE anything executes — at deduction time the
    // work is already done, which is too late for a budget to mean
    // anything.
    await prisma.workspaceCredits.create({ data: { workspaceId: ws.id, balance: 0 } });

    const res = await request(app)
      .post(`/api/workspaces/${ws.id}/agents/${agent.id}/runs`)
      .set('Cookie', owner.cookie)
      .send({ task: 'generate hello' });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/no remaining balance/);

    // Nothing ran and nothing was recorded: the refusal is pre-execution.
    const runs = await request(app)
      .get(`/api/workspaces/${ws.id}/agents/runs`)
      .set('Cookie', owner.cookie);
    expect(runs.body.data).toEqual([]);
  });

  it('rejects a run with an empty task', async () => {
    const owner = await register('agent-empty-task');
    const ws = await createWorkspace(owner.cookie, 'Agent Co');
    const agent = (await makeAgent(owner.cookie, ws.id)).body.data;

    const res = await request(app)
      .post(`/api/workspaces/${ws.id}/agents/${agent.id}/runs`)
      .set('Cookie', owner.cookie)
      .send({ task: '' });
    expect(res.status).toBe(400);
  });

  it('lists runs without the route being shadowed by the agent-id route', async () => {
    const owner = await register('agent-list-runs');
    const ws = await createWorkspace(owner.cookie, 'Agent Co');
    const agent = (await makeAgent(owner.cookie, ws.id, { approvalPolicy: 'nothing' })).body.data;
    await request(app)
      .post(`/api/workspaces/${ws.id}/agents/${agent.id}/runs`)
      .set('Cookie', owner.cookie)
      .send({ task: 'generate one' });

    // Declaration order matters here: `/agents/runs` sits before
    // `/agents/:agentId`, or this returns 404 for agentId="runs". Pinned
    // because the failure is silent and easy to reintroduce by reordering.
    const listed = await request(app)
      .get(`/api/workspaces/${ws.id}/agents/runs`)
      .set('Cookie', owner.cookie);
    expect(listed.status).toBe(200);
    expect(listed.body.data).toHaveLength(1);

    const single = await request(app)
      .get(`/api/workspaces/${ws.id}/agents/runs/${listed.body.data[0].id}`)
      .set('Cookie', owner.cookie);
    expect(single.status).toBe(200);
    expect(single.body.data.task).toBe('generate one');
  });

  it('gives an approver the paused step’s consequences, not just its id', async () => {
    const owner = await register('agent-approver-facts');
    const ws = await createWorkspace(owner.cookie, 'Approver Co');
    const agent = (await makeAgent(owner.cookie, ws.id, { approvalPolicy: 'everything' })).body
      .data;
    const started = await request(app)
      .post(`/api/workspaces/${ws.id}/agents/${agent.id}/runs`)
      .set('Cookie', owner.cookie)
      .send({ task: 'generate a short note' });
    expect(started.status).toBe(201);

    const res = await request(app)
      .get(`/api/workspaces/${ws.id}/agents/runs/${started.body.data.run.id}`)
      .set('Cookie', owner.cookie);

    expect(res.status).toBe(200);
    if (res.body.data.pendingApproval) {
      // Whoever decides sees what the step actually does — the same
      // facts a preview shows, from the same checker.
      expect(res.body.data.pendingStepFacts).toMatchObject({
        stepId: res.body.data.pendingApproval.stepId,
      });
      expect(typeof res.body.data.pendingStepFacts.description).toBe('string');
    } else {
      // A run that never paused has no decision to contextualise, and
      // must not carry a phantom one.
      expect(res.body.data.pendingStepFacts).toBeNull();
    }
  });

  it('previews a plan without creating any run at all', async () => {
    const owner = await register('agent-preview');
    const ws = await createWorkspace(owner.cookie, 'Preview Co');
    const agent = (await makeAgent(owner.cookie, ws.id, { approvalPolicy: 'everything' })).body
      .data;

    const res = await request(app)
      .post(`/api/workspaces/${ws.id}/agents/${agent.id}/runs/preview`)
      .set('Cookie', owner.cookie)
      .send({ task: 'generate a summary of the quarter' });

    expect(res.status).toBe(200);
    // Literal, not inferred: the report SAYS nothing executed…
    expect(res.body.data.executed).toBe(false);
    expect(res.body.data.steps.length).toBeGreaterThan(0);
    // …and provenance is never collapsed: with no provider configured the
    // plan is the deterministic local planner's, labeled as exactly that.
    expect(res.body.data.planOrigin).toBe('local-deterministic');
    expect(res.body.data.runtime.mode).toBe('local');
    expect(res.body.data.runtime.notice).toMatch(/^LOCAL:/);
    expect(res.body.data.caveats.join(' ')).toMatch(/no run record exists/);

    // The whole point of the feature: the run list is untouched.
    const runs = await request(app)
      .get(`/api/workspaces/${ws.id}/agents/runs`)
      .set('Cookie', owner.cookie);
    expect(runs.body.data).toEqual([]);
  });

  it('reports an exhausted budget as a blocker instead of refusing the preview', async () => {
    const owner = await register('agent-preview-broke');
    const ws = await createWorkspace(owner.cookie, 'Broke Preview Co');
    const agent = (await makeAgent(owner.cookie, ws.id)).body.data;
    await prisma.workspaceCredits.create({ data: { workspaceId: ws.id, balance: 0 } });

    const res = await request(app)
      .post(`/api/workspaces/${ws.id}/agents/${agent.id}/runs/preview`)
      .set('Cookie', owner.cookie)
      .send({ task: 'generate anything' });

    // Starting a run with this balance is refused with a 400. The preview
    // is a read and costs the workspace nothing to see — someone out of
    // credits needs this information most, so the empty budget arrives as
    // a stated blocker, not as a closed door.
    expect(res.status).toBe(200);
    expect(res.body.data.wouldStart).toBe(false);
    expect(res.body.data.blockers.join(' ')).toMatch(/balance/i);
  });

  it('refuses to preview on an archived agent', async () => {
    const owner = await register('agent-preview-archived');
    const ws = await createWorkspace(owner.cookie, 'Archived Preview Co');
    const agent = (await makeAgent(owner.cookie, ws.id)).body.data;
    await request(app)
      .delete(`/api/workspaces/${ws.id}/agents/${agent.id}`)
      .set('Cookie', owner.cookie);

    const res = await request(app)
      .post(`/api/workspaces/${ws.id}/agents/${agent.id}/runs/preview`)
      .set('Cookie', owner.cookie)
      .send({ task: 'generate anything' });

    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('hides the preview from someone outside the workspace', async () => {
    const owner = await register('agent-preview-owner');
    const stranger = await register('agent-preview-stranger');
    const ws = await createWorkspace(owner.cookie, 'Private Preview Co');
    const agent = (await makeAgent(owner.cookie, ws.id)).body.data;

    const res = await request(app)
      .post(`/api/workspaces/${ws.id}/agents/${agent.id}/runs/preview`)
      .set('Cookie', stranger.cookie)
      .send({ task: 'generate anything' });

    expect([403, 404]).toContain(res.status);
  });

  it('resolves WHO asked for a run to a person on the read surfaces', async () => {
    const owner = await register('agent-who');
    const ws = await createWorkspace(owner.cookie, 'Who Co');
    const agent = (await makeAgent(owner.cookie, ws.id, { approvalPolicy: 'nothing' })).body.data;
    await request(app)
      .post(`/api/workspaces/${ws.id}/agents/${agent.id}/runs`)
      .set('Cookie', owner.cookie)
      .send({ task: 'generate whoami' });

    const listed = await request(app)
      .get(`/api/workspaces/${ws.id}/agents/runs`)
      .set('Cookie', owner.cookie);
    expect(listed.status).toBe(200);
    // With no display name set the resolver falls back to the email — an
    // identifiable person either way, never a raw internal id. WHO asked
    // is part of the context a decision surface owes its reader.
    expect(listed.body.data[0].requestedByName).toBe(owner.email);

    const single = await request(app)
      .get(`/api/workspaces/${ws.id}/agents/runs/${listed.body.data[0].id}`)
      .set('Cookie', owner.cookie);
    expect(single.body.data.requestedByName).toBe(owner.email);
  });

  it('parks a run for approval, records the approver, and resumes', async () => {
    const owner = await register('agent-approve');
    const ws = await createWorkspace(owner.cookie, 'Agent Co');
    const agent = (
      await makeAgent(owner.cookie, ws.id, {
        allowedTools: ['echo'],
        approvalPolicy: 'everything',
      })
    ).body.data;

    const started = await request(app)
      .post(`/api/workspaces/${ws.id}/agents/${agent.id}/runs`)
      .set('Cookie', owner.cookie)
      .send({ task: 'tool!:echo hi' });

    // Parked BEFORE the tool ran — there is no execute-first path, so the
    // absence of a real `echo` tool in this workspace cannot matter yet.
    const run = started.body.data.run;
    expect(run.state).toBe('awaiting_approval');
    expect(run.pendingApproval.stepId).toBe('s1');

    const approved = await request(app)
      .post(`/api/workspaces/${ws.id}/agents/runs/${run.id}/steps/s1/approve`)
      .set('Cookie', owner.cookie)
      .send({});

    expect(approved.status).toBe(200);
    // The approver is recorded by identity, from the session — never taken
    // from the request body, and never anonymous. That holds regardless of
    // what the tool then did (here it fails: no such tool exists).
    expect(approved.body.data.run.steps[0].approvedBy).toBe(owner.userId);
  });

  it('a rejected step ends the run rather than skipping past it', async () => {
    const owner = await register('agent-reject');
    const ws = await createWorkspace(owner.cookie, 'Agent Co');
    const agent = (
      await makeAgent(owner.cookie, ws.id, {
        allowedTools: ['echo'],
        approvalPolicy: 'everything',
      })
    ).body.data;
    const started = await request(app)
      .post(`/api/workspaces/${ws.id}/agents/${agent.id}/runs`)
      .set('Cookie', owner.cookie)
      .send({ task: 'tool!:echo hi' });

    const res = await request(app)
      .post(`/api/workspaces/${ws.id}/agents/runs/${started.body.data.run.id}/steps/s1/reject`)
      .set('Cookie', owner.cookie)
      .send({ reason: 'not today' });

    expect(res.status).toBe(200);
    expect(res.body.data.state).toBe('cancelled');
    expect(res.body.data.steps[0].state).toBe('skipped');
  });

  it('cancels a run', async () => {
    const owner = await register('agent-cancel');
    const ws = await createWorkspace(owner.cookie, 'Agent Co');
    const agent = (await makeAgent(owner.cookie, ws.id, { approvalPolicy: 'nothing' })).body.data;
    const started = await request(app)
      .post(`/api/workspaces/${ws.id}/agents/${agent.id}/runs`)
      .set('Cookie', owner.cookie)
      .send({ task: 'generate one' });

    const res = await request(app)
      .post(`/api/workspaces/${ws.id}/agents/runs/${started.body.data.run.id}/cancel`)
      .set('Cookie', owner.cookie)
      .send({});

    // Already terminal: cancelling is a no-op that returns the run as it
    // is, rather than an error or a false state change.
    expect(res.status).toBe(200);
    expect(res.body.data.state).toBe('completed');
  });

  it('does not expose one workspace\'s runs to another', async () => {
    const owner = await register('agent-run-owner');
    const stranger = await register('agent-run-stranger');
    const ws = await createWorkspace(owner.cookie, 'Private Co');
    const strangerWs = await createWorkspace(stranger.cookie, 'Other Co');
    const agent = (await makeAgent(owner.cookie, ws.id, { approvalPolicy: 'nothing' })).body.data;
    const started = await request(app)
      .post(`/api/workspaces/${ws.id}/agents/${agent.id}/runs`)
      .set('Cookie', owner.cookie)
      .send({ task: 'generate secret' });

    const res = await request(app)
      .get(`/api/workspaces/${strangerWs.id}/agents/runs/${started.body.data.run.id}`)
      .set('Cookie', stranger.cookie);
    expect(res.status).toBe(404);

    const listed = await request(app)
      .get(`/api/workspaces/${strangerWs.id}/agents/runs`)
      .set('Cookie', stranger.cookie);
    expect(listed.body.data).toEqual([]);
  });
});
