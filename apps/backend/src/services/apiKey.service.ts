import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '@synora/database';
import type { ApiKey } from '@prisma/client';

/**
 * API keys for programmatic access to a workspace.
 *
 * Two-part model:
 *   • `key` in the DB is the SHA-256 hex digest of the presented secret.
 *     Lookup by presented key is a single indexed WHERE and there is no
 *     reversible material in the row.
 *   • `prefix` is a non-secret display handle (e.g. `sk_syn_a1b2c3d4`)
 *     that users can distinguish keys by after creation — the raw secret
 *     is shown exactly once at creation time and never again.
 *
 * SHA-256 not bcrypt is deliberate. A generated key already carries 128+
 * bits of entropy, so a cost-tuned hash offers no meaningful defence-in-
 * depth for a DB leak — and it's incompatible with the auth hot path,
 * which must look up a key per incoming request in O(1).
 */

const KEY_PREFIX = 'sk_syn_';
const RAW_KEY_BYTES = 32; // 256 bits of entropy in the secret itself.
const PREFIX_ID_LENGTH = 8;

export interface CreatedApiKey {
  apiKey: Omit<ApiKey, 'key'>;
  /** The raw secret — return once at creation, never persist elsewhere. */
  rawKey: string;
}

/**
 * Deterministic hash of the presented key. Public so the auth middleware
 * and tests can share the exact algorithm without importing internals.
 */
export function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey, 'utf8').digest('hex');
}

/** Extract the display prefix from a raw key (or return the input verbatim
 *  if it doesn't look like ours — never throw from the auth path). */
export function apiKeyPrefix(rawKey: string): string {
  return rawKey.slice(0, KEY_PREFIX.length + PREFIX_ID_LENGTH);
}

export interface CreateApiKeyInput {
  workspaceId: string;
  createdById: string;
  name: string;
  /** Optional expiry — after this the key is treated as revoked by the auth
   *  middleware without needing an explicit revoke call. */
  expiresAt?: Date | null;
}

export async function createApiKey(input: CreateApiKeyInput): Promise<CreatedApiKey> {
  // The prefix collision domain is 32 bits of entropy inside the display
  // slug. The tiny retry-on-conflict loop covers the astronomically rare
  // collision path so the caller never sees a P2002 on a name-only mistake.
  for (let attempt = 0; attempt < 3; attempt++) {
    const secret = randomBytes(RAW_KEY_BYTES).toString('hex');
    const rawKey = KEY_PREFIX + secret;
    const prefix = apiKeyPrefix(rawKey);

    try {
      const created = await prisma.apiKey.create({
        data: {
          workspaceId: input.workspaceId,
          createdById: input.createdById,
          name: input.name.trim(),
          key: hashApiKey(rawKey),
          prefix,
          expiresAt: input.expiresAt ?? null,
        },
        select: {
          id: true,
          workspaceId: true,
          createdById: true,
          name: true,
          prefix: true,
          lastUsedAt: true,
          expiresAt: true,
          revokedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      // Recompose to the shared ApiKey shape sans `key` so the caller can
      // pass this straight to the client without leaking the hash either.
      const apiKey = { ...created, key: '' } as unknown as Omit<ApiKey, 'key'>;
      return { apiKey, rawKey };
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === 'P2002' && attempt < 2) continue; // rare prefix collision
      throw err;
    }
  }
  throw new Error('Failed to generate a unique API key prefix after 3 attempts');
}

/** List keys for a workspace. Never returns the hash. */
export async function listApiKeys(workspaceId: string): Promise<Array<Omit<ApiKey, 'key'>>> {
  const rows = await prisma.apiKey.findMany({
    where: { workspaceId },
    orderBy: [{ revokedAt: 'asc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      workspaceId: true,
      createdById: true,
      name: true,
      prefix: true,
      lastUsedAt: true,
      expiresAt: true,
      revokedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return rows as unknown as Array<Omit<ApiKey, 'key'>>;
}

/**
 * Mark a key revoked. Keeps the row so an audit trail of "who provisioned
 * what and when it was disabled" survives — the auth middleware treats
 * non-null revokedAt as disabled without needing the row deleted.
 */
export async function revokeApiKey(id: string, workspaceId: string): Promise<void> {
  await prisma.apiKey.updateMany({
    where: { id, workspaceId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/**
 * Resolve a presented raw key to an ApiKey row, or null if it doesn't exist,
 * is revoked, or has expired. The auth middleware calls this on every
 * request that presents a bearer token starting with the platform prefix.
 */
export async function verifyPresentedKey(
  rawKey: string
): Promise<{ id: string; workspaceId: string; createdById: string | null } | null> {
  if (!rawKey.startsWith(KEY_PREFIX)) return null;
  const hash = hashApiKey(rawKey);
  const row = await prisma.apiKey.findUnique({
    where: { key: hash },
    select: { id: true, workspaceId: true, createdById: true, revokedAt: true, expiresAt: true },
  });
  if (!row || row.revokedAt) return null;
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;
  // Fire-and-forget usage timestamp; the auth path must not wait on this.
  prisma.apiKey
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {
      /* touch failures are not worth aborting auth for */
    });
  return { id: row.id, workspaceId: row.workspaceId, createdById: row.createdById };
}
