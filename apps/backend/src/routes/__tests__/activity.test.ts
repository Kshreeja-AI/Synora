import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { prisma } from '@synora/database';
import { createApp } from '../../app';
import { initConfig } from '../../config';

/**
 * The workspace activity feed.
 *
 * The assertion that matters most is the boundary: this feed reads the
 * SAME audit log as the governance surface, so what keeps it safe for
 * every member to see is the allowlist. A governance event leaking
 * through it would hand a MEMBER exactly the history `audit:view` exists
 * to gate.
 */
describe('activity routes', () => {
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

  it('tells what happened as sentences, from real recorded events', async () => {
    const owner = await register('act-sentences');
    const ws = await createWorkspace(owner.cookie, 'Activity Co');

    // Real actions through real endpoints — the feed reads what the
    // platform genuinely recorded, not fixtures written into the log.
    await request(app)
      .post('/api/projects')
      .set('Cookie', owner.cookie)
      .send({ name: 'Market entry', workspaceId: ws.id });
    await request(app)
      .post(`/api/workspaces/${ws.id}/assets`)
      .set('Cookie', owner.cookie)
      .attach('file', Buffer.from('numbers'), {
        filename: 'quarterly.csv',
        contentType: 'text/csv',
      });

    const res = await request(app)
      .get(`/api/workspaces/${ws.id}/activity`)
      .set('Cookie', owner.cookie);

    expect(res.status).toBe(200);
    const sentences = (res.body.data as { sentence: string }[]).map((e) => e.sentence);
    expect(sentences.some((s) => s.includes('created the project “Market entry”'))).toBe(true);
    expect(sentences.some((s) => s.includes('uploaded quarterly.csv'))).toBe(true);
  });

  it('is readable by an ordinary MEMBER, unlike the audit log', async () => {
    const owner = await register('act-member-owner');
    const member = await register('act-member');
    const ws = await createWorkspace(owner.cookie, 'Member Co');
    await prisma.workspaceMember.create({
      data: { workspaceId: ws.id, userId: member.userId, role: 'MEMBER' },
    });
    await request(app)
      .post('/api/projects')
      .set('Cookie', owner.cookie)
      .send({ name: 'Visible work', workspaceId: ws.id });

    const res = await request(app)
      .get(`/api/workspaces/${ws.id}/activity`)
      .set('Cookie', member.cookie);

    // The whole reason this exists: a MEMBER previously had no way at all
    // to ask "what happened here while I was away".
    expect(res.status).toBe(200);
    expect(
      (res.body.data as { sentence: string }[]).some((e) =>
        e.sentence.includes('created the project “Visible work”'),
      ),
    ).toBe(true);
  });

  it('never leaks a governance event through the work feed', async () => {
    const owner = await register('act-governance');
    const invitee = await register('act-invitee');
    const ws = await createWorkspace(owner.cookie, 'Governance Co');
    // A governance event, recorded directly the way member management
    // records it — the feed must filter it out by action name.
    await prisma.auditLog.create({
      data: {
        workspaceId: ws.id,
        actorId: owner.userId,
        action: 'member.role_changed',
        targetType: 'member',
        targetId: invitee.userId,
        metadata: { role: 'ADMIN' },
      },
    });

    const res = await request(app)
      .get(`/api/workspaces/${ws.id}/activity`)
      .set('Cookie', owner.cookie);

    // Role changes, invitations and billing are exactly the history
    // `audit:view` exists to gate. The allowlist is the boundary.
    expect(
      (res.body.data as { action: string }[]).some((e) => e.action.startsWith('member.')),
    ).toBe(false);
  });

  it('reads an event by a deleted account as "Someone", not by dropping it', async () => {
    const owner = await register('act-ghost-owner');
    const ghost = await register('act-ghost');
    const ws = await createWorkspace(owner.cookie, 'Ghost Co');
    await prisma.auditLog.create({
      data: {
        workspaceId: ws.id,
        actorId: ghost.userId,
        action: 'asset.uploaded',
        targetType: 'asset',
        metadata: { name: 'orphaned.pdf' },
      },
    });
    // Deleted here; the afterEach cleanup simply finds nothing for it.
    await prisma.user.delete({ where: { id: ghost.userId } });

    const res = await request(app)
      .get(`/api/workspaces/${ws.id}/activity`)
      .set('Cookie', owner.cookie);

    // The upload still happened. History does not lose events because an
    // account did not survive.
    expect(
      (res.body.data as { sentence: string }[]).some(
        (e) => e.sentence === 'Someone uploaded orphaned.pdf',
      ),
    ).toBe(true);
  });

  it('is hidden from other workspaces and the unauthenticated', async () => {
    const owner = await register('act-guard');
    const stranger = await register('act-stranger');
    const ws = await createWorkspace(owner.cookie, 'Guard Co');

    expect((await request(app).get(`/api/workspaces/${ws.id}/activity`)).status).toBe(401);
    const cross = await request(app)
      .get(`/api/workspaces/${ws.id}/activity`)
      .set('Cookie', stranger.cookie);
    expect([403, 404]).toContain(cross.status);
  });
});
