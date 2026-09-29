/**
 * Slice 4: the approval action.
 *
 * An approval system is only worth the attacks it survives. Almost every
 * test here is an attempt to make a "yes" mean more than it should — used
 * twice, used late, used by the wrong person, or used to run something other
 * than what was approved. The happy path is three tests; the rest is the
 * reason the happy path can be trusted.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { prisma } from '@synora/database';
import { createApp } from '../../app';
import { initConfig } from '../../config';

describe('POST /api/command/:workspaceId/executions/:executionId/decision', () => {
  let app: Express;
  let ownerCookie: string;
  let outsiderCookie: string;
  let ownerId: string;
  let workspaceId: string;
  const testEmails: string[] = [];
  const testWorkspaceIds: string[] = [];

  async function register(prefix: string): Promise<{ cookie: string; id: string }> {
    const email = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    testEmails.push(email);
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email, password: 'a-valid-password-123' });
    const setCookie = res.headers['set-cookie'];
    const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
    return {
      cookie: cookies.map((c) => c.split(';')[0]).join('; '),
      id: res.body.data.user.id,
    };
  }

  /** Issues a real sensitive command and returns the pending record id. */
  async function pendingExecution(command = 'Run the deployment tool'): Promise<string> {
    const res = await request(app)
      .post(`/api/command/${workspaceId}/execute`)
      .set('Cookie', ownerCookie)
      .send({ command })
      .expect(200);
    expect(res.body.data.state).toBe('waiting-approval');
    return res.body.data.executionId as string;
  }

  beforeAll(async () => {
    const config = await initConfig();
    app = createApp(config);

    const owner = await register('appr-owner');
    ownerCookie = owner.cookie;
    ownerId = owner.id;
    outsiderCookie = (await register('appr-outsider')).cookie;

    const workspace = await request(app)
      .post('/api/workspaces')
      .set('Cookie', ownerCookie)
      .send({ name: `Command Approve ${Date.now()}` });
    workspaceId = workspace.body.data.id;
    testWorkspaceIds.push(workspaceId);
  });

  afterAll(async () => {
    await prisma.commandExecution.deleteMany({ where: { workspaceId: { in: testWorkspaceIds } } });
    if (testWorkspaceIds.length > 0) {
      await prisma.workspace.deleteMany({ where: { id: { in: testWorkspaceIds } } });
    }
    if (testEmails.length > 0) {
      await prisma.user.deleteMany({ where: { email: { in: testEmails } } });
    }
  });

  describe('a yes actually means yes', () => {
    it('records the approval as a fact even when the action cannot proceed', async () => {
      const executionId = await pendingExecution('Run the onboarding tool');

      const res = await request(app)
        .post(`/api/command/${workspaceId}/executions/${executionId}/decision`)
        .set('Cookie', ownerCookie)
        .send({ decision: 'approved' })
        .expect(200);

      // UPDATED when `tool.execute` was bound. This previously asserted
      // `not-bound`, which was the honest answer while no sensitive
      // capability had an executor. Now one does, and this workspace simply
      // has no tools — so the honest answer is `needs-input`, naming what is
      // missing. The PROPERTY under test is unchanged and is the reason this
      // test exists: a yes is recorded as a fact even when the action cannot
      // proceed, and the state is the specific true reason rather than
      // "completed" (a lie) or "failed" (blaming a bug that does not exist).
      expect(res.body.data.decision).toBe('approved');
      expect(res.body.data.state).toBe('needs-input');
      expect(res.body.data.executed).toBe(false);

      const record = await prisma.commandExecution.findUnique({ where: { id: executionId } });
      expect(record?.approvalState).toBe('approved');
      expect(record?.approvedBy).toBe(ownerId);
      expect(record?.approvedAt).not.toBeNull();
      expect(record?.rejectedBy).toBeNull();
    });

    it('a rejection records the refusal and runs nothing', async () => {
      const executionId = await pendingExecution('Run the payroll tool');

      const res = await request(app)
        .post(`/api/command/${workspaceId}/executions/${executionId}/decision`)
        .set('Cookie', ownerCookie)
        .send({ decision: 'rejected', reason: 'wrong environment' })
        .expect(200);

      expect(res.body.data.state).toBe('rejected');
      expect(res.body.data.executed).toBe(false);
      expect(res.body.data.result).toBeUndefined();

      const record = await prisma.commandExecution.findUnique({ where: { id: executionId } });
      expect(record?.approvalState).toBe('rejected');
      expect(record?.rejectedBy).toBe(ownerId);
      expect(record?.rejectionReason).toBe('wrong environment');
      // Rejection is recorded in its own columns — "who approved" and "who
      // refused" must never be answered by the same field.
      expect(record?.approvedBy).toBeNull();
      expect(record?.completedAt).not.toBeNull();
    });

    it('lists what is waiting so an approval can actually be found', async () => {
      const executionId = await pendingExecution('Run the reporting tool');

      const res = await request(app)
        .get(`/api/command/${workspaceId}/executions?pending=true`)
        .set('Cookie', ownerCookie)
        .expect(200);

      const ids = (res.body.data.items as { id: string }[]).map((i) => i.id);
      expect(ids).toContain(executionId);
    });
  });

  describe('an approval cannot be used twice', () => {
    it('refuses a replayed decision instead of acting again', async () => {
      const executionId = await pendingExecution('Run the billing tool');

      const first = await request(app)
        .post(`/api/command/${workspaceId}/executions/${executionId}/decision`)
        .set('Cookie', ownerCookie)
        .send({ decision: 'rejected' })
        .expect(200);
      expect(first.body.data.state).toBe('rejected');

      // The identical request again. Nothing may happen a second time.
      const replay = await request(app)
        .post(`/api/command/${workspaceId}/executions/${executionId}/decision`)
        .set('Cookie', ownerCookie)
        .send({ decision: 'rejected' })
        .expect(200);

      expect(replay.body.data.decision).toBe('refused');
      expect(replay.body.data.executed).toBe(false);
      expect(replay.body.data.message).toMatch(/already decided/i);
    });

    it('lets exactly one of two simultaneous decisions win', async () => {
      const executionId = await pendingExecution('Run the migration tool');

      // Both requests pass every check at the same instant; the database
      // compare-and-set is what makes only one of them count.
      const [a, b] = await Promise.all([
        request(app)
          .post(`/api/command/${workspaceId}/executions/${executionId}/decision`)
          .set('Cookie', ownerCookie)
          .send({ decision: 'rejected' }),
        request(app)
          .post(`/api/command/${workspaceId}/executions/${executionId}/decision`)
          .set('Cookie', ownerCookie)
          .send({ decision: 'rejected' }),
      ]);

      const decisions = [a.body.data.decision, b.body.data.decision].sort();
      expect(decisions).toEqual(['refused', 'rejected']);
    });
  });

  describe('an approval goes stale', () => {
    it('refuses a decision past the deadline and marks the record expired', async () => {
      const executionId = await pendingExecution('Run the archive tool');

      // Age the record past its own stored deadline. The deadline is stored
      // per-record precisely so this is the thing being enforced.
      await prisma.commandExecution.update({
        where: { id: executionId },
        data: { approvalExpiresAt: new Date(Date.now() - 1_000) },
      });

      const res = await request(app)
        .post(`/api/command/${workspaceId}/executions/${executionId}/decision`)
        .set('Cookie', ownerCookie)
        .send({ decision: 'approved' })
        .expect(200);

      expect(res.body.data.decision).toBe('refused');
      expect(res.body.data.message).toMatch(/in time/i);

      const record = await prisma.commandExecution.findUnique({ where: { id: executionId } });
      expect(record?.state).toBe('expired');
      expect(record?.approvalState).toBe('expired');
    });

    it('reclaims a claim abandoned by a crashed process, rather than wedging forever', async () => {
      const executionId = await pendingExecution('Run the indexing tool');

      // Exactly the state a process crash leaves behind: the claim was
      // taken, the decision never finished. Without the deadline covering
      // `deciding` too, this record could never be answered again.
      await prisma.commandExecution.update({
        where: { id: executionId },
        data: { approvalState: 'deciding', approvalExpiresAt: new Date(Date.now() - 1_000) },
      });

      const res = await request(app)
        .post(`/api/command/${workspaceId}/executions/${executionId}/decision`)
        .set('Cookie', ownerCookie)
        .send({ decision: 'approved' })
        .expect(200);

      expect(res.body.data.decision).toBe('refused');
      const record = await prisma.commandExecution.findUnique({ where: { id: executionId } });
      expect(record?.approvalState).toBe('expired');
      expect(record?.state).toBe('expired');
    });

    it('tells a second approver that a decision is in flight, not that it is finished', async () => {
      const executionId = await pendingExecution('Run the sync tool');
      await prisma.commandExecution.update({
        where: { id: executionId },
        data: { approvalState: 'deciding' },
      });

      const res = await request(app)
        .post(`/api/command/${workspaceId}/executions/${executionId}/decision`)
        .set('Cookie', ownerCookie)
        .send({ decision: 'approved' })
        .expect(200);

      // "Being decided right now" and "already decided" are different facts.
      expect(res.body.data.message).toMatch(/being decided right now/i);
      expect(res.body.data.executed).toBe(false);
    });

    it('reports an overdue pending item as expired in the list, before it converges', async () => {
      const executionId = await pendingExecution('Run the cleanup tool');
      await prisma.commandExecution.update({
        where: { id: executionId },
        data: { approvalExpiresAt: new Date(Date.now() - 1_000) },
      });

      const res = await request(app)
        .get(`/api/command/${workspaceId}/executions`)
        .set('Cookie', ownerCookie)
        .expect(200);

      const item = (res.body.data.items as { id: string; state: string }[]).find(
        (i) => i.id === executionId
      );
      // The stored row still says waiting-approval; showing that to a person
      // would invite a click that cannot work.
      expect(item?.state).toBe('expired');
    });
  });

  describe('the approved action is the executed action', () => {
    it('refuses when the record no longer resolves to what was approved', async () => {
      const executionId = await pendingExecution('Run the analytics tool');

      // Someone edits the stored command to point at something else — the
      // exact "modified after approval" attack. The capability recorded at
      // request time no longer matches what the text now resolves to.
      await prisma.commandExecution.update({
        where: { id: executionId },
        data: { commandText: 'Find everything about salaries' },
      });

      const res = await request(app)
        .post(`/api/command/${workspaceId}/executions/${executionId}/decision`)
        .set('Cookie', ownerCookie)
        .send({ decision: 'approved' })
        .expect(200);

      expect(res.body.data.decision).toBe('refused');
      expect(res.body.data.executed).toBe(false);
      expect(res.body.data.message).toMatch(/has changed since it was requested/i);

      // And critically: the search it was swapped to must not have run.
      const record = await prisma.commandExecution.findUnique({ where: { id: executionId } });
      expect(record?.state).not.toBe('completed');
      expect(record?.resultSummary).toBeNull();
    });

    it('ignores anything the approver sends about what to run', async () => {
      const executionId = await pendingExecution('Run the export tool');

      // The body has no field that selects an action, so supplying one must
      // change nothing. This pins that the schema stays closed.
      const res = await request(app)
        .post(`/api/command/${workspaceId}/executions/${executionId}/decision`)
        .set('Cookie', ownerCookie)
        .send({
          decision: 'rejected',
          capabilityId: 'conversation.create',
          command: 'Create a conversation',
          riskClass: 'read-only',
        })
        .expect(200);

      expect(res.body.data.state).toBe('rejected');
      const record = await prisma.commandExecution.findUnique({ where: { id: executionId } });
      expect(record?.capabilityId).toBe('tool.execute');
      expect(record?.riskClass).toBe('sensitive');
    });
  });

  describe('authority is checked, not assumed', () => {
    it('answers 404, not 403, for a record in a workspace the caller is not in', async () => {
      const executionId = await pendingExecution('Run the audit tool');

      await request(app)
        .post(`/api/command/${workspaceId}/executions/${executionId}/decision`)
        .set('Cookie', outsiderCookie)
        .send({ decision: 'approved' })
        .expect(404);
    });

    it('cannot decide a record belonging to a different workspace', async () => {
      const executionId = await pendingExecution('Run the deploy tool');

      const other = await request(app)
        .post('/api/workspaces')
        .set('Cookie', outsiderCookie)
        .send({ name: `Other WS ${Date.now()}` });
      const otherId = other.body.data.id;
      testWorkspaceIds.push(otherId);

      // A real record id, presented under a workspace the approver DOES
      // belong to. The record must be invisible there — an id from elsewhere
      // must not become a probe for what exists elsewhere.
      await request(app)
        .post(`/api/command/${otherId}/executions/${executionId}/decision`)
        .set('Cookie', outsiderCookie)
        .send({ decision: 'approved' })
        .expect(404);

      const record = await prisma.commandExecution.findUnique({ where: { id: executionId } });
      expect(record?.approvalState).toBe('pending');
    });

    it('requires authentication', async () => {
      const executionId = await pendingExecution('Run the restore tool');
      await request(app)
        .post(`/api/command/${workspaceId}/executions/${executionId}/decision`)
        .send({ decision: 'approved' })
        .expect(401);
    });

    it('does not run when the requester has lost the permission since asking', async () => {
      const executionId = await pendingExecution('Run the provisioning tool');

      // The requester is demoted while the request sits in the queue. The
      // action belongs to them, so their CURRENT permission is what counts —
      // approving must not resurrect an entitlement they no longer have.
      await prisma.workspaceMember.updateMany({
        where: { workspaceId, userId: ownerId },
        data: { role: 'VIEWER' },
      });

      const res = await request(app)
        .post(`/api/command/${workspaceId}/executions/${executionId}/decision`)
        .set('Cookie', ownerCookie)
        .send({ decision: 'approved' })
        .expect(200);

      expect(res.body.data.decision).toBe('refused');
      expect(res.body.data.executed).toBe(false);

      await prisma.workspaceMember.updateMany({
        where: { workspaceId, userId: ownerId },
        data: { role: 'OWNER' },
      });
    });
  });
});
