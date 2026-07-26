import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { prisma } from '@synora/database';
import { createApp } from '../../app';
import { initConfig } from '../../config';

describe('workspace member management + audit log (M5)', () => {
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

  async function register(prefix: string) {
    const email = uniqueEmail(prefix);
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email, password: 'a-valid-password-123' });
    const data = res.body.data as { accessToken: string; user: { id: string } };
    return { accessToken: data.accessToken, userId: data.user.id, email };
  }

  async function createWorkspace(accessToken: string, name: string) {
    const res = await request(app)
      .post('/api/workspaces')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name });
    testWorkspaceIds.push(res.body.data.id);
    return res.body.data as { id: string };
  }

  async function addMember(workspaceId: string, userId: string, role: string) {
    const member = await prisma.workspaceMember.create({ data: { workspaceId, userId, role: role as never } });
    return member;
  }

  describe('PATCH /api/workspaces/:id/members/:memberId', () => {
    it('lets the owner change a member role', async () => {
      const owner = await register('role-owner');
      const member = await register('role-member');
      const workspace = await createWorkspace(owner.accessToken, 'Role Co');
      const membership = await addMember(workspace.id, member.userId, 'MEMBER');

      const res = await request(app)
        .patch(`/api/workspaces/${workspace.id}/members/${membership.id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ role: 'EDITOR' });

      expect(res.status).toBe(200);
      expect(res.body.data.role).toBe('EDITOR');
    });

    it('returns 403 when a non-owner tries to grant OWNER', async () => {
      const owner = await register('ownergrant-owner');
      const admin = await register('ownergrant-admin');
      const target = await register('ownergrant-target');
      const workspace = await createWorkspace(owner.accessToken, 'Ownership Co');
      await addMember(workspace.id, admin.userId, 'ADMIN');
      const targetMembership = await addMember(workspace.id, target.userId, 'MEMBER');

      const res = await request(app)
        .patch(`/api/workspaces/${workspace.id}/members/${targetMembership.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ role: 'OWNER' });

      expect(res.status).toBe(403);
    });

    it('refuses to demote the last owner', async () => {
      const owner = await register('lastowner-owner');
      const workspace = await createWorkspace(owner.accessToken, 'Solo Co');
      const members = await request(app)
        .get(`/api/workspaces/${workspace.id}/members`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      const ownerMembershipId = members.body.data[0].id;

      const res = await request(app)
        .patch(`/api/workspaces/${workspace.id}/members/${ownerMembershipId}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ role: 'ADMIN' });

      expect(res.status).toBe(403);
    });

    it('returns 403 when a MEMBER tries to change roles', async () => {
      const owner = await register('memberrole-owner');
      const member = await register('memberrole-member');
      const other = await register('memberrole-other');
      const workspace = await createWorkspace(owner.accessToken, 'Locked Co');
      await addMember(workspace.id, member.userId, 'MEMBER');
      const otherMembership = await addMember(workspace.id, other.userId, 'MEMBER');

      const res = await request(app)
        .patch(`/api/workspaces/${workspace.id}/members/${otherMembership.id}`)
        .set('Authorization', `Bearer ${member.accessToken}`)
        .send({ role: 'EDITOR' });

      expect(res.status).toBe(403);
    });
  });

  describe('DELETE /api/workspaces/:id/members/:memberId', () => {
    it('lets the owner remove a member', async () => {
      const owner = await register('remove-owner');
      const member = await register('remove-member');
      const workspace = await createWorkspace(owner.accessToken, 'Remove Co');
      const membership = await addMember(workspace.id, member.userId, 'MEMBER');

      const res = await request(app)
        .delete(`/api/workspaces/${workspace.id}/members/${membership.id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);

      expect(res.status).toBe(200);

      const stillThere = await prisma.workspaceMember.findUnique({ where: { id: membership.id } });
      expect(stillThere).toBeNull();
    });

    it('lets a member remove themselves (leave)', async () => {
      const owner = await register('leave-owner');
      const member = await register('leave-member');
      const workspace = await createWorkspace(owner.accessToken, 'Leave Co');
      const membership = await addMember(workspace.id, member.userId, 'MEMBER');

      const res = await request(app)
        .delete(`/api/workspaces/${workspace.id}/members/${membership.id}`)
        .set('Authorization', `Bearer ${member.accessToken}`);

      expect(res.status).toBe(200);
    });

    it('refuses to remove the last owner', async () => {
      const owner = await register('lastownerremove-owner');
      const workspace = await createWorkspace(owner.accessToken, 'Only Owner Co');
      const members = await request(app)
        .get(`/api/workspaces/${workspace.id}/members`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      const ownerMembershipId = members.body.data[0].id;

      const res = await request(app)
        .delete(`/api/workspaces/${workspace.id}/members/${ownerMembershipId}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);

      expect(res.status).toBe(403);
    });

    it('returns 403 when a MEMBER tries to remove someone else', async () => {
      const owner = await register('removeforbidden-owner');
      const member = await register('removeforbidden-member');
      const target = await register('removeforbidden-target');
      const workspace = await createWorkspace(owner.accessToken, 'Guarded Co');
      await addMember(workspace.id, member.userId, 'MEMBER');
      const targetMembership = await addMember(workspace.id, target.userId, 'MEMBER');

      const res = await request(app)
        .delete(`/api/workspaces/${workspace.id}/members/${targetMembership.id}`)
        .set('Authorization', `Bearer ${member.accessToken}`);

      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/workspaces/:id/audit-log', () => {
    it('records and lists audit events for ADMIN+', async () => {
      const owner = await register('audit-owner');
      const workspace = await createWorkspace(owner.accessToken, 'Audited Co');

      await request(app)
        .patch(`/api/workspaces/${workspace.id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ name: 'Audited Co Renamed' });

      const res = await request(app)
        .get(`/api/workspaces/${workspace.id}/audit-log`)
        .set('Authorization', `Bearer ${owner.accessToken}`);

      expect(res.status).toBe(200);
      const actions = res.body.data.map((entry: { action: string }) => entry.action);
      expect(actions).toContain('workspace.created');
      expect(actions).toContain('workspace.updated');
      expect(res.body.data[0].actor).toMatchObject({ email: owner.email });
    });

    it('returns 403 for a VIEWER (no audit:view permission)', async () => {
      const owner = await register('auditforbidden-owner');
      const viewer = await register('auditforbidden-viewer');
      const workspace = await createWorkspace(owner.accessToken, 'Private Audit Co');
      await addMember(workspace.id, viewer.userId, 'VIEWER');

      const res = await request(app)
        .get(`/api/workspaces/${workspace.id}/audit-log`)
        .set('Authorization', `Bearer ${viewer.accessToken}`);

      expect(res.status).toBe(403);
    });

    it('returns 404 for a non-member', async () => {
      const owner = await register('audit404-owner');
      const stranger = await register('audit404-stranger');
      const workspace = await createWorkspace(owner.accessToken, 'Hidden Audit Co');

      const res = await request(app)
        .get(`/api/workspaces/${workspace.id}/audit-log`)
        .set('Authorization', `Bearer ${stranger.accessToken}`);

      expect(res.status).toBe(404);
    });
  });
});
