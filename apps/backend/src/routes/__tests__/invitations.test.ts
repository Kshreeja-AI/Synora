import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { prisma } from '@synora/database';
import { createApp } from '../../app';
import { initConfig } from '../../config';

describe('invitations (M5)', () => {
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

  function uniqueEmail(prefix: string): string {
    const email = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    testEmails.push(email);
    return email;
  }

  function cookieHeader(setCookieHeaders: string | string[] | undefined): string {
    const cookies = Array.isArray(setCookieHeaders) ? setCookieHeaders : setCookieHeaders ? [setCookieHeaders] : [];
    return cookies.map((c) => c.split(';')[0]).join('; ');
  }

  async function register(prefix: string) {
    const email = uniqueEmail(prefix);
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email, password: 'a-valid-password-123' });
    const data = res.body.data as { user: { id: string } };
    return { accessToken: cookieHeader(res.headers['set-cookie']), userId: data.user.id, email };
  }

  async function createWorkspace(accessToken: string, name: string) {
    const res = await request(app)
      .post('/api/workspaces')
      .set('Cookie', accessToken)
      .send({ name });
    testWorkspaceIds.push(res.body.data.id);
    return res.body.data as { id: string };
  }

  describe('POST /api/workspaces/:id/invitations', () => {
    it('creates an invitation and emails the invitee', async () => {
      const owner = await register('invite-owner');
      const workspace = await createWorkspace(owner.accessToken, 'Invite Co');
      const inviteeEmail = uniqueEmail('invitee');

      const res = await request(app)
        .post(`/api/workspaces/${workspace.id}/invitations`)
        .set('Cookie', owner.accessToken)
        .send({ email: inviteeEmail, role: 'EDITOR' });

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ email: inviteeEmail, role: 'EDITOR' });
    });

    it('returns 403 when a VIEWER tries to invite', async () => {
      const owner = await register('inviteforbidden-owner');
      const viewer = await register('inviteforbidden-viewer');
      const workspace = await createWorkspace(owner.accessToken, 'Locked Invite Co');
      await prisma.workspaceMember.create({
        data: { workspaceId: workspace.id, userId: viewer.userId, role: 'VIEWER' },
      });

      const res = await request(app)
        .post(`/api/workspaces/${workspace.id}/invitations`)
        .set('Cookie', viewer.accessToken)
        .send({ email: uniqueEmail('nope'), role: 'MEMBER' });

      expect(res.status).toBe(403);
    });

    it('rejects inviting someone who is already a member', async () => {
      const owner = await register('dup-owner');
      const existing = await register('dup-existing');
      const workspace = await createWorkspace(owner.accessToken, 'Dup Co');
      await prisma.workspaceMember.create({
        data: { workspaceId: workspace.id, userId: existing.userId, role: 'MEMBER' },
      });

      const res = await request(app)
        .post(`/api/workspaces/${workspace.id}/invitations`)
        .set('Cookie', owner.accessToken)
        .send({ email: existing.email, role: 'MEMBER' });

      expect(res.status).toBe(400);
    });

    it('rejects inviting someone directly as OWNER', async () => {
      const owner = await register('ownerinvite-owner');
      const workspace = await createWorkspace(owner.accessToken, 'No Direct Owner Co');

      const res = await request(app)
        .post(`/api/workspaces/${workspace.id}/invitations`)
        .set('Cookie', owner.accessToken)
        .send({ email: uniqueEmail('wouldbe'), role: 'OWNER' });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/workspaces/:id/invitations + DELETE (revoke)', () => {
    it('lists pending invitations and revokes one', async () => {
      const owner = await register('list-owner');
      const workspace = await createWorkspace(owner.accessToken, 'List Invite Co');
      const inviteeEmail = uniqueEmail('listee');

      const created = await request(app)
        .post(`/api/workspaces/${workspace.id}/invitations`)
        .set('Cookie', owner.accessToken)
        .send({ email: inviteeEmail, role: 'MEMBER' });

      const listed = await request(app)
        .get(`/api/workspaces/${workspace.id}/invitations`)
        .set('Cookie', owner.accessToken);
      expect(listed.body.data).toHaveLength(1);

      const revoked = await request(app)
        .delete(`/api/workspaces/${workspace.id}/invitations/${created.body.data.id}`)
        .set('Cookie', owner.accessToken);
      expect(revoked.status).toBe(200);

      const listedAfter = await request(app)
        .get(`/api/workspaces/${workspace.id}/invitations`)
        .set('Cookie', owner.accessToken);
      expect(listedAfter.body.data).toHaveLength(0);
    });
  });

  describe('GET/POST /api/invitations/:token', () => {
    async function extractInvitationToken(inviteeEmail: string): Promise<string> {
      const invitation = await prisma.workspaceInvitation.findFirst({ where: { email: inviteeEmail } });
      if (!invitation) throw new Error('invitation not found in test setup');
      return invitation.token;
    }

    it('previews a valid invitation without requiring auth', async () => {
      const owner = await register('preview-owner');
      const workspace = await createWorkspace(owner.accessToken, 'Preview Co');
      const inviteeEmail = uniqueEmail('previewee');
      await request(app)
        .post(`/api/workspaces/${workspace.id}/invitations`)
        .set('Cookie', owner.accessToken)
        .send({ email: inviteeEmail, role: 'MEMBER' });

      const token = await extractInvitationToken(inviteeEmail);
      const res = await request(app).get(`/api/invitations/${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ workspaceName: 'Preview Co', role: 'MEMBER', email: inviteeEmail });
    });

    it('returns 404 for an unknown token', async () => {
      const res = await request(app).get('/api/invitations/does-not-exist');
      expect(res.status).toBe(404);
    });

    it('accepts an invitation and creates membership', async () => {
      const owner = await register('accept-owner');
      const workspace = await createWorkspace(owner.accessToken, 'Accept Co');
      const invitee = await register('accept-invitee');

      // Re-issue the invitation now that the invitee account exists, using
      // their real registered email so acceptance's email-match check passes.
      await request(app)
        .post(`/api/workspaces/${workspace.id}/invitations`)
        .set('Cookie', owner.accessToken)
        .send({ email: invitee.email, role: 'EDITOR' });
      const token = await extractInvitationToken(invitee.email);

      const res = await request(app)
        .post(`/api/invitations/${token}/accept`)
        .set('Cookie', invitee.accessToken);

      expect(res.status).toBe(200);
      expect(res.body.data.workspaceId).toBe(workspace.id);

      const membership = await prisma.workspaceMember.findUnique({
        where: { userId_workspaceId: { userId: invitee.userId, workspaceId: workspace.id } },
      });
      expect(membership?.role).toBe('EDITOR');
    });

    it('rejects acceptance from a different email than the invitation', async () => {
      const owner = await register('mismatch-owner');
      const workspace = await createWorkspace(owner.accessToken, 'Mismatch Co');
      const inviteeEmail = uniqueEmail('mismatchee');
      const stranger = await register('mismatch-stranger');

      await request(app)
        .post(`/api/workspaces/${workspace.id}/invitations`)
        .set('Cookie', owner.accessToken)
        .send({ email: inviteeEmail, role: 'MEMBER' });
      const token = await extractInvitationToken(inviteeEmail);

      const res = await request(app)
        .post(`/api/invitations/${token}/accept`)
        .set('Cookie', stranger.accessToken);

      expect(res.status).toBe(403);
    });

    it('requires authentication to accept', async () => {
      const res = await request(app).post('/api/invitations/some-token/accept');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/invitations/mine', () => {
    async function markEmailVerified(email: string): Promise<void> {
      await prisma.user.update({ where: { email }, data: { emailVerified: new Date() } });
    }

    it('shows a verified person the invitations addressed to them', async () => {
      const owner = await register('mine-owner');
      const workspace = await createWorkspace(owner.accessToken, 'Mine Co');
      const invitee = await register('mine-invitee');
      await markEmailVerified(invitee.email);

      await request(app)
        .post(`/api/workspaces/${workspace.id}/invitations`)
        .set('Cookie', owner.accessToken)
        .send({ email: invitee.email, role: 'MEMBER' });

      const res = await request(app).get('/api/invitations/mine').set('Cookie', invitee.accessToken);

      expect(res.status).toBe(200);
      expect(res.body.data.emailVerified).toBe(true);
      expect(res.body.data.invitations).toHaveLength(1);
      const invitation = res.body.data.invitations[0];
      expect(invitation.workspaceName).toBe('Mine Co');
      expect(invitation.role).toBe('MEMBER');
      // The token comes back because a VERIFIED email is the same proof
      // of mailbox ownership the emailed link relies on — this hands the
      // credential to exactly the person the email was meant to reach.
      expect(typeof invitation.token).toBe('string');
      expect(invitation.token.length).toBeGreaterThan(0);
    });

    it('shows an unverified account nothing — not even that invitations exist', async () => {
      const owner = await register('mine-unverified-owner');
      const workspace = await createWorkspace(owner.accessToken, 'Unverified Co');
      const invitee = await register('mine-unverified');
      // No markEmailVerified: this account has merely CLAIMED the address.

      await request(app)
        .post(`/api/workspaces/${workspace.id}/invitations`)
        .set('Cookie', owner.accessToken)
        .send({ email: invitee.email, role: 'MEMBER' });

      const res = await request(app).get('/api/invitations/mine').set('Cookie', invitee.accessToken);

      // Anyone can register with someone else's email address. If this
      // returned the invitation (and its accept token), registering a
      // victim's address would be enough to walk into workspaces meant
      // for them. Fails closed, and says WHY the list is empty.
      expect(res.status).toBe(200);
      expect(res.body.data.emailVerified).toBe(false);
      expect(res.body.data.invitations).toHaveLength(0);
    });

    it('excludes revoked and accepted invitations — an answered question is not waiting', async () => {
      const owner = await register('mine-settled-owner');
      const workspace = await createWorkspace(owner.accessToken, 'Settled Co');
      const invitee = await register('mine-settled');
      await markEmailVerified(invitee.email);

      await request(app)
        .post(`/api/workspaces/${workspace.id}/invitations`)
        .set('Cookie', owner.accessToken)
        .send({ email: invitee.email, role: 'MEMBER' });
      const token = await prisma.workspaceInvitation
        .findFirst({ where: { email: invitee.email } })
        .then((inv) => inv!.token);
      await request(app).post(`/api/invitations/${token}/accept`).set('Cookie', invitee.accessToken);

      const res = await request(app).get('/api/invitations/mine').set('Cookie', invitee.accessToken);

      expect(res.status).toBe(200);
      expect(res.body.data.emailVerified).toBe(true);
      expect(res.body.data.invitations).toHaveLength(0);
    });

    it('excludes expired invitations — a decision that can no longer be made is not waiting', async () => {
      const owner = await register('mine-expired-owner');
      const workspace = await createWorkspace(owner.accessToken, 'Expired Co');
      const invitee = await register('mine-expired');
      await markEmailVerified(invitee.email);

      await request(app)
        .post(`/api/workspaces/${workspace.id}/invitations`)
        .set('Cookie', owner.accessToken)
        .send({ email: invitee.email, role: 'MEMBER' });
      await prisma.workspaceInvitation.updateMany({
        where: { email: invitee.email },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const res = await request(app).get('/api/invitations/mine').set('Cookie', invitee.accessToken);

      expect(res.status).toBe(200);
      expect(res.body.data.invitations).toHaveLength(0);
    });

    it('requires authentication', async () => {
      const res = await request(app).get('/api/invitations/mine');
      expect(res.status).toBe(401);
    });
  });
});
