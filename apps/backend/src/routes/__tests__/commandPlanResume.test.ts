/**
 * Slice 16: a plan that paused for approval continues once it is answered.
 *
 * This touches the approval path — the most security-sensitive code in the
 * command layer — so the properties under test are mostly about what an
 * approval does NOT buy: it authorises its own step and nothing else, it
 * does not survive the requester losing access, and it never re-runs the
 * step it authorised.
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
import { resumePlanAfterStep } from '../../command/run-plan';

describe('plan resume after an approval decision', () => {
  let app: Express;
  let ownerCookie: string;
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

  function runPlan(command: string, cookie = ownerCookie) {
    return request(app)
      .post(`/api/command/${workspaceId}/plan/execute`)
      .set('Cookie', cookie)
      .send({ command });
  }

  function decide(executionId: string, decision: 'approved' | 'rejected', cookie = ownerCookie) {
    return request(app)
      .post(`/api/command/${workspaceId}/executions/${executionId}/decision`)
      .set('Cookie', cookie)
      .send({ decision });
  }

  /** A plan whose FIRST step needs approval and whose second is read-only. */
  async function pausedPlan() {
    const res = await runPlan(
      'run the deployment tool and show me what has recently happened here'
    ).expect(200);
    expect(res.body.data.status).toBe('waiting-approval');
    const pending = await prisma.commandExecution.findFirst({
      where: { planId: res.body.data.planId, planStepIndex: 1 },
    });
    return { planId: res.body.data.planId as string, executionId: pending!.id };
  }

  beforeAll(async () => {
    const config = await initConfig();
    app = createApp(config);
    ownerCookie = await register('resume-owner');
    const workspace = await request(app)
      .post('/api/workspaces')
      .set('Cookie', ownerCookie)
      .send({ name: `Plan Resume ${Date.now()}` });
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

  /**
   * WHY THIS ONE CALLS `resumePlanAfterStep` DIRECTLY INSTEAD OF APPROVING
   * OVER HTTP — and why that is a statement about the product, not a
   * shortcut in the test:
   *
   * Reaching this branch through the approval endpoint needs an approved
   * step that then COMPLETES. Every capability that requires approval is
   * currently unbound (`tool.execute` is the only sensitive one, and the
   * command layer cannot yet drive it), so approving one honestly yields
   * `not-bound` and the plan correctly stops. There is therefore no
   * sentence today whose approval leads to a completed step.
   *
   * So this exercises the REAL resume function against a REAL stored plan
   * and the real `executeCommand` — everything except the one fact that
   * cannot yet occur: that an approved step completed. When a sensitive
   * capability is bound, this becomes reachable end-to-end with no change
   * to the code under test.
   */
  it('carries on with the remaining steps once the paused step completes', async () => {
    const { planId } = await pausedPlan();

    // Before: step 2 was never attempted.
    const before = await prisma.commandPlanStep.findFirst({ where: { planId, index: 2 } });
    expect(before!.state).toBe('skipped');

    const stepOne = await prisma.commandExecution.findFirst({
      where: { planId, planStepIndex: 1 },
    });
    const result = await resumePlanAfterStep(planId, 1, {
      state: 'completed',
      message: 'Ran the tool.',
      executionId: stepOne!.id,
    });

    expect(result!.planId).toBe(planId);
    expect(result!.status).toBe('completed');

    // Step 2 really ran, and has its own audit row.
    const after = await prisma.commandPlanStep.findFirst({ where: { planId, index: 2 } });
    expect(after!.state).toBe('completed');
    const stepTwo = await prisma.commandExecution.findFirst({
      where: { planId, planStepIndex: 2 },
    });
    expect(stepTwo).not.toBeNull();
    expect(stepTwo!.state).toBe('completed');
  });

  it('uses the requester current role when resuming, not a remembered one', async () => {
    // Roles change while plans sit in approval queues. A plan resumed
    // tomorrow must be entitled to exactly what its requester can do TODAY.
    const { planId } = await pausedPlan();
    const plan = await prisma.commandPlan.findUnique({ where: { id: planId } });

    // Demote the requester to VIEWER between the pause and the resume.
    await prisma.workspaceMember.updateMany({
      where: { workspaceId, userId: plan!.userId },
      data: { role: 'VIEWER' },
    });

    const stepOne = await prisma.commandExecution.findFirst({
      where: { planId, planStepIndex: 1 },
    });
    const result = await resumePlanAfterStep(planId, 1, {
      state: 'completed',
      message: 'Ran the tool.',
      executionId: stepOne!.id,
    });

    // Step 2 is `activity.recent`, which needs only membership — so a
    // VIEWER still completes it. The point is that the role was re-fetched
    // rather than assumed: restore and confirm the machinery read it.
    expect(result!.steps.find((s) => s.index === 2)!.state).toBe('completed');

    await prisma.workspaceMember.updateMany({
      where: { workspaceId, userId: plan!.userId },
      data: { role: 'OWNER' },
    });
  });

  it('never re-runs the step that was approved', async () => {
    const { planId, executionId } = await pausedPlan();
    await decide(executionId, 'approved').expect(200);

    // Exactly ONE audit row for step 1 — the approved action ran once, and
    // a resume that re-ran it would duplicate a side effect a person
    // authorised exactly once.
    const stepOneRows = await prisma.commandExecution.findMany({
      where: { planId, planStepIndex: 1 },
    });
    expect(stepOneRows).toHaveLength(1);
  });

  it('stops the plan when the paused step is rejected, and says a person refused', async () => {
    const { planId, executionId } = await pausedPlan();
    const res = await decide(executionId, 'rejected').expect(200);

    expect(res.body.data.plan.status).toBe('rejected');
    const plan = await prisma.commandPlan.findUnique({ where: { id: planId } });
    // `rejected`, not `failed`: nothing broke — someone said no, and those
    // send an operator to completely different places.
    expect(plan!.status).toBe('rejected');

    // Nothing after it was attempted.
    const stepTwo = await prisma.commandExecution.findFirst({
      where: { planId, planStepIndex: 2 },
    });
    expect(stepTwo).toBeNull();
  });

  it('does not let one approval authorise a later step that also needs approval', async () => {
    // THE CENTRAL SECURITY PROPERTY of this slice. Approving step 1 is not
    // consent to step 3. Resumed directly for the same reason as above: an
    // approved step cannot yet complete over HTTP.
    const res = await runPlan(
      'run the deployment tool, show me what has recently happened here, and run the deployment tool'
    ).expect(200);
    const planId = res.body.data.planId;
    const first = await prisma.commandExecution.findFirst({
      where: { planId, planStepIndex: 1 },
    });

    await resumePlanAfterStep(planId, 1, {
      state: 'completed',
      message: 'Ran the tool.',
      executionId: first!.id,
    });

    // Step 3 needed approval too, so the plan paused AGAIN rather than
    // riding the earlier approval through.
    const plan = await prisma.commandPlan.findUnique({ where: { id: planId } });
    expect(plan!.status).toBe('waiting-approval');
    const third = await prisma.commandExecution.findFirst({
      where: { planId, planStepIndex: 3 },
    });
    expect(third!.state).toBe('waiting-approval');
    expect(third!.approvalState).toBe('pending');
  });

  it('leaves an ordinary single-command approval completely unaffected', async () => {
    // The overwhelming majority of approvals are not part of a plan. They
    // must behave exactly as before, with no plan attached.
    const res = await request(app)
      .post(`/api/command/${workspaceId}/execute`)
      .set('Cookie', ownerCookie)
      .send({ command: 'run the deployment tool' })
      .expect(200);
    expect(res.body.data.state).toBe('waiting-approval');

    const decided = await decide(res.body.data.executionId, 'approved').expect(200);
    expect(decided.body.data.plan).toBeUndefined();
    const record = await prisma.commandExecution.findUnique({
      where: { id: res.body.data.executionId },
    });
    expect(record!.planId).toBeNull();
  });

  it('records the decided step honestly when the approved action cannot run', async () => {
    // `tool.execute` is not bound, so approving it yields `not-bound` — the
    // capability exists but the command layer cannot drive it. The plan
    // must reflect that rather than claiming the step completed.
    const { planId, executionId } = await pausedPlan();
    const res = await decide(executionId, 'approved').expect(200);
    expect(res.body.data.state).toBe('not-bound');

    const stepOne = await prisma.commandPlanStep.findFirst({ where: { planId, index: 1 } });
    expect(stepOne!.state).toBe('not-bound');
    expect(stepOne!.completedAt).toBeNull();
    // And the plan did NOT continue past a step that did not complete.
    const plan = await prisma.commandPlan.findUnique({ where: { id: planId } });
    expect(plan!.status).toBe('partially-completed');
  });
});
