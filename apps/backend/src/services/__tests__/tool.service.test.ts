import { describe, it, expect, beforeEach, vi } from 'vitest';
import { toolService } from '../tool.service';
import * as checks from '../checks';

vi.mock('../checks');
vi.mock('@synora/database', () => ({
  prisma: {
    toolDefinition: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    toolExecution: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
  },
}));

const mockUser = { id: 'user-1', email: 'test@example.com' };
const mockWorkspace = { id: 'workspace-1' };

describe('ToolService', () => {
  beforeEach(() => {
    vi.mocked(checks.requireMembership as any).mockResolvedValue(undefined);
  });

  describe('createTool', () => {
    it('should create a tool with valid input', async () => {
      const { prisma } = await import('@synora/database');

      vi.mocked(prisma.toolDefinition.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.toolDefinition.create).mockResolvedValueOnce({
        id: 'tool-1',
        workspaceId: mockWorkspace.id,
        name: 'test-tool',
        displayName: 'Test Tool',
        description: 'A test tool',
        category: 'http',
        type: 'HTTP' as any,
        inputSchema: { type: 'object' },
        outputSchema: null,
        config: { url: 'http://example.com' },
        secrets: [],
        capabilities: [],
        permission: 'PRIVATE' as any,
        maxParallelCalls: 10,
        rateLimit: null,
        timeout: 30000,
        maxRetries: 3,
        isActive: true,
        isAsync: false,
        supportsStreaming: false,
        requiresApproval: false,
        version: 1,
        parentId: null,
        createdBy: mockUser.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      const result = await toolService.createTool(mockUser.id, mockWorkspace.id, {
        name: 'test-tool',
        displayName: 'Test Tool',
        description: 'A test tool',
        category: 'http',
        type: 'HTTP',
        inputSchema: { type: 'object' },
        config: { url: 'http://example.com' },
      });

      expect(result.id).toBe('tool-1');
      expect(result.name).toBe('test-tool');
    });

    it('should reject duplicate tool names', async () => {
      const { prisma } = await import('@synora/database');

      vi.mocked(prisma.toolDefinition.findFirst).mockResolvedValueOnce({
        id: 'existing-tool',
      } as any);

      await expect(
        toolService.createTool(mockUser.id, mockWorkspace.id, {
          name: 'test-tool',
          displayName: 'Test Tool',
          description: 'A test tool',
          category: 'http',
          type: 'HTTP',
          inputSchema: { type: 'object' },
          config: { url: 'http://example.com' },
        })
      ).rejects.toThrow();
    });
  });

  describe('listTools', () => {
    it('should list active tools', async () => {
      const { prisma } = await import('@synora/database');

      vi.mocked(prisma.toolDefinition.findMany).mockResolvedValueOnce([
        {
          id: 'tool-1',
          name: 'Tool 1',
          isActive: true,
        } as any,
      ]);

      const result = await toolService.listTools(mockUser.id, mockWorkspace.id);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Tool 1');
    });

    it('should filter by category', async () => {
      const { prisma } = await import('@synora/database');

      vi.mocked(prisma.toolDefinition.findMany).mockResolvedValueOnce([
        {
          id: 'tool-1',
          name: 'HTTP Tool',
          category: 'http',
        } as any,
      ]);

      const result = await toolService.listTools(mockUser.id, mockWorkspace.id, 'http');

      expect(vi.mocked(prisma.toolDefinition.findMany).mock.calls[0][0]).toMatchObject({
        where: {
          workspaceId: mockWorkspace.id,
          isActive: true,
          category: 'http',
        },
      });
    });
  });

  describe('executeTool', () => {
    it('should create an execution record', async () => {
      const { prisma } = await import('@synora/database');

      vi.mocked(prisma.toolDefinition.findUnique).mockResolvedValueOnce({
        id: 'tool-1',
        workspaceId: mockWorkspace.id,
        isActive: true,
        rateLimit: null,
        requiresApproval: false,
        inputSchema: { type: 'object', required: [] },
      } as any);

      vi.mocked(prisma.toolExecution.create).mockResolvedValueOnce({
        id: 'exec-1',
        toolId: 'tool-1',
        workspaceId: mockWorkspace.id,
        userId: mockUser.id,
        input: { test: 'input' },
        status: 'RUNNING',
      } as any);

      const result = await toolService.executeTool(mockUser.id, mockWorkspace.id, 'tool-1', {
        input: { test: 'input' },
      });

      expect(result.id).toBe('exec-1');
      expect(result.status).toBe('RUNNING');
    });

    it('should check rate limits', async () => {
      const { prisma } = await import('@synora/database');

      vi.mocked(prisma.toolDefinition.findUnique).mockResolvedValueOnce({
        id: 'tool-1',
        workspaceId: mockWorkspace.id,
        isActive: true,
        rateLimit: 5,
        requiresApproval: false,
        inputSchema: { type: 'object', required: [] },
      } as any);

      vi.mocked(prisma.toolExecution.count).mockResolvedValueOnce(5);

      await expect(
        toolService.executeTool(mockUser.id, mockWorkspace.id, 'tool-1', {
          input: { test: 'input' },
        })
      ).rejects.toThrow();
    });
  });

  describe('approveExecution', () => {
    it('should update execution status to APPROVED', async () => {
      const { prisma } = await import('@synora/database');

      vi.mocked(prisma.toolExecution.findUnique).mockResolvedValueOnce({
        id: 'exec-1',
        workspaceId: mockWorkspace.id,
        status: 'PENDING',
      } as any);

      vi.mocked(prisma.toolExecution.update).mockResolvedValueOnce({
        id: 'exec-1',
        status: 'APPROVED',
      } as any);

      const result = await toolService.approveExecution(mockUser.id, mockWorkspace.id, 'exec-1');

      expect(result.status).toBe('APPROVED');
    });
  });
});
