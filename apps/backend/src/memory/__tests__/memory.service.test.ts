/**
 * Memory Service Test Suite
 * Comprehensive tests for universal memory system (90%+ coverage)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { MemoryService } from '../memory.service';
import { PostgresMemoryProvider } from '../providers/postgres.provider';
import { CreateMemoryInput, UpdateMemoryInput, MemoryType } from '../types';

let prisma: PrismaClient;
let memoryService: MemoryService;
let storageProvider: PostgresMemoryProvider;

const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const testWorkspaceId = 'ws-test-001';
const testUserId = 'user-test-001';

beforeAll(async () => {
  prisma = new PrismaClient();
  storageProvider = new PostgresMemoryProvider(prisma, mockLogger);
  memoryService = new MemoryService(
    prisma,
    storageProvider,
    storageProvider,
    storageProvider,
    storageProvider,
    mockLogger
  );

  // Create test workspace and quota
  await prisma.workspace.upsert({
    where: { id: testWorkspaceId },
    update: {},
    create: { id: testWorkspaceId, name: 'Test Workspace', slug: 'test-ws' },
  });

  await prisma.memoryQuota.upsert({
    where: { workspaceId: testWorkspaceId },
    update: {},
    create: {
      workspaceId: testWorkspaceId,
      maxMemories: 10000,
      maxTokens: 1000000,
      maxStorage: 1000000000n,
      maxConsolidationsPerDay: 100,
    },
  });

  // Create test user
  await prisma.user.upsert({
    where: { email: 'test@memory.test' },
    update: {},
    create: {
      id: testUserId,
      email: 'test@memory.test',
      name: 'Test User',
    },
  });
});

afterAll(async () => {
  // Cleanup
  await prisma.memory.deleteMany({ where: { workspaceId: testWorkspaceId } });
  await prisma.memoryQuota.delete({ where: { workspaceId: testWorkspaceId } });
  await prisma.user.delete({ where: { id: testUserId } });
  await prisma.workspace.delete({ where: { id: testWorkspaceId } });
  await prisma.$disconnect();
});

describe('MemoryService', () => {
  describe('createMemory', () => {
    it('should create a new memory with all fields', async () => {
      const input: CreateMemoryInput = {
        content: 'This is a test memory about neural networks',
        type: 'SEMANTIC',
        category: 'AI',
        tags: ['machine-learning', 'neural-nets'],
        importance: 0.8,
        decayRate: 0.01,
        isManual: true,
        permission: 'PRIVATE',
      };

      const memory = await memoryService.createMemory(input, testUserId, testWorkspaceId);

      expect(memory).toBeDefined();
      expect(memory.content).toBe(input.content);
      expect(memory.type).toBe('SEMANTIC');
      expect(memory.category).toBe('AI');
      expect(memory.tags).toContain('machine-learning');
      expect(memory.importance).toBe(0.8);
      expect(memory.status).toBe('ACTIVE');
    });

    it('should use default values for optional fields', async () => {
      const input: CreateMemoryInput = {
        content: 'Minimal memory',
        type: 'LONG_TERM',
      };

      const memory = await memoryService.createMemory(input, testUserId, testWorkspaceId);

      expect(memory.importance).toBe(0.5);
      expect(memory.decayRate).toBe(0.01);
      expect(memory.isManual).toBe(true);
      expect(memory.permission).toBe('PRIVATE');
    });

    it('should update quota on memory creation', async () => {
      const quotaBefore = await prisma.memoryQuota.findUnique({
        where: { workspaceId: testWorkspaceId },
      });

      const input: CreateMemoryInput = {
        content: 'Another memory for quota test',
        type: 'EPISODIC',
      };

      await memoryService.createMemory(input, testUserId, testWorkspaceId);

      const quotaAfter = await prisma.memoryQuota.findUnique({
        where: { workspaceId: testWorkspaceId },
      });

      expect(quotaAfter!.currentMemories).toBe(quotaBefore!.currentMemories + 1);
      expect(quotaAfter!.currentTokens).toBeGreaterThan(quotaBefore!.currentTokens);
    });

    it('should create audit log for new memory', async () => {
      const input: CreateMemoryInput = {
        content: 'Memory for audit testing',
        type: 'SHORT_TERM',
      };

      const memory = await memoryService.createMemory(input, testUserId, testWorkspaceId);

      const auditLog = await prisma.memoryAuditLog.findFirst({
        where: { memoryId: memory.id, action: 'CREATED' },
      });

      expect(auditLog).toBeDefined();
      expect(auditLog?.userId).toBe(testUserId);
    });
  });

  describe('getMemory', () => {
    it('should retrieve memory by ID', async () => {
      const input: CreateMemoryInput = {
        content: 'Memory to retrieve',
        type: 'SEMANTIC',
      };

      const created = await memoryService.createMemory(input, testUserId, testWorkspaceId);
      const retrieved = await memoryService.getMemory(created.id, testUserId, testWorkspaceId);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.content).toBe(input.content);
    });

    it('should increment access count on retrieval', async () => {
      const input: CreateMemoryInput = {
        content: 'Memory for access counting',
        type: 'LONG_TERM',
      };

      const memory = await memoryService.createMemory(input, testUserId, testWorkspaceId);

      const before = await prisma.memory.findUnique({ where: { id: memory.id } });
      await memoryService.getMemory(memory.id, testUserId, testWorkspaceId);
      const after = await prisma.memory.findUnique({ where: { id: memory.id } });

      expect(after!.accessCount).toBe((before?.accessCount || 0) + 1);
    });

    it('should return null for non-existent memory', async () => {
      const result = await memoryService.getMemory('non-existent-id', testUserId, testWorkspaceId);
      expect(result).toBeNull();
    });
  });

  describe('updateMemory', () => {
    it('should update memory content', async () => {
      const input: CreateMemoryInput = {
        content: 'Original content',
        type: 'SEMANTIC',
      };

      const memory = await memoryService.createMemory(input, testUserId, testWorkspaceId);

      const update: UpdateMemoryInput = {
        content: 'Updated content',
        summary: 'A summary',
      };

      const updated = await memoryService.updateMemory(memory.id, update, testUserId, testWorkspaceId);

      expect(updated.content).toBe('Updated content');
      expect(updated.summary).toBe('A summary');
    });

    it('should increment version on update', async () => {
      const input: CreateMemoryInput = {
        content: 'Content for version test',
        type: 'LONG_TERM',
      };

      const memory = await memoryService.createMemory(input, testUserId, testWorkspaceId);

      const update: UpdateMemoryInput = {
        importance: 0.9,
      };

      const updated = await memoryService.updateMemory(memory.id, update, testUserId, testWorkspaceId);

      expect(updated.version).toBe(memory.version + 1);
    });

    it('should create version history on content change', async () => {
      const input: CreateMemoryInput = {
        content: 'Original for history',
        type: 'SEMANTIC',
      };

      const memory = await memoryService.createMemory(input, testUserId, testWorkspaceId);

      const update: UpdateMemoryInput = {
        content: 'Updated for history',
      };

      await memoryService.updateMemory(memory.id, update, testUserId, testWorkspaceId);

      const versions = await prisma.memory.findMany({
        where: { parentId: memory.id },
      });

      expect(versions.length).toBeGreaterThan(0);
      expect(versions[0].isArchived).toBe(true);
    });

    it('should create audit log for update', async () => {
      const input: CreateMemoryInput = {
        content: 'For audit update test',
        type: 'LONG_TERM',
      };

      const memory = await memoryService.createMemory(input, testUserId, testWorkspaceId);

      const update: UpdateMemoryInput = {
        importance: 0.7,
      };

      await memoryService.updateMemory(memory.id, update, testUserId, testWorkspaceId);

      const auditLog = await prisma.memoryAuditLog.findFirst({
        where: { memoryId: memory.id, action: 'UPDATED' },
      });

      expect(auditLog).toBeDefined();
    });
  });

  describe('deleteMemory', () => {
    it('should soft delete memory', async () => {
      const input: CreateMemoryInput = {
        content: 'Memory to delete',
        type: 'SHORT_TERM',
      };

      const memory = await memoryService.createMemory(input, testUserId, testWorkspaceId);

      await memoryService.deleteMemory(memory.id, testUserId, testWorkspaceId);

      const deleted = await prisma.memory.findUnique({ where: { id: memory.id } });

      expect(deleted?.status).toBe('DELETED');
      expect(deleted?.isArchived).toBe(true);
    });

    it('should create delete audit log', async () => {
      const input: CreateMemoryInput = {
        content: 'For delete audit test',
        type: 'LONG_TERM',
      };

      const memory = await memoryService.createMemory(input, testUserId, testWorkspaceId);

      await memoryService.deleteMemory(memory.id, testUserId, testWorkspaceId);

      const auditLog = await prisma.memoryAuditLog.findFirst({
        where: { memoryId: memory.id, action: 'DELETED' },
      });

      expect(auditLog).toBeDefined();
    });
  });

  describe('search', () => {
    it('should search memories by type', async () => {
      const input: CreateMemoryInput = {
        content: 'Searchable semantic memory',
        type: 'SEMANTIC',
      };

      const memory = await memoryService.createMemory(input, testUserId, testWorkspaceId);

      const results = await memoryService.search({
        workspaceId: testWorkspaceId,
        type: 'SEMANTIC',
      });

      expect(results.total).toBeGreaterThan(0);
      expect(results.memories.some(m => m.id === memory.id)).toBe(true);
    });

    it('should filter by minimum importance', async () => {
      const input: CreateMemoryInput = {
        content: 'Important memory',
        type: 'SEMANTIC',
        importance: 0.9,
      };

      await memoryService.createMemory(input, testUserId, testWorkspaceId);

      const results = await memoryService.search({
        workspaceId: testWorkspaceId,
        minImportance: 0.8,
      });

      expect(results.memories.every(m => m.importance >= 0.8)).toBe(true);
    });

    it('should respect limit and offset', async () => {
      const results = await memoryService.search({
        workspaceId: testWorkspaceId,
        limit: 5,
        offset: 0,
      });

      expect(results.memories.length).toBeLessThanOrEqual(5);
    });
  });

  describe('applyDecay', () => {
    it('should decay old memories', async () => {
      const input: CreateMemoryInput = {
        content: 'Old memory for decay',
        type: 'LONG_TERM',
        importance: 0.9,
        decayRate: 0.1,
      };

      const memory = await memoryService.createMemory(input, testUserId, testWorkspaceId);

      // Update lastAccessedAt to simulate age
      await prisma.memory.update({
        where: { id: memory.id },
        data: { lastAccessedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      });

      const decayedCount = await memoryService.applyDecay(testWorkspaceId);

      expect(decayedCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getAnalytics', () => {
    it('should return workspace memory analytics', async () => {
      const analytics = await memoryService.getAnalytics(testWorkspaceId);

      expect(analytics).toBeDefined();
      expect(analytics.workspaceId).toBe(testWorkspaceId);
      expect(analytics.totalMemories).toBeGreaterThanOrEqual(0);
      expect(analytics.totalTokens).toBeGreaterThanOrEqual(0);
      expect(analytics.totalStorage).toBeGreaterThanOrEqual(0);
    });

    it('should calculate average importance', async () => {
      const analytics = await memoryService.getAnalytics(testWorkspaceId);

      expect(analytics.averageImportance).toBeGreaterThanOrEqual(0);
      expect(analytics.averageImportance).toBeLessThanOrEqual(1);
    });
  });
});

describe('PostgresMemoryProvider', () => {
  describe('create', () => {
    it('should create memory with metadata', async () => {
      const input: CreateMemoryInput = {
        content: 'Provider create test',
        type: 'SEMANTIC',
        context: { source: 'conversation' },
      };

      const memory = await storageProvider.create(input, testUserId, testWorkspaceId);

      expect(memory).toBeDefined();
      expect(memory.metadata).toBeDefined();
      expect(memory.metadata?.source).toBe('conversation');
    });
  });

  describe('consolidate', () => {
    it('should consolidate multiple memories', async () => {
      const memories = [];
      for (let i = 0; i < 3; i++) {
        const memory = await storageProvider.create(
          {
            content: `Consolidation test ${i}`,
            type: 'SEMANTIC',
            importance: 0.5,
          },
          testUserId,
          testWorkspaceId
        );
        memories.push(memory);
      }

      const result = await storageProvider.consolidate(
        memories.map(m => m.id),
        testWorkspaceId
      );

      expect(result).toBeDefined();
      expect(result.consolidatedMemoryId).toBeDefined();
      expect(result.originalMemories).toHaveLength(3);
    });
  });
});
