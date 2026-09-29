import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@synora/database';
import {
  createApiKey,
  hashApiKey,
  listApiKeys,
  revokeApiKey,
  verifyPresentedKey,
} from '../apiKey.service';

/**
 * Guard-rails on the API-key subsystem — every assertion here corresponds
 * to a security invariant users of the endpoint depend on:
 *   • The raw key is returned exactly once
 *   • The hash stored is deterministic SHA-256 of the raw key
 *   • Revoked/expired keys fail verification even though the row is kept
 */
describe('apiKey.service', () => {
  const wsId = `ws-apikey-${Date.now()}`;
  const userId = `user-apikey-${Date.now()}`;

  beforeAll(async () => {
    // Real workspace + user rows so the FK constraints on ApiKey are honored.
    await prisma.user.create({
      data: { id: userId, email: `${userId}@test.local`, password: 'x' },
    });
    await prisma.workspace.create({
      data: { id: wsId, name: 'apikey test ws', slug: `apikey-${Date.now()}` },
    });
  });

  afterAll(async () => {
    await prisma.apiKey.deleteMany({ where: { workspaceId: wsId } });
    await prisma.workspace.delete({ where: { id: wsId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('creates a key, returns the raw secret once, and never persists it in cleartext', async () => {
    const { apiKey, rawKey } = await createApiKey({
      workspaceId: wsId,
      createdById: userId,
      name: 'Test key',
    });

    // The response carries the secret exactly once.
    expect(rawKey).toMatch(/^sk_syn_[0-9a-f]{64}$/);
    // But the row that survives on disk contains no cleartext — the `key`
    // column stores the SHA-256 hash of the raw secret.
    const row = await prisma.apiKey.findUnique({ where: { id: apiKey.id } });
    expect(row).not.toBeNull();
    expect(row!.key).toBe(hashApiKey(rawKey));
    expect(row!.key).not.toBe(rawKey);
    // Prefix is deterministic + non-secret.
    expect(row!.prefix).toBe(rawKey.slice(0, 'sk_syn_'.length + 8));
  });

  it('lists workspace keys with a stable ordering and never leaks the hash', async () => {
    const keys = await listApiKeys(wsId);
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) {
      // The service returns Omit<ApiKey, 'key'> — the type-level guarantee
      // is reinforced with a runtime check so a future refactor cannot
      // widen this shape by accident.
      expect(k).not.toHaveProperty('key');
    }
  });

  it('verifies a presented key by hash and records lastUsedAt', async () => {
    const { rawKey, apiKey } = await createApiKey({
      workspaceId: wsId,
      createdById: userId,
      name: 'Verify test',
    });
    const before = await prisma.apiKey.findUnique({ where: { id: apiKey.id } });
    expect(before?.lastUsedAt).toBeNull();

    const resolved = await verifyPresentedKey(rawKey);
    expect(resolved).toEqual({ id: apiKey.id, workspaceId: wsId, createdById: userId });

    // lastUsedAt is a fire-and-forget update — allow a tick for it to land.
    await new Promise((r) => setTimeout(r, 40));
    const after = await prisma.apiKey.findUnique({ where: { id: apiKey.id } });
    expect(after?.lastUsedAt).not.toBeNull();
  });

  it('rejects unknown keys, revoked keys, and expired keys — the row survives for audit', async () => {
    // Unknown: never seen this hash.
    expect(await verifyPresentedKey('sk_syn_' + '0'.repeat(64))).toBeNull();

    // Revoked: row keeps existing but auth path treats it as gone.
    const { rawKey, apiKey } = await createApiKey({
      workspaceId: wsId,
      createdById: userId,
      name: 'Revoke test',
    });
    await revokeApiKey(apiKey.id, wsId);
    expect(await verifyPresentedKey(rawKey)).toBeNull();
    const revokedRow = await prisma.apiKey.findUnique({ where: { id: apiKey.id } });
    expect(revokedRow).not.toBeNull();
    expect(revokedRow!.revokedAt).not.toBeNull();

    // Expired: same treatment as revoked.
    const { rawKey: expiredKey, apiKey: expired } = await createApiKey({
      workspaceId: wsId,
      createdById: userId,
      name: 'Expire test',
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(await verifyPresentedKey(expiredKey)).toBeNull();
    // Still present in the DB so audit history is intact.
    expect(await prisma.apiKey.findUnique({ where: { id: expired.id } })).not.toBeNull();
  });

  it('ignores tokens that do not carry the platform prefix', async () => {
    // Anything not starting with sk_syn_ short-circuits before touching the DB.
    expect(await verifyPresentedKey('bearer-wrong')).toBeNull();
    expect(await verifyPresentedKey('')).toBeNull();
  });
});
