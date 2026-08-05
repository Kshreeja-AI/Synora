/**
 * Does each capability's DECLARED permission match what the real surface
 * actually enforces?
 *
 * WHY THIS CANNOT BE TESTED THROUGH THE COMMAND LAYER. The command layer
 * derives its permission answer FROM the declaration, so asking it whether
 * the declaration is right is circular — it would agree with itself no
 * matter how wrong the declaration was. That circularity is exactly how
 * `activity.recent` shipped declaring `audit:view` for four slices while
 * the real feed required only membership: every test that touched it asked
 * the layer, and the layer asked the declaration.
 *
 * So this test independently probes the REAL services as a VIEWER — the
 * least privileged role, holding only `billing:view` — and compares what
 * actually happens against what the catalogue claims.
 *
 *   declared `null`     → a VIEWER must succeed (membership is enough)
 *   declared some `P`   → a VIEWER, who lacks every P we declare, must be
 *                         refused
 *
 * THE PROBE TABLE BELOW IS DELIBERATELY A SECOND, INDEPENDENT DERIVATION
 * of which service backs which capability. That looks like duplication and
 * is the opposite: a check that shares its source with the thing it checks
 * cannot detect that source being wrong. Two derivations that must agree is
 * the entire mechanism, the same reason double-entry bookkeeping has two
 * columns.
 *
 * SCOPE, STATED HONESTLY: only BOUND capabilities are probed, because only
 * those have an execution path this test can drive. The seven unbound ones
 * remain unverified, and that is a real gap rather than an oversight.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@synora/database';
import { routesForIntent } from '../capabilities';
import { isBound } from '../execute';
import { searchService } from '../../services/search.service';
import { conversationService } from '../../services/conversation.service';
import { listWorkspaceActivity } from '../../services/activity.service';
import { listRuns } from '../../agents/run-engine';
import { getTextProviderMetrics } from '../../ai/textResilience';
import type { CommandIntent, CommandRoute } from '../types';
import { hasPermission, type Permission } from '../../services/permissions';

const INTENTS: CommandIntent[] = [
  'find',
  'ask',
  'create',
  'automate',
  'plan',
  'decide',
  'monitor',
  'communicate',
  'control',
];

describe('declared permissions match the real surfaces', () => {
  let workspaceId: string;
  let viewerId: string;
  let ownerId: string;
  const emails: string[] = [];

  /**
   * capabilityId -> exercise the REAL service as this user. Resolves if the
   * service permitted the call; rejects if it refused.
   */
  const PROBES: Record<string, (userId: string, wsId: string) => Promise<unknown>> = {
    'search.workspace': (userId, wsId) =>
      searchService.searchConversations({ workspaceId: wsId, query: 'anything', userId, take: 1 }),

    'providers.metrics': async () => getTextProviderMetrics(),

    'conversation.create': (userId, wsId) =>
      conversationService.create(userId, wsId, {
        title: 'permission probe',
        provider: 'anthropic',
        model: 'claude-sonnet-5',
      }),

    'approvals.waiting': async (_userId, wsId) => listRuns(wsId),

    'activity.recent': (userId, wsId) => listWorkspaceActivity(userId, wsId, { limit: 1 }),
  };

  async function register(prefix: string): Promise<string> {
    const email = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    emails.push(email);
    const user = await prisma.user.create({
      data: { email, password: 'x'.repeat(60), name: prefix },
    });
    return user.id;
  }

  beforeAll(async () => {
    ownerId = await register('perm-owner');
    viewerId = await register('perm-viewer');
    const workspace = await prisma.workspace.create({
      data: {
        name: `Permission Probe ${Date.now()}`,
        slug: `perm-probe-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        members: {
          create: [
            { userId: ownerId, role: 'OWNER' },
            { userId: viewerId, role: 'VIEWER' },
          ],
        },
      },
    });
    workspaceId = workspace.id;
  });

  afterAll(async () => {
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
  });

  function allRoutes(): CommandRoute[] {
    return INTENTS.flatMap((intent) => routesForIntent(intent));
  }

  it('probes every bound capability, so an empty probe set can never pass this file', () => {
    const bound = allRoutes().filter((route) => isBound(route.capabilityId));
    expect(bound.length).toBeGreaterThan(0);
    for (const route of bound) {
      expect(PROBES[route.capabilityId], `no probe for ${route.capabilityId}`).toBeDefined();
    }
  });

  it('declares no permission only where a VIEWER genuinely succeeds', async () => {
    const wrong: string[] = [];

    for (const route of allRoutes()) {
      if (!isBound(route.capabilityId)) continue;
      // Only meaningful when the VIEWER actually lacks the declared
      // permission; a permission VIEWER holds would prove nothing.
      if (
        route.requiredPermission !== null &&
        hasPermission('VIEWER', route.requiredPermission as Permission)
      ) {
        continue;
      }

      let permitted: boolean;
      try {
        await PROBES[route.capabilityId](viewerId, workspaceId);
        permitted = true;
      } catch {
        permitted = false;
      }

      const declaredOpen = route.requiredPermission === null;
      if (declaredOpen !== permitted) {
        wrong.push(
          `${route.capabilityId}: catalogue says ${
            declaredOpen ? 'membership is enough' : `it needs "${route.requiredPermission}"`
          }, but the real surface ${permitted ? 'accepted' : 'refused'} a VIEWER`
        );
      }
    }

    // Named individually: "one is wrong" sends someone hunting; the
    // sentence sends them to the line.
    expect(wrong).toEqual([]);
  });

  it('lets the owner do everything the catalogue says is open to members', async () => {
    // The mirror check. If a probe refused EVERYONE it would satisfy the
    // test above by accident for any capability declaring a permission,
    // so the probes must be shown to work at all.
    for (const route of allRoutes()) {
      if (!isBound(route.capabilityId)) continue;
      await expect(PROBES[route.capabilityId](ownerId, workspaceId)).resolves.toBeDefined();
    }
  });
});
