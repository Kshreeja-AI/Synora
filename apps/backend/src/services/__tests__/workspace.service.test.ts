import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { prisma } from '@synora/database';
import { initConfig } from '../../config';
import { createWorkspace } from '../workspace.service';

/**
 * Route-level coverage (`routes/__tests__/workspaces.test.ts`) exercises the
 * full CRUD + membership surface end to end. This file covers the one edge
 * case not reachable through the route's zod validation: a name made
 * entirely of characters that slugify away to nothing.
 */
describe('workspace.service — slug edge cases', () => {
  const testEmails: string[] = [];
  const testWorkspaceIds: string[] = [];

  beforeAll(async () => {
    await initConfig();
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

  async function makeUser() {
    const email = `wsslug-${Date.now()}-${Math.random()}@example.com`;
    testEmails.push(email);
    return prisma.user.create({ data: { email, password: 'irrelevant-for-this-test' } });
  }

  it('falls back to "workspace" when the name has no slug-able characters', async () => {
    const user = await makeUser();

    const workspace = await createWorkspace(user.id, { name: '!!!' });
    testWorkspaceIds.push(workspace.id);

    expect(workspace.slug).toBe('workspace');
  });

  it('appends a numeric suffix when the fallback slug also collides', async () => {
    const userA = await makeUser();
    const userB = await makeUser();

    const first = await createWorkspace(userA.id, { name: '###' });
    testWorkspaceIds.push(first.id);
    const second = await createWorkspace(userB.id, { name: '$$$' });
    testWorkspaceIds.push(second.id);

    expect(first.slug).toBe('workspace');
    expect(second.slug).toBe('workspace-2');
  });
});
