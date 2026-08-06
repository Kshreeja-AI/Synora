/**
 * Undo — the first time the command layer can take something back.
 *
 * `reversible` had been a risk class the layer reasoned with: it is why
 * creating a conversation runs without an approval gate. Nothing could
 * actually reverse anything, so the word was a claim about what a person
 * could go and do by hand elsewhere, wearing the costume of a property of
 * the action.
 *
 * MOST OF THIS FILE ASSERTS WHAT UNDO REFUSES. An undo that acts twice, or
 * acts on something that never happened, or acts for someone who may no
 * longer act, is worse than no undo at all — each one is a deletion nobody
 * asked for, and the person finds out from the consequences.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';

/** NO NETWORK — the same pin the other command route tests use. */
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

describe('POST /api/command/:workspaceId/executions/:executionId/undo', () => {
  let app: Express;
  let ownerCookie: string;
  let ownerId: string;
  let outsiderCookie: string;
  let workspaceId: string;
  let otherWorkspaceId: string;
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

  function execute(command: string, cookie = ownerCookie) {
    return request(app)
      .post(`/api/command/${workspaceId}/execute`)
      .set('Cookie', cookie)
      .send({ command });
  }

  function undo(executionId: string, cookie = ownerCookie, ws = workspaceId) {
    return request(app)
      .post(`/api/command/${ws}/executions/${executionId}/undo`)
      .set('Cookie', cookie)
      .send({});
  }

  beforeAll(async () => {
    const config = await initConfig();
    app = createApp(config);

    ownerCookie = await register('undo-owner');
    outsiderCookie = await register('undo-outsider');
    const me = await request(app).get('/api/users/me').set('Cookie', ownerCookie);
    ownerId = me.body.data.id;

    const workspace = await request(app)
      .post('/api/workspaces')
      .set('Cookie', ownerCookie)
      .send({ name: `Undo ${Date.now()}` });
    workspaceId = workspace.body.data.id;
    testWorkspaceIds.push(workspaceId);

    const other = await request(app)
      .post('/api/workspaces')
      .set('Cookie', outsiderCookie)
      .send({ name: `Undo Other ${Date.now()}` });
    otherWorkspaceId = other.body.data.id;
    testWorkspaceIds.push(otherWorkspaceId);
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

  describe('reversing something that really happened', () => {
    it('removes the conversation the command created, and says so', async () => {
      const created = await execute('Create a conversation about undo testing').expect(200);
      expect(created.body.data.state).toBe('completed');
      const executionId = created.body.data.executionId as string;
      const conversationId = created.body.data.result.id as string;

      // The undo target came from the executor that did the work, not from
      // a guess about what `conversation.create` probably makes.
      const before = await prisma.commandExecution.findUnique({ where: { id: executionId } });
      expect(before!.undoKind).toBe('conversation');
      expect(before!.undoTargetId).toBe(conversationId);

      const res = await undo(executionId).expect(200);
      expect(res.body.data.undone).toBe(true);
      expect(res.body.data.kind).toBe('conversation');

      // REALLY gone, checked in the database rather than believed from the
      // response. A route that reports success while nothing changed is the
      // precise failure this whole layer exists to avoid.
      const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
      expect(conversation!.status).toBe('DELETED');

      // And the reversal is itself recorded. "Created then removed" and
      // "never created" are different histories, and an audit trail that
      // cannot tell them apart is not an audit trail.
      const after = await prisma.commandExecution.findUnique({ where: { id: executionId } });
      expect(after!.undoneAt).not.toBeNull();
      expect(after!.undoneBy).toBe(ownerId);
    });

    it('removes the schedule the command created, durably', async () => {
      const workflow = await request(app)
        .post(`/api/workspaces/${workspaceId}/workflows`)
        .set('Cookie', ownerCookie)
        .send({
          name: 'Undo Digest',
          steps: [{ id: 's1', kind: 'generate', description: 'Summarize', input: 'summarize' }],
          limits: {},
        })
        .expect(201);
      const workflowId = workflow.body.data.id as string;

      const scheduled = await execute(
        'Schedule the Undo Digest workflow every day at 9am Asia/Kolkata'
      ).expect(200);
      expect(scheduled.body.data.state).toBe('completed');
      const executionId = scheduled.body.data.executionId as string;

      const listed = await request(app)
        .get(`/api/workspaces/${workspaceId}/workflows/${workflowId}/schedules`)
        .set('Cookie', ownerCookie)
        .expect(200);
      expect(listed.body.data.items ?? listed.body.data).toHaveLength(1);

      const res = await undo(executionId).expect(200);
      expect(res.body.data.undone).toBe(true);
      expect(res.body.data.kind).toBe('schedule');

      const afterList = await request(app)
        .get(`/api/workspaces/${workspaceId}/workflows/${workflowId}/schedules`)
        .set('Cookie', ownerCookie)
        .expect(200);
      expect(afterList.body.data.items ?? afterList.body.data).toHaveLength(0);
    });
  });

  describe('what undo refuses', () => {
    it('refuses a second undo rather than deleting something else', async () => {
      const created = await execute('Create a conversation about double undo').expect(200);
      const executionId = created.body.data.executionId as string;

      await undo(executionId).expect(200);
      const second = await undo(executionId).expect(200);

      expect(second.body.data.undone).toBe(false);
      expect(second.body.data.reason).toBe('already-undone');
      // Says nothing happened, in words. A silent success on the second
      // press is how a person concludes the first one did not work.
      expect(second.body.data.message).toMatch(/nothing was done again/i);
    });

    it('refuses an action Synora cannot reverse, instead of improvising one', async () => {
      // A search completed and changed nothing, so it has no undo target.
      const searched = await execute('Find my notes about pricing').expect(200);
      expect(searched.body.data.state).toBe('completed');

      const res = await undo(searched.body.data.executionId).expect(200);
      expect(res.body.data.undone).toBe(false);
      expect(res.body.data.reason).toBe('not-reversible');
      expect(res.body.data.message).toMatch(/nothing was changed/i);
    });

    it('refuses to undo something that never ran', async () => {
      // Nothing was sent, so there is nothing to take back. Offering undo
      // here would imply the action had had an effect.
      const blocked = await execute('Email the quarterly report to the board').expect(200);
      expect(blocked.body.data.state).not.toBe('completed');

      const res = await undo(blocked.body.data.executionId).expect(200);
      expect(res.body.data.undone).toBe(false);
      expect(res.body.data.reason).toBe('not-completed');
      expect(res.body.data.message).toMatch(/nothing to undo/i);
    });

    it('re-checks permission at undo time, not at the time of the original action', async () => {
      const created = await execute('Create a conversation about role changes').expect(200);
      const executionId = created.body.data.executionId as string;
      const conversationId = created.body.data.result.id as string;

      // Demoted between doing and undoing. Having been allowed to create
      // something is not standing permission to remove it later — and undo
      // must not become the one path that ignores a role change.
      await prisma.workspaceMember.updateMany({
        where: { workspaceId, userId: ownerId },
        data: { role: 'VIEWER' },
      });

      const res = await undo(executionId);
      expect(res.status).toBe(403);

      // The conversation survived the refusal. A refusal that had already
      // deleted the thing would be the worst possible kind.
      const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
      expect(conversation!.status).not.toBe('DELETED');

      await prisma.workspaceMember.updateMany({
        where: { workspaceId, userId: ownerId },
        data: { role: 'OWNER' },
      });
    });

    it('tells a non-member nothing — not even that the execution exists', async () => {
      const created = await execute('Create a conversation about outsiders').expect(200);
      const executionId = created.body.data.executionId as string;

      // 404, never 403: a distinguishable "forbidden" would confirm that
      // this id, and this workspace, are real.
      await undo(executionId, outsiderCookie).expect(404);

      const conversation = await prisma.conversation.findUnique({
        where: { id: created.body.data.result.id as string },
      });
      expect(conversation!.status).not.toBe('DELETED');
    });

    it('will not reveal an execution from another workspace, reversible or not', async () => {
      // A SEARCH, deliberately, and this choice is the whole test. An
      // earlier version used a conversation and passed even with the
      // workspace scoping removed — the reversal itself was refused
      // downstream by `conversationService`, so the endpoint answered 404
      // for a reason that had nothing to do with scoping. A search never
      // reaches that service: it stops at "not reversible", which without
      // scoping would be a 200 telling an outsider that this execution
      // exists and what state it is in. That is the leak this guards.
      const searched = await execute('Find my notes about scoping').expect(200);
      expect(searched.body.data.state).toBe('completed');
      const executionId = searched.body.data.executionId as string;

      // The outsider owns `otherWorkspaceId`, so they pass that workspace's
      // access check and reach the handler. They must still find nothing:
      // scoping by id alone would make the id itself a key.
      const res = await undo(executionId, outsiderCookie, otherWorkspaceId);
      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toMatch(/not-reversible/);
    });

    it('does not let a foreign workspace URL reach the reversal itself', async () => {
      const created = await execute('Create a conversation about workspace scoping').expect(200);
      const executionId = created.body.data.executionId as string;

      const res = await undo(executionId, outsiderCookie, otherWorkspaceId);
      expect(res.status).toBe(404);

      const conversation = await prisma.conversation.findUnique({
        where: { id: created.body.data.result.id as string },
      });
      expect(conversation!.status).not.toBe('DELETED');
    });
  });
});
