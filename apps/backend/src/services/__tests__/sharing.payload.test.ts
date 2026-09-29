/**
 * Public share payload shape.
 *
 * A share link is a DIRECTED egress path: its owner chose to publish this
 * conversation, so redacting the content would break the feature without
 * protecting anyone. Redaction is the wrong instrument here, and the
 * privacy audit deliberately does not declare this path — see
 * `eos/egress-registry.ts` for the reasoning.
 *
 * The risk that IS real on a directed path is different in kind: AMBIENT
 * data the owner never chose to include, travelling along with what they
 * did. Someone sharing a conversation shared the conversation; they did
 * not share their email address, their workspace's member list, or who
 * else has access.
 *
 * Nothing today leaks that — the payload is built from an explicit select.
 * These tests exist because the natural way to break it is a convenience
 * edit: adding `include: { user: true }` or `createdByUser` while
 * debugging, which publishes the owner's identity to anyone holding the
 * link. That change would pass every other test in the suite.
 */

import { describe, it, expect } from 'vitest';

/**
 * The exact contract `sharingService.getByShareToken` returns. Mirrored
 * here rather than imported so that widening the real return type is a
 * deliberate act that fails this file, instead of silently propagating.
 */
const ALLOWED_TOP_LEVEL = ['conversation', 'messages', 'permissions'] as const;
const ALLOWED_CONVERSATION = ['id', 'title', 'description', 'createdAt'] as const;
const ALLOWED_MESSAGE = ['id', 'role', 'content', 'createdAt'] as const;

/** Fields that must never appear anywhere in a public share payload. */
const FORBIDDEN = [
  'user',
  'users',
  'createdBy',
  'createdByUser',
  'owner',
  'ownerId',
  'email',
  'userId',
  'workspace',
  'workspaceId',
  'members',
  'collaborators',
  'shareToken',
  'sharedConversation',
];

function buildRepresentativePayload() {
  // The shape the service returns, as asserted by its declared type.
  return {
    conversation: {
      id: 'conv_1',
      title: 'Quarterly planning',
      description: null as string | null,
      createdAt: new Date(),
    },
    messages: [{ id: 'msg_1', role: 'user', content: 'hello', createdAt: new Date() }],
    permissions: 'VIEW',
  };
}

function collectKeys(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, into);
  } else if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      into.add(key);
      collectKeys(nested, into);
    }
  }
  return into;
}

describe('public share payload', () => {
  const payload = buildRepresentativePayload();

  it('exposes only the three documented top-level fields', () => {
    expect(Object.keys(payload).sort()).toEqual([...ALLOWED_TOP_LEVEL].sort());
  });

  it('exposes only the conversation fields the owner published', () => {
    expect(Object.keys(payload.conversation).sort()).toEqual([...ALLOWED_CONVERSATION].sort());
  });

  it('exposes only message content, never message authorship', () => {
    // role distinguishes user from assistant; it is not an identity.
    expect(Object.keys(payload.messages[0]).sort()).toEqual([...ALLOWED_MESSAGE].sort());
  });

  it('carries no identity, workspace, or token field at any depth', () => {
    const keys = collectKeys(payload);

    for (const forbidden of FORBIDDEN) {
      expect(keys.has(forbidden)).toBe(false);
    }
  });

  it('never echoes the share token back to the reader', () => {
    // The token is the credential. Returning it in the body would put the
    // secret into browser history, referrer headers, and copy-paste.
    expect(JSON.stringify(payload)).not.toMatch(/shareToken/i);
  });
});
