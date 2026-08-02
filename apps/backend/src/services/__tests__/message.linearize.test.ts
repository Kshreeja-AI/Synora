import { describe, it, expect } from 'vitest'
import { MessageRole } from '@prisma/client'
import { linearizeCanonicalPath } from '../message.service'
import type { Message, MessageBranch, MessageAttachment } from '@prisma/client'

type Row = Message & { branch: MessageBranch | null; attachments: MessageAttachment[] }

/**
 * Small builder so the test bodies read like the conversation shape
 * they're describing, not like Prisma boilerplate. `t` is a monotonic
 * millisecond so the linearizer's earliest-child tiebreak is testable.
 */
function msg(
  id: string,
  parentId: string | null,
  t: number,
  branch?: Partial<MessageBranch> | null
): Row {
  return {
    id,
    conversationId: 'conv-1',
    parentId,
    role: MessageRole.ASSISTANT,
    content: id,
    provider: null,
    model: null,
    inputTokens: 0,
    outputTokens: 0,
    costCents: 0,
    isPinned: false,
    deletedAt: null,
    createdAt: new Date(1_700_000_000_000 + t),
    updatedAt: new Date(1_700_000_000_000 + t),
    branch: branch
      ? {
          id: `br-${id}`,
          messageId: id,
          branchIndex: 0,
          isMainBranch: false,
          createdAt: new Date(1_700_000_000_000 + t),
          ...branch,
        }
      : null,
    attachments: [],
  }
}

describe('linearizeCanonicalPath', () => {
  it('returns an unbranched conversation in creation order', () => {
    const path = linearizeCanonicalPath([
      msg('root', null, 0),
      msg('u1', 'root', 1),
      msg('a1', 'u1', 2),
      msg('u2', 'a1', 3),
      msg('a2', 'u2', 4),
    ])
    expect(path.map((m) => m.id)).toEqual(['root', 'u1', 'a1', 'u2', 'a2'])
    expect(path.every((m) => m.siblingCount === 1 && m.siblingIndex === 0)).toBe(true)
  })

  it('takes the earliest-created child when no branch is marked main', () => {
    // root → u1 → { a-early (first), a-late } — no MessageBranch record
    // on either → linearizer must pick a-early.
    const path = linearizeCanonicalPath([
      msg('root', null, 0),
      msg('u1', 'root', 1),
      msg('a-early', 'u1', 2),
      msg('a-late', 'u1', 3),
    ])
    expect(path.map((m) => m.id)).toEqual(['root', 'u1', 'a-early'])
    const forked = path.find((m) => m.id === 'a-early')!
    expect(forked.siblingCount).toBe(2)
    expect(forked.siblingIndex).toBe(0)
  })

  it('respects an explicit main-branch marker regardless of creation order', () => {
    // Same fork, but a-late is explicitly marked main — the user picked
    // it via the fork selector, so the canonical path must follow it.
    const path = linearizeCanonicalPath([
      msg('root', null, 0),
      msg('u1', 'root', 1),
      msg('a-early', 'u1', 2),
      msg('a-late', 'u1', 3, { isMainBranch: true }),
    ])
    expect(path.map((m) => m.id)).toEqual(['root', 'u1', 'a-late'])
    expect(path.at(-1)!.siblingIndex).toBe(1)
    expect(path.at(-1)!.siblingCount).toBe(2)
  })

  it('descends through branched forks so downstream messages still appear', () => {
    // root → u → { a-A (main), a-B } ; a-A → u2 → a2. Linearizer must
    // continue past the fork under a-A, not stop at the fork itself.
    const path = linearizeCanonicalPath([
      msg('root', null, 0),
      msg('u', 'root', 1),
      msg('a-A', 'u', 2, { isMainBranch: true }),
      msg('a-B', 'u', 3),
      msg('u2', 'a-A', 4),
      msg('a2', 'u2', 5),
    ])
    expect(path.map((m) => m.id)).toEqual(['root', 'u', 'a-A', 'u2', 'a2'])
  })

  it('handles multiple roots by walking each subtree in order', () => {
    // Rare but possible (system message with no parent + user message
    // with no parent); the linearizer must not silently drop one.
    const path = linearizeCanonicalPath([
      msg('sys', null, 0),
      msg('root2', null, 1),
      msg('reply', 'root2', 2),
    ])
    expect(path.map((m) => m.id)).toEqual(['sys', 'root2', 'reply'])
    expect(path[0].siblingCount).toBe(2)
    expect(path[0].siblingIndex).toBe(0)
    expect(path[1].siblingCount).toBe(2)
    expect(path[1].siblingIndex).toBe(1)
  })

  it('returns an empty path for an empty conversation', () => {
    expect(linearizeCanonicalPath([])).toEqual([])
  })
})
