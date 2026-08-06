/**
 * Binding `tool.execute` — the only capability that acts OUTSIDE Synora,
 * and the first whose risk class means it can only be reached by going
 * through the approval gate.
 *
 * NO OUTBOUND NETWORK IN THIS FILE, BY CONSTRUCTION. Every tool created
 * here sets `requiresApproval`, so the real service creates a PENDING
 * execution and never calls its async runner. That is not a convenience:
 * a test that fired real webhooks at a third party to prove an
 * authorization rule would be reaching outside Synora to check something
 * internal. The branch where a tool runs immediately is therefore exercised
 * in production rather than here, and that limit is stated rather than
 * papered over.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';

vi.mock('../../ai/resolver', () => ({
  resolveTextGenerationProvider: vi.fn(async () => {
    throw new Error('no provider configured (test)');
  }),
  resolveProvider: vi.fn(async () => {
    throw new Error('no provider configured (test)');
  }),
}));
import type { Express } from 'express';
import { prisma } from '@synora/database';
import { createApp } from '../../app';
import { initConfig } from '../../config';

describe('tool.execute bound into the command layer', () => {
  let app: Express;
  let ownerCookie: string;
  let ownerId: string;
  let workspaceId: string;
  const testEmails: string[] = [];
  const testWorkspaceIds: string[] = [];

  async function register(prefix: string): Promise<string> {
    const email = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    testEmails.push(email);
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email, password: 'a-valid-password-123' });
    const setCookie = res.headers['set-cookie'];
    const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
    return cookies.map((c) => c.split(';')[0]).join('; ');
  }

  async function makeTool(name: string, inputSchema: object) {
    return prisma.toolDefinition.create({
      data: {
        workspaceId,
        name,
        displayName: name,
        category: 'UTILITY',
        description: 'test tool',
        type: 'HTTP',
        config: { url: 'https://example.invalid/hook', method: 'POST' },
        inputSchema,
        // Keeps this file hermetic — see the header.
        requiresApproval: true,
        createdBy: ownerId,
      },
    });
  }

  function execute(command: string) {
    return request(app)
      .post(`/api/command/${workspaceId}/execute`)
      .set('Cookie', ownerCookie)
      .send({ command });
  }

  function decide(executionId: string, decision: 'approved' | 'rejected') {
    return request(app)
      .post(`/api/command/${workspaceId}/executions/${executionId}/decision`)
      .set('Cookie', ownerCookie)
      .send({ decision });
  }

  beforeAll(async () => {
    const config = await initConfig();
    app = createApp(config);
    ownerCookie = await register('toolcmd-owner');
    const me = await request(app).get('/api/users/me').set('Cookie', ownerCookie);
    ownerId = me.body.data.id;
    const workspace = await request(app)
      .post('/api/workspaces')
      .set('Cookie', ownerCookie)
      .send({ name: `Tool Command ${Date.now()}` });
    workspaceId = workspace.body.data.id;
    testWorkspaceIds.push(workspaceId);
  });

  afterAll(async () => {
    await prisma.commandPlan.deleteMany({ where: { workspaceId: { in: testWorkspaceIds } } });
    await prisma.commandExecution.deleteMany({ where: { workspaceId: { in: testWorkspaceIds } } });
    if (testWorkspaceIds.length > 0) {
      await prisma.workspace.deleteMany({ where: { id: { in: testWorkspaceIds } } });
    }
    if (testEmails.length > 0) {
      await prisma.user.deleteMany({ where: { email: { in: testEmails } } });
    }
  });

  it('still stops at approval — binding a capability never bypasses its gate', async () => {
    await makeTool('Alpha Deploy', {});
    const res = await execute('run the Alpha Deploy tool').expect(200);
    expect(res.body.data.state).toBe('waiting-approval');
    expect(res.body.data.executed).toBe(false);
    // Nothing was created before a person said yes.
    expect(await prisma.toolExecution.count({ where: { workspaceId } })).toBe(0);
  });

  it('runs the real service once approved, and never claims the tool finished', async () => {
    const tool = await makeTool('Beta Report', {});
    const asked = await execute('run the Beta Report tool').expect(200);
    const decided = await decide(asked.body.data.executionId, 'approved').expect(200);

    expect(decided.body.data.state).toBe('completed');

    // A REAL tool execution row now exists, against the real service.
    const executions = await prisma.toolExecution.findMany({ where: { toolId: tool.id } });
    expect(executions).toHaveLength(1);

    // THE HONESTY PROPERTY. This tool carries its own approval gate, so the
    // execution is PENDING: approving the COMMAND allowed the request, it
    // did not authorise the tool to run. The message must lead with that,
    // because a person who reads "approved" as "it ran" finds out otherwise
    // only from the consequences.
    expect(executions[0].status).toBe('PENDING');
    expect(decided.body.data.message).toContain('has NOT run yet');
    expect(decided.body.data.result.finished).toBe(false);
  });

  it('asks for required input instead of inventing it', async () => {
    // The worst possible guess in this codebase is a made-up payload for
    // something that contacts an outside system.
    await makeTool('Gamma Webhook', {
      type: 'object',
      required: ['targetEnvironment', 'version'],
    });
    const asked = await execute('run the Gamma Webhook tool').expect(200);
    const decided = await decide(asked.body.data.executionId, 'approved').expect(200);

    expect(decided.body.data.state).toBe('needs-input');
    expect(decided.body.data.message).toContain('targetEnvironment');
    expect(decided.body.data.message).toContain('version');
    // Nothing was sent anywhere.
    const tool = await prisma.toolDefinition.findFirst({ where: { name: 'Gamma Webhook' } });
    expect(await prisma.toolExecution.count({ where: { toolId: tool!.id } })).toBe(0);
  });

  it('asks which tool was meant rather than picking one', async () => {
    await makeTool('Delta Sync Primary', {});
    await makeTool('Delta Sync Secondary', {});
    const asked = await execute('run the Delta Sync tool').expect(200);
    const decided = await decide(asked.body.data.executionId, 'approved').expect(200);

    expect(decided.body.data.state).toBe('needs-input');
    expect(decided.body.data.message).toMatch(/which tool/i);
  });

  it('does nothing when the tool is rejected', async () => {
    const tool = await makeTool('Epsilon Purge', {});
    const asked = await execute('run the Epsilon Purge tool').expect(200);
    const decided = await decide(asked.body.data.executionId, 'rejected').expect(200);

    expect(decided.body.data.state).toBe('rejected');
    expect(await prisma.toolExecution.count({ where: { toolId: tool.id } })).toBe(0);
  });

  it('completes the whole chain: a PLAN pauses, is approved, and resumes', async () => {
    // THE PATH THAT DID NOT EXIST BEFORE THIS BINDING. Until now no
    // approval-requiring capability was bound, so an approved plan step
    // could never complete and a plan could never resume over HTTP.
    const tool = await makeTool('Zeta Publish', {});
    const plan = await request(app)
      .post(`/api/command/${workspaceId}/plan/execute`)
      .set('Cookie', ownerCookie)
      .send({
        command: 'run the Zeta Publish tool and show me what has recently happened here',
      })
      .expect(200);

    expect(plan.body.data.status).toBe('waiting-approval');
    expect(plan.body.data.steps[1].state).toBe('skipped');

    const pending = await prisma.commandExecution.findFirst({
      where: { planId: plan.body.data.planId, planStepIndex: 1 },
    });
    const decided = await decide(pending!.id, 'approved').expect(200);

    // The plan continued on its own, all the way to done.
    expect(decided.body.data.plan).toBeDefined();
    expect(decided.body.data.plan.status).toBe('completed');
    const stepTwo = await prisma.commandPlanStep.findFirst({
      where: { planId: plan.body.data.planId, index: 2 },
    });
    expect(stepTwo!.state).toBe('completed');

    // And the tool step really reached the real service.
    expect(await prisma.toolExecution.count({ where: { toolId: tool.id } })).toBe(1);
  });
});
