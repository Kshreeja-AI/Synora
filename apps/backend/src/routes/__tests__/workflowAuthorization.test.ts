/**
 * Who may author automation?
 *
 * THE HOLE THIS PINS SHUT: the workflow surfaces enforced membership only.
 * The permission model is explicit — VIEWER holds `billing:view` and
 * nothing else, and `tool:manage` (OWNER/ADMIN) gates automation CRUD,
 * which the tool service enforces on its own create/update/delete — but
 * none of it was applied to workflows, schedules or triggers. A VIEWER
 * could author a workflow and put it on a schedule: read-only on paper,
 * autonomous recurring behaviour in practice.
 *
 * Found by binding: before wiring `workflow.schedule` into the command
 * layer, slice-7 discipline asks what the real surface enforces, and the
 * answer was "nothing beyond membership". Fixed BEFORE the new entry point
 * exists, so the command layer never briefly widened access.
 *
 * The catalogue declared `tool:manage` for these capabilities all along —
 * the declaration was RIGHT and the routes were wrong, which is the mirror
 * image of the `activity.recent` defect (declaration wrong, surface right).
 * Two derivations that must agree, disagreeing, is the alarm working.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { prisma } from '@synora/database';
import { createApp } from '../../app';
import { initConfig } from '../../config';

describe('workflow authorization', () => {
  let app: Express;
  let ownerCookie: string;
  let viewerCookie: string;
  let memberCookie: string;
  let outsiderCookie: string;
  let workspaceId: string;
  let workflowId: string;
  const emails: string[] = [];

  async function register(prefix: string): Promise<{ cookie: string; id: string }> {
    const email = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    emails.push(email);
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email, password: 'a-valid-password-123' });
    const setCookie = res.headers['set-cookie'];
    const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
    return { cookie: cookies.map((c) => c.split(';')[0]).join('; '), id: res.body.data.user.id };
  }

  const workflowBody = {
    name: 'Authz Probe',
    steps: [{ id: 's1', kind: 'generate', description: 'Summarize', input: 'summarize' }],
    limits: {},
  };

  beforeAll(async () => {
    const config = await initConfig();
    app = createApp(config);

    const owner = await register('wfz-owner');
    ownerCookie = owner.cookie;
    const viewer = await register('wfz-viewer');
    viewerCookie = viewer.cookie;
    const member = await register('wfz-member');
    memberCookie = member.cookie;
    outsiderCookie = (await register('wfz-outsider')).cookie;

    const workspace = await request(app)
      .post('/api/workspaces')
      .set('Cookie', ownerCookie)
      .send({ name: `Workflow Authz ${Date.now()}` });
    workspaceId = workspace.body.data.id;

    await prisma.workspaceMember.createMany({
      data: [
        { workspaceId, userId: viewer.id, role: 'VIEWER' },
        { workspaceId, userId: member.id, role: 'MEMBER' },
      ],
    });

    // A real workflow (created by someone entitled to) for the schedule and
    // mutation probes below.
    const workflow = await request(app)
      .post(`/api/workspaces/${workspaceId}/workflows`)
      .set('Cookie', ownerCookie)
      .send(workflowBody)
      .expect(201);
    workflowId = workflow.body.data.id;
  });

  afterAll(async () => {
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
  });

  it('lets an OWNER author workflows — the fix must not break the entitled path', async () => {
    // Asserted via the beforeAll 201, restated here so the file names it.
    expect(workflowId).toBeTruthy();
  });

  it('refuses a VIEWER everything that authors automation, with the standard 403', async () => {
    const attempts: Array<[string, string, object]> = [
      ['post', `/api/workspaces/${workspaceId}/workflows`, workflowBody],
      ['patch', `/api/workspaces/${workspaceId}/workflows/${workflowId}`, { name: 'Renamed' }],
      [
        'post',
        `/api/workspaces/${workspaceId}/workflows/${workflowId}/schedules`,
        { kind: 'daily', atMinuteUtc: 540 },
      ],
      [
        'post',
        `/api/workspaces/${workspaceId}/workflows/${workflowId}/triggers`,
        { name: 'probe' },
      ],
      ['delete', `/api/workspaces/${workspaceId}/workflows/${workflowId}`, {}],
    ];

    for (const [method, url, body] of attempts) {
      const agent = request(app) as unknown as Record<string, (u: string) => request.Test>;
      const res = await agent[method](url).set('Cookie', viewerCookie).send(body);
      // 403, not 404: the VIEWER is a real member and may know the
      // workspace exists — what they lack is the role. Same sentence
      // requirePermission produces platform-wide.
      expect(res.status, `${method.toUpperCase()} ${url}`).toBe(403);
    }
  });

  it('refuses a MEMBER too — tool:manage is OWNER/ADMIN, matching the tool service', async () => {
    const res = await request(app)
      .post(`/api/workspaces/${workspaceId}/workflows`)
      .set('Cookie', memberCookie)
      .send(workflowBody);
    expect(res.status).toBe(403);

    const schedule = await request(app)
      .post(`/api/workspaces/${workspaceId}/workflows/${workflowId}/schedules`)
      .set('Cookie', memberCookie)
      .send({ kind: 'daily', atMinuteUtc: 540 });
    expect(schedule.status).toBe(403);
  });

  it('still lets every member READ workflows — the fix touches only mutation', async () => {
    await request(app)
      .get(`/api/workspaces/${workspaceId}/workflows`)
      .set('Cookie', viewerCookie)
      .expect(200);
    await request(app)
      .get(`/api/workspaces/${workspaceId}/workflows/${workflowId}/schedules`)
      .set('Cookie', memberCookie)
      .expect(200);
  });

  it('keeps 404-not-403 for outsiders — the permission check must not leak existence', async () => {
    // A 403 here would tell a non-member the workspace exists. Membership
    // answers first, exactly as everywhere else.
    await request(app)
      .post(`/api/workspaces/${workspaceId}/workflows`)
      .set('Cookie', outsiderCookie)
      .send(workflowBody)
      .expect(404);
  });
});
