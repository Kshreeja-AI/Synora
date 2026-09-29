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
import { resetSchedules, setScheduleStore, type WorkflowSchedule } from '../../workflows/schedule';
import { resetTriggers, setTriggerStore, type WorkflowTrigger } from '../../workflows/trigger';
import { resetPlugins, setPluginStore } from '../../plugins/plugin-registry';
import { resetCanvases, setCanvasStore } from '../../canvas/canvas-store';
import type { AgentDefinition, AgentRun } from '../../agents/types';
import type { WorkflowDefinition } from '../../workflows/types';
import type { CanvasDocument } from '../../canvas/types';
import type { InstalledPlugin } from '../../plugins/types';

vi.mock('../../ai/resolver', () => ({
  resolveTextGenerationProvider: vi.fn(async () => {
    throw new Error('no provider configured (test)');
  }),
  resolveProvider: vi.fn(async () => {
    throw new Error('no provider configured (test)');
  }),
}));

/**
 * Whole journeys, end to end over HTTP.
 *
 * WHY THESE EXIST SEPARATELY from the per-route tests. A route test proves
 * one endpoint behaves. It cannot prove that the sequence a real person
 * performs actually works, because the interesting failures live in the
 * seams: an id that changes shape between two calls, a permission checked
 * in one place and assumed in another, a resource created by one subsystem
 * that a second cannot see. Every one of those passes a unit test and
 * fails a user.
 *
 * Each test below is a complete task a person would sit down to do,
 * performed the way they would perform it, with nothing mocked but the
 * absent model provider.
 */
