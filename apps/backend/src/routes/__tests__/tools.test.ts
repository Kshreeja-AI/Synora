import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { prisma } from '@synora/database';
import { createApp } from '../../app';
import { initConfig } from '../../config';

/**
 * The workspace-wide execution list.
 *
 * This endpoint exists for one question: "what is stopped and waiting on
 * a person?" A tool marked requiresApproval creates a PENDING execution
 * that will not run until someone decides, and the home page's waiting
 * surface reads exactly this list. So the assertions here are about
 * honesty of the answer: only the requested status comes back, the tool's
 * name rides along so a row can say WHICH tool is waiting, and someone
 * outside the workspace cannot see that the question was even asked.
 */
describe('tool execution routes', () => {
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
    return {
      cookie: cookieHeader(res.headers['set-cookie']),
      userId: res.body.data.user.id as string,
    };
  }

  async function createWorkspace(cookie: string, name: string) {
    const res = await request(app).post('/api/workspaces').set('Cookie', cookie).send({ name });
    testWorkspaceIds.push(res.body.data.id);
    return res.body.data as { id: string };
  }

  /**
   * An approval-gated HTTP tool. Executing it creates a PENDING record
   * and deliberately does NOT hand off to the engine, so these tests
   * never touch the network.
   */
  async function createApprovalGatedTool(cookie: string, workspaceId: string, name: string) {
    const res = await request(app)
      .post(`/api/workspaces/${workspaceId}/tools`)
      .set('Cookie', cookie)
      .send({
        name,
        displayName: name,
        description: 'Sends something on your behalf',
        category: 'http',
        type: 'HTTP',
        inputSchema: { type: 'object', required: [] },
        config: { url: 'https://example.com/hook' },
        requiresApproval: true,
      });
    expect(res.status).toBe(201);
    return res.body.data as { id: string };
  }

  it('answers "what is waiting on a person" with only PENDING executions, each naming its tool', async () => {
    const owner = await register('tools-pending');
    const ws = await createWorkspace(owner.cookie, 'Approval Co');
    const tool = await createApprovalGatedTool(owner.cookie, ws.id, 'send-invoice-email');

    const executed = await request(app)
      .post(`/api/workspaces/${ws.id}/tools/${tool.id}/execute`)
      .set('Cookie', owner.cookie)
      .send({ input: {} });
    expect(executed.status).toBe(201);
    expect(executed.body.data.status).toBe('PENDING');

    // A finished execution, written directly: it must NOT appear in the
    // PENDING view — a done thing is not waiting on anybody.
    await prisma.toolExecution.create({
      data: {
        toolId: tool.id,
        workspaceId: ws.id,
        userId: owner.userId,
        input: {},
        status: 'COMPLETED',
      },
    });

    const res = await request(app)
      .get(`/api/workspaces/${ws.id}/executions?status=PENDING`)
      .set('Cookie', owner.cookie);

    expect(res.status).toBe(200);
    const executions = res.body.data as { status: string; tool?: { name: string } }[];
    expect(executions).toHaveLength(1);
    expect(executions[0].status).toBe('PENDING');
    // The name rides along so the waiting surface can say WHICH tool is
    // stopped, without a second request per row.
    expect(executions[0].tool?.name).toBe('send-invoice-email');
  });

  it('returns every status when no filter is asked for', async () => {
    const owner = await register('tools-all');
    const ws = await createWorkspace(owner.cookie, 'All Statuses Co');
    const tool = await createApprovalGatedTool(owner.cookie, ws.id, 'audited-webhook');

    await request(app)
      .post(`/api/workspaces/${ws.id}/tools/${tool.id}/execute`)
      .set('Cookie', owner.cookie)
      .send({ input: {} });
    await prisma.toolExecution.create({
      data: {
        toolId: tool.id,
        workspaceId: ws.id,
        userId: owner.userId,
        input: {},
        status: 'COMPLETED',
      },
    });

    const res = await request(app)
      .get(`/api/workspaces/${ws.id}/executions`)
      .set('Cookie', owner.cookie);

    expect(res.status).toBe(200);
    const statuses = (res.body.data as { status: string }[]).map((e) => e.status).sort();
    expect(statuses).toEqual(['COMPLETED', 'PENDING']);
  });

  it('rejects a status value the enum does not know', async () => {
    const owner = await register('tools-badstatus');
    const ws = await createWorkspace(owner.cookie, 'Strict Co');

    const res = await request(app)
      .get(`/api/workspaces/${ws.id}/executions?status=WAITING`)
      .set('Cookie', owner.cookie);

    // A typo'd filter silently returning everything would misreport what
    // is waiting; refusing it keeps the answer honest.
    expect(res.status).toBe(400);
  });

  it('requires a session at all', async () => {
    const owner = await register('tools-noauth');
    const ws = await createWorkspace(owner.cookie, 'Locked Co');

    const res = await request(app).get(`/api/workspaces/${ws.id}/executions?status=PENDING`);

    expect(res.status).toBe(401);
  });

  it('hides the list from someone outside the workspace', async () => {
    const owner = await register('tools-owner');
    const stranger = await register('tools-stranger');
    const ws = await createWorkspace(owner.cookie, 'Private Co');

    const res = await request(app)
      .get(`/api/workspaces/${ws.id}/executions?status=PENDING`)
      .set('Cookie', stranger.cookie);

    // Whether anything is pending in a workspace is itself information
    // about that workspace.
    expect([403, 404]).toContain(res.status);
  });
});
