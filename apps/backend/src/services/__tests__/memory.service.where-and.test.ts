/**
 * Regression test for the double-where.OR bug in MemoryService.searchMemories.
 *
 * Before the fix, the code did:
 *   where.OR = [searchClause]   // set search
 *   where.OR = [permissionClauses]  // OVERWRITES search — search never reached the DB
 *
 * This test verifies that when a searchTerm is provided, the Prisma query
 * contains BOTH a search clause AND a permission clause inside where.AND,
 * so neither is silently dropped.
 *
 * Red/fail without the fix: prisma.memory.findMany would be called with
 * where.AND undefined (or missing the search entry) and where.OR set only
 * to the permission filter.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { MemoryService } from '../memory.service'

vi.mock('@synora/database', () => ({
  prisma: {
    memory: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
  },
  MemoryPermission: {
    PRIVATE: 'PRIVATE',
    WORKSPACE: 'WORKSPACE',
    SHARED: 'SHARED',
    PUBLIC: 'PUBLIC',
  },
  MemoryType: { FACT: 'FACT', PREFERENCE: 'PREFERENCE', CONTEXT: 'CONTEXT', INSTRUCTION: 'INSTRUCTION' },
  MemoryStatus: { ACTIVE: 'ACTIVE', ARCHIVED: 'ARCHIVED' },
}))

// Avoid real cache (Redis) in tests
vi.mock('../memoryCache.service', () => ({
  memoryCacheService: {
    getCachedSearch: vi.fn().mockResolvedValue(null),
    cacheSearchResults: vi.fn().mockResolvedValue(undefined),
    recordMemoryAccess: vi.fn().mockResolvedValue(undefined),
  },
}))

const { prisma } = await import('@synora/database')
const findManyMock = vi.mocked(prisma.memory.findMany)

describe('MemoryService.searchMemories — where.AND fix', () => {
  let service: MemoryService

  beforeEach(() => {
    service = new MemoryService()
    findManyMock.mockClear()
  })

  it('applies BOTH search clause AND permission filter when searchTerm is provided', async () => {
    await service.searchMemories(
      {
        workspaceId: 'ws-1',
        searchTerm: 'deploy runbook',
        limit: 10,
        offset: 0,
      },
      'user-1',
    )

    expect(findManyMock).toHaveBeenCalledOnce()
    const callArgs = findManyMock.mock.calls[0][0] as { where: Record<string, unknown> }
    const where = callArgs.where

    // The fix: both clauses must live inside where.AND
    expect(where.AND).toBeDefined()
    const andClauses = where.AND as unknown[]
    expect(andClauses.length).toBeGreaterThanOrEqual(2)

    // One AND entry must contain the search term in an OR
    const hasSearchClause = andClauses.some((clause) => {
      const c = clause as Record<string, unknown>
      return 'OR' in c && JSON.stringify(c.OR).includes('deploy runbook')
    })
    expect(hasSearchClause).toBe(true)

    // One AND entry must contain a permission OR
    const hasPermissionClause = andClauses.some((clause) => {
      const c = clause as Record<string, unknown>
      return 'OR' in c && JSON.stringify(c.OR).includes('PRIVATE')
    })
    expect(hasPermissionClause).toBe(true)

    // The old bug: where.OR must NOT be the top-level permission filter
    // (if it is, the search term was dropped)
    const topLevelOR = where.OR as unknown[] | undefined
    if (topLevelOR) {
      const isJustPermissions = topLevelOR.every((clause) =>
        JSON.stringify(clause).includes('permission'),
      )
      expect(isJustPermissions).toBe(false)
    }
  })

  it('still applies permission filter even when no searchTerm is given', async () => {
    await service.searchMemories({ workspaceId: 'ws-1', limit: 10, offset: 0 }, 'user-1')

    const callArgs = findManyMock.mock.calls[0][0] as { where: Record<string, unknown> }
    const where = callArgs.where

    // Permission must be enforced regardless of search
    expect(where.AND).toBeDefined()
    const andClauses = where.AND as unknown[]
    const hasPermissionClause = andClauses.some((clause) => {
      const c = clause as Record<string, unknown>
      return 'OR' in c && JSON.stringify(c.OR).includes('PRIVATE')
    })
    expect(hasPermissionClause).toBe(true)
  })
})