describe('user journeys', () => {
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
    resetTriggers();
    resetPlugins();
    resetCanvases();
    setAgentDefinitionStore(new InMemoryKeyedStore<AgentDefinition>());
    setAgentRunStore(new InMemoryKeyedStore<AgentRun>());
    setWorkflowStore(new InMemoryKeyedStore<WorkflowDefinition>());
    setScheduleStore(new InMemoryKeyedStore<WorkflowSchedule>());
    setTriggerStore(new InMemoryKeyedStore<WorkflowTrigger>());
    setPluginStore(new InMemoryKeyedStore<InstalledPlugin>());
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

  /** A person arriving with nothing: sign up, get a workspace. */
  async function newUserWithWorkspace(prefix: string) {
    const email = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    testEmails.push(email);
    const registered = await request(app)
      .post('/api/auth/register')
      .send({ email, password: 'a-valid-password-123' });
    expect(registered.status).toBe(201);
    const cookie = cookieHeader(registered.headers['set-cookie']);

    const workspace = await request(app)
      .post('/api/workspaces')
      .set('Cookie', cookie)
      .send({ name: 'Journey Co' });
    expect(workspace.status).toBe(201);
    testWorkspaceIds.push(workspace.body.data.id);

    return { cookie, userId: registered.body.data.user.id as string, workspaceId: workspace.body.data.id as string };
  }

  it('journey: from a blank workspace to a finished workflow run, via a template', async () => {
    const { cookie, workspaceId } = await newUserWithWorkspace('journey-template');

    // 1. Look at what is on offer.
    const templates = await request(app)
      .get(`/api/workspaces/${workspaceId}/agent-templates?kind=workflow`)
      .set('Cookie', cookie);
    expect(templates.status).toBe(200);
    expect(templates.body.data.length).toBeGreaterThan(0);
    const chosen = templates.body.data[0];

    // 2. Turn one into a real workflow.
    const created = await request(app)
      .post(`/api/workspaces/${workspaceId}/agent-templates/${chosen.id}/instantiate`)
      .set('Cookie', cookie)
      .send({ name: 'My first workflow' });
    expect(created.status).toBe(201);
    const workflowId = created.body.data.workflow.id as string;

    // 3. Check it before spending anything on it.
    const dry = await request(app)
      .post(`/api/workspaces/${workspaceId}/workflows/${workflowId}/dry-run`)
      .set('Cookie', cookie)
      .send({});
    expect(dry.status).toBe(200);
    expect(dry.body.data.executed).toBe(false);
    expect(dry.body.data.wouldStart).toBe(true);

    // 4. Run it for real.
    const run = await request(app)
      .post(`/api/workspaces/${workspaceId}/workflows/${workflowId}/runs`)
      .set('Cookie', cookie)
      .send({ task: 'the first one' });
    expect(run.status).toBe(201);
    expect(run.body.data.run.state).toBe('completed');

    // 5. Find it again in history, which is where someone would look.
    const history = await request(app)
      .get(`/api/workspaces/${workspaceId}/agents/runs`)
      .set('Cookie', cookie);
    expect(history.body.data.map((r: { id: string }) => r.id)).toContain(run.body.data.run.id);

    // 6. And see what it cost, on the ledger everything else bills through.
    const usage = await prisma.usageRecord.findMany({ where: { workspaceId } });
    expect(usage.length).toBeGreaterThan(0);
    expect(usage[0].capability).toBe('workflow-run');
  });

  it('journey: a dry run catches a broken workflow before it is ever started', async () => {
    const { cookie, workspaceId } = await newUserWithWorkspace('journey-dry');

    // A workflow whose second step references a step that does not exist.
    const created = await request(app)
      .post(`/api/workspaces/${workspaceId}/workflows`)
      .set('Cookie', cookie)
      .send({
        name: 'Broken',
        approvalPolicy: 'nothing',
        steps: [
          { id: 's1', kind: 'generate', description: 'first', input: 'do a thing' },
          { id: 's2', kind: 'generate', description: 'second', input: 'use {{missing}}' },
        ],
      });
    expect(created.status).toBe(201);

    const dry = await request(app)
      .post(`/api/workspaces/${workspaceId}/workflows/${created.body.data.id}/dry-run`)
      .set('Cookie', cookie)
      .send({});

    // Told before running, not discovered by a confusing output afterwards.
    expect(dry.body.data.wouldStart).toBe(false);
    expect(JSON.stringify(dry.body.data.steps)).toMatch(/no earlier step produces/);

    // And nothing was created by looking.
    const runs = await request(app)
      .get(`/api/workspaces/${workspaceId}/agents/runs`)
      .set('Cookie', cookie);
    expect(runs.body.data).toEqual([]);
  });

  it('journey: wiring an outside system to a workflow, then turning it off', async () => {
    const { cookie, workspaceId, userId } = await newUserWithWorkspace('journey-trigger');

    const workflow = await request(app)
      .post(`/api/workspaces/${workspaceId}/workflows`)
      .set('Cookie', cookie)
      .send({
        name: 'On demand',
        approvalPolicy: 'nothing',
        steps: [{ id: 's1', kind: 'generate', description: 'react', input: 'summarise' }],
      });

    const trigger = await request(app)
      .post(`/api/workspaces/${workspaceId}/workflows/${workflow.body.data.id}/triggers`)
      .set('Cookie', cookie)
      .send({});
    expect(trigger.status).toBe(201);
    const secret = trigger.body.data.secret as string;

    // The outside system has no session — just the URL it was given.
    const fired = await request(app)
      .post(`/api/hooks/workflows/${secret}`)
      .send({ task: 'a form was submitted' });
    expect(fired.status).toBe(201);
    expect(fired.body.data.run.state).toBe('completed');
    // Executed as the person who created the trigger, not with ambient
    // authority — the property that keeps a webhook from being a
    // privilege escalation.
    expect(fired.body.data.run.requestedBy).toBe(userId);

    // Turn it off, and the same URL stops working.
    await request(app)
      .patch(`/api/workspaces/${workspaceId}/triggers/${trigger.body.data.trigger.id}`)
      .set('Cookie', cookie)
      .send({ enabled: false });

    const refused = await request(app).post(`/api/hooks/workflows/${secret}`).send({});
    expect(refused.status).toBe(404);
  });

  it('journey: installing a plugin, using what it contributes, then removing it', async () => {
    const { cookie, workspaceId } = await newUserWithWorkspace('journey-plugin');

    const installed = await request(app)
      .post(`/api/workspaces/${workspaceId}/plugins`)
      .set('Cookie', cookie)
      .send({
        manifest: {
          id: 'acme.pack',
          name: 'Acme pack',
          version: '1.0.0',
          publisher: 'acme',
          description: 'A template pack.',
          permissions: ['templates:contribute'],
          contributions: {
            templates: [
              {
                kind: 'agent',
                id: 'tpl_acme_journey',
                name: 'Acme reviewer',
                description: 'Reviews things.',
                category: 'analysis',
                outcome: 'I want a second opinion.',
                instructions: 'Review the material and say what is wrong with it, specifically.',
                suggestedTools: [],
              },
            ],
          },
        },
      });
    expect(installed.status).toBe(201);

    // The contribution is visible where a user would look for it.
    const templates = await request(app)
      .get(`/api/workspaces/${workspaceId}/agent-templates`)
      .set('Cookie', cookie);
    expect(templates.body.data.map((t: { id: string }) => t.id)).toContain('tpl_acme_journey');

    // And it produces a real agent, indistinguishable from a hand-made one.
    const agent = await request(app)
      .post(`/api/workspaces/${workspaceId}/agent-templates/tpl_acme_journey/instantiate`)
      .set('Cookie', cookie)
      .send({});
    expect(agent.status).toBe(201);
    const agentId = agent.body.data.agent.id as string;

    const listed = await request(app)
      .get(`/api/workspaces/${workspaceId}/agents`)
      .set('Cookie', cookie);
    expect(listed.body.data.map((a: { id: string }) => a.id)).toContain(agentId);

    // Uninstall takes the template away...
    await request(app)
      .delete(`/api/workspaces/${workspaceId}/plugins/acme.pack`)
      .set('Cookie', cookie);
    const after = await request(app)
      .get(`/api/workspaces/${workspaceId}/agent-templates`)
      .set('Cookie', cookie);
    expect(after.body.data.map((t: { id: string }) => t.id)).not.toContain('tpl_acme_journey');

    // ...but NOT the agent someone already made from it. A template is a
    // starting point, not an ongoing dependency, and uninstalling a plugin
    // must not delete work.
    const stillThere = await request(app)
      .get(`/api/workspaces/${workspaceId}/agents/${agentId}`)
      .set('Cookie', cookie);
    expect(stillThere.status).toBe(200);
  });

  it('journey: arranging a canvas, connecting blocks, and losing a block cleanly', async () => {
    const { cookie, workspaceId } = await newUserWithWorkspace('journey-canvas');

    const canvas = await request(app)
      .post(`/api/workspaces/${workspaceId}/canvases`)
      .set('Cookie', cookie)
      .send({ title: 'Launch plan' });
    expect(canvas.status).toBe(201);
    const canvasId = canvas.body.data.id as string;

    const block = async (content: string, x: number) =>
      (
        await request(app)
          .post(`/api/workspaces/${workspaceId}/canvases/${canvasId}/blocks`)
          .set('Cookie', cookie)
          .send({ kind: 'note', content, x, y: 0 })
      ).body.data;

    const a = await block('Write the announcement', 0);
    const b = await block('Send it', 300);

    const connected = await request(app)
      .post(`/api/workspaces/${workspaceId}/canvases/${canvasId}/connections`)
      .set('Cookie', cookie)
      .send({ from: a.id, to: b.id, label: 'then' });
    expect(connected.status).toBe(201);

    // Move one, and the surface still reads correctly.
    await request(app)
      .patch(`/api/workspaces/${workspaceId}/canvases/${canvasId}/blocks/${a.id}`)
      .set('Cookie', cookie)
      .send({ x: 40, y: 60 });

    const read = await request(app)
      .get(`/api/workspaces/${workspaceId}/canvases/${canvasId}`)
      .set('Cookie', cookie);
    expect(read.body.data.blocks.find((x: { id: string }) => x.id === a.id).x).toBe(40);
    expect(read.body.data.connections).toHaveLength(1);

    // Delete a block: the line goes with it rather than dangling.
    await request(app)
      .delete(`/api/workspaces/${workspaceId}/canvases/${canvasId}/blocks/${b.id}`)
      .set('Cookie', cookie);

    const afterDelete = await request(app)
      .get(`/api/workspaces/${workspaceId}/canvases/${canvasId}`)
      .set('Cookie', cookie);
    expect(afterDelete.body.data.blocks).toHaveLength(1);
    expect(afterDelete.body.data.connections).toEqual([]);
  });

  it('journey: an agent that pauses for approval, and the human who resolves it', async () => {
    const { cookie, workspaceId, userId } = await newUserWithWorkspace('journey-approval');

    const tool = await prisma.toolDefinition.create({
      data: {
        workspaceId,
        name: 'notifier',
        displayName: 'Notifier',
        description: 'sends a notification',
        category: 'http',
        type: 'HTTP',
        inputSchema: {},
        config: { url: 'https://example.com/notify' },
      },
    });

    // A workflow whose only step mutates, under the fail-closed default.
    const workflow = await request(app)
      .post(`/api/workspaces/${workspaceId}/workflows`)
      .set('Cookie', cookie)
      .send({
        name: 'Announce',
        allowedTools: [tool.id],
        steps: [{ id: 's1', kind: 'tool', description: 'notify', toolId: tool.id, input: 'x' }],
      });
    expect(workflow.status).toBe(201);
    expect(workflow.body.data.approvalPolicy).toBe('mutations');

    const started = await request(app)
      .post(`/api/workspaces/${workspaceId}/workflows/${workflow.body.data.id}/runs`)
      .set('Cookie', cookie)
      .send({ task: 'ship it' });
    // Parked, not executed: an undeclared tool step is treated as mutating.
    expect(started.body.data.run.state).toBe('awaiting_approval');
    const runId = started.body.data.run.id as string;

    // The human declines. That ends the run rather than skipping the step,
    // because a plan missing a step it depended on is not the plan anyone
    // approved.
    const rejected = await request(app)
      .post(`/api/workspaces/${workspaceId}/agents/runs/${runId}/steps/s1/reject`)
      .set('Cookie', cookie)
      .send({ reason: 'not today' });
    expect(rejected.status).toBe(200);
    // NOTE, found by writing this journey: `reject` and `cancel` return the
    // run directly, while `start` and `approve` wrap it as `{ run, ... }`
    // because they carry a runtime notice alongside. Both sides of the wire
    // agree — the web client types these the same way — so this is a
    // non-uniformity to know about rather than a defect, and it is recorded
    // in the capability matrix instead of being silently changed here.
    // 'cancelled', not 'failed': a human declining is not the system
    // breaking, and the run record distinguishes the two.
    expect(rejected.body.data.state).toBe('cancelled');

    // The record says who was asked and what happened.
    const detail = await request(app)
      .get(`/api/workspaces/${workspaceId}/agents/runs/${runId}`)
      .set('Cookie', cookie);
    expect(detail.body.data.requestedBy).toBe(userId);
    expect(JSON.stringify(detail.body.data.log)).toMatch(/not today/);
  });

  it('journey: a workspace out of credits is told before it spends, not after', async () => {
    const { cookie, workspaceId } = await newUserWithWorkspace('journey-budget');
    await prisma.workspaceCredits.create({ data: { workspaceId, balance: 0 } });

    const workflow = await request(app)
      .post(`/api/workspaces/${workspaceId}/workflows`)
      .set('Cookie', cookie)
      .send({
        name: 'Expensive',
        approvalPolicy: 'nothing',
        steps: [{ id: 's1', kind: 'generate', description: 'think', input: 'go' }],
      });

    const run = await request(app)
      .post(`/api/workspaces/${workspaceId}/workflows/${workflow.body.data.id}/runs`)
      .set('Cookie', cookie)
      .send({ task: 't' });
    expect(run.status).toBe(400);
    expect(JSON.stringify(run.body)).toMatch(/no remaining balance/);

    // A dry run still works, which is the whole point of refusing at the
    // gate rather than refusing everything: inspection costs nothing and
    // is exactly what someone in this position needs.
    const dry = await request(app)
      .post(`/api/workspaces/${workspaceId}/workflows/${workflow.body.data.id}/dry-run`)
      .set('Cookie', cookie)
      .send({});
    expect(dry.status).toBe(200);
    expect(dry.body.data.wouldStart).toBe(false);
    expect(JSON.stringify(dry.body.data.blockers)).toMatch(/no remaining balance/);
  });

  it('journey: one workspace can see nothing of another, at every surface', async () => {
    const mine = await newUserWithWorkspace('journey-mine');
    const theirs = await newUserWithWorkspace('journey-theirs');

    const workflow = await request(app)
      .post(`/api/workspaces/${mine.workspaceId}/workflows`)
      .set('Cookie', mine.cookie)
      .send({
        name: 'Private',
        approvalPolicy: 'nothing',
        steps: [{ id: 's1', kind: 'generate', description: 'x', input: 'x' }],
      });
    const canvas = await request(app)
      .post(`/api/workspaces/${mine.workspaceId}/canvases`)
      .set('Cookie', mine.cookie)
      .send({ title: 'Private plan' });

    // Every one of these answers 404 rather than 403: existence is not
    // disclosed to someone who may not see it.
    for (const path of [
      `/api/workspaces/${theirs.workspaceId}/workflows/${workflow.body.data.id}`,
      `/api/workspaces/${theirs.workspaceId}/canvases/${canvas.body.data.id}`,
    ]) {
      const res = await request(app).get(path).set('Cookie', theirs.cookie);
      expect(res.status).toBe(404);
    }

    // And their own lists are simply empty, not filtered-looking.
    const lists = await Promise.all(
      ['workflows', 'canvases', 'agents'].map((r) =>
        request(app).get(`/api/workspaces/${theirs.workspaceId}/${r}`).set('Cookie', theirs.cookie),
      ),
    );
    for (const list of lists) expect(list.body.data).toEqual([]);
  });
});
