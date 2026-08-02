import { describe, it, expect, beforeEach, vi } from 'vitest';
import { toolService } from '../tool.service';
import * as checks from '../checks';

vi.mock('../checks');
vi.mock('../audit.service', () => ({
  recordAuditEvent: vi.fn().mockResolvedValue(undefined),
}));
// Keep SUPPORTED_EXECUTION_TYPES / validateToolInput real; only the
// async engine hand-off is stubbed so tests never hit the network.
vi.mock('../tool-engine.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../tool-engine.service')>();
  return {
    ...actual,
    toolEngineService: {
      executeWithRetries: vi.fn().mockResolvedValue(undefined),
    },
  };
});
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

function memberAs(role: string) {
  vi.mocked(checks.requireMembership).mockResolvedValue({ id: 'member-1', role } as never);
}

function httpToolFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tool-1',
    workspaceId: mockWorkspace.id,
    name: 'test-tool',
    displayName: 'Test Tool',
    description: 'A test tool',
    category: 'http',
    type: 'HTTP',
    inputSchema: { type: 'object', required: [] },
    outputSchema: null,
    config: { url: 'https://example.com/hook' },
    secrets: [],
    capabilities: [],
    permission: 'PRIVATE',
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
    ...overrides,
  };
}

describe('ToolService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    memberAs('OWNER');
  });

  describe('createTool', () => {
    it('should create a tool with valid input', async () => {
      const { prisma } = await import('@synora/database');

      vi.mocked(prisma.toolDefinition.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.toolDefinition.create).mockResolvedValueOnce(httpToolFixture() as never);

      const result = await toolService.createTool(mockUser.id, mockWorkspace.id, {
        name: 'test-tool',
        displayName: 'Test Tool',
        description: 'A test tool',
        category: 'http',
        type: 'HTTP',
        inputSchema: { type: 'object' },
        config: { url: 'https://example.com/hook' },
      });

      expect(result.id).toBe('tool-1');
      expect(result.name).toBe('test-tool');
    });

    it('should reject duplicate tool names', async () => {
      const { prisma } = await import('@synora/database');

      vi.mocked(prisma.toolDefinition.findFirst).mockResolvedValueOnce({
        id: 'existing-tool',
      } as never);

      await expect(
        toolService.createTool(mockUser.id, mockWorkspace.id, {
          name: 'test-tool',
          displayName: 'Test Tool',
          description: 'A test tool',
          category: 'http',
          type: 'HTTP',
          inputSchema: { type: 'object' },
          config: { url: 'https://example.com/hook' },
        })
      ).rejects.toThrow();
    });

    it('should reject an HTTP tool without a config url', async () => {
      await expect(
        toolService.createTool(mockUser.id, mockWorkspace.id, {
          name: 'broken',
          displayName: 'Broken',
          description: 'no url',
          category: 'http',
          type: 'HTTP',
          inputSchema: { type: 'object' },
          config: {},
        })
      ).rejects.toThrow(/url/);
    });

    it('should reject non-http(s) config urls', async () => {
      await expect(
        toolService.createTool(mockUser.id, mockWorkspace.id, {
          name: 'broken',
          displayName: 'Broken',
          description: 'bad protocol',
          category: 'http',
          type: 'HTTP',
          inputSchema: { type: 'object' },
          config: { url: 'file:///etc/passwd' },
        })
      ).rejects.toThrow(/http or https/);
    });

    it('should require the tool:manage permission (VIEWER refused)', async () => {
      memberAs('VIEWER');
      await expect(
        toolService.createTool(mockUser.id, mockWorkspace.id, {
          name: 'test-tool',
          displayName: 'Test Tool',
          description: 'A test tool',
          category: 'http',
          type: 'HTTP',
          inputSchema: { type: 'object' },
          config: { url: 'https://example.com/hook' },
        })
      ).rejects.toThrow(/permission/);
    });

    it('should refuse MEMBER role for tool creation', async () => {
      memberAs('MEMBER');
      await expect(
        toolService.createTool(mockUser.id, mockWorkspace.id, {
          name: 'test-tool',
          displayName: 'Test Tool',
          description: 'A test tool',
          category: 'http',
          type: 'HTTP',
          inputSchema: { type: 'object' },
          config: { url: 'https://example.com/hook' },
        })
      ).rejects.toThrow(/permission/);
    });
  });

  describe('listTools', () => {
    it('should list active tools', async () => {
      const { prisma } = await import('@synora/database');

      vi.mocked(prisma.toolDefinition.findMany).mockResolvedValueOnce([
        httpToolFixture({ name: 'Tool 1' }) as never,
      ]);

      const result = await toolService.listTools(mockUser.id, mockWorkspace.id);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Tool 1');
    });

    it('should filter by category', async () => {
      const { prisma } = await import('@synora/database');

      vi.mocked(prisma.toolDefinition.findMany).mockResolvedValueOnce([
        httpToolFixture() as never,
      ]);

      await toolService.listTools(mockUser.id, mockWorkspace.id, 'http');

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
    it('should create an execution record for a supported tool type', async () => {
      const { prisma } = await import('@synora/database');

      vi.mocked(prisma.toolDefinition.findUnique).mockResolvedValueOnce(
        httpToolFixture() as never
      );
      vi.mocked(prisma.toolExecution.create).mockResolvedValueOnce({
        id: 'exec-1',
        toolId: 'tool-1',
        workspaceId: mockWorkspace.id,
        userId: mockUser.id,
        input: { test: 'input' },
        status: 'RUNNING',
      } as never);

      const result = await toolService.executeTool(mockUser.id, mockWorkspace.id, 'tool-1', {
        input: { test: 'input' },
      });

      expect(result.id).toBe('exec-1');
      expect(result.status).toBe('RUNNING');
    });

    it('should refuse tool types without a real executor', async () => {
      const { prisma } = await import('@synora/database');

      vi.mocked(prisma.toolDefinition.findUnique).mockResolvedValueOnce(
        httpToolFixture({ type: 'Python' }) as never
      );

      await expect(
        toolService.executeTool(mockUser.id, mockWorkspace.id, 'tool-1', { input: {} })
      ).rejects.toThrow(/not supported yet/);
      expect(vi.mocked(prisma.toolExecution.create)).not.toHaveBeenCalled();
    });

    it('should reject input missing schema-required fields before creating an execution', async () => {
      const { prisma } = await import('@synora/database');

      vi.mocked(prisma.toolDefinition.findUnique).mockResolvedValueOnce(
        httpToolFixture({ inputSchema: { type: 'object', required: ['city'] } }) as never
      );

      await expect(
        toolService.executeTool(mockUser.id, mockWorkspace.id, 'tool-1', { input: {} })
      ).rejects.toThrow(/Missing required field: city/);
      expect(vi.mocked(prisma.toolExecution.create)).not.toHaveBeenCalled();
    });

    it('should check rate limits', async () => {
      const { prisma } = await import('@synora/database');

      vi.mocked(prisma.toolDefinition.findUnique).mockResolvedValueOnce(
        httpToolFixture({ rateLimit: 5 }) as never
      );
      vi.mocked(prisma.toolExecution.count).mockResolvedValueOnce(5);

      await expect(
        toolService.executeTool(mockUser.id, mockWorkspace.id, 'tool-1', {
          input: { test: 'input' },
        })
      ).rejects.toThrow(/rate limit/);
    });

    it('should refuse VIEWER executions', async () => {
      memberAs('VIEWER');
      await expect(
        toolService.executeTool(mockUser.id, mockWorkspace.id, 'tool-1', { input: {} })
      ).rejects.toThrow(/permission/);
    });

    it('should create approval-gated executions as PENDING without running them', async () => {
      const { prisma } = await import('@synora/database');

      vi.mocked(prisma.toolDefinition.findUnique).mockResolvedValueOnce(
        httpToolFixture({ requiresApproval: true }) as never
      );
      vi.mocked(prisma.toolExecution.create).mockResolvedValueOnce({
        id: 'exec-1',
        status: 'PENDING',
      } as never);

      const result = await toolService.executeTool(mockUser.id, mockWorkspace.id, 'tool-1', {
        input: {},
      });

      expect(result.status).toBe('PENDING');
      expect(vi.mocked(prisma.toolExecution.create).mock.calls[0][0].data.status).toBe('PENDING');
    });
  });

  describe('approveExecution', () => {
    it('approves a PENDING execution, stamping approvedBy', async () => {
      const { prisma } = await import('@synora/database');

      vi.mocked(prisma.toolExecution.findUnique).mockResolvedValueOnce({
        id: 'exec-1',
        toolId: 'tool-1',
        workspaceId: mockWorkspace.id,
        userId: 'requester-1',
        status: 'PENDING',
        input: {},
      } as never);
      vi.mocked(prisma.toolDefinition.findUnique).mockResolvedValueOnce(
        httpToolFixture() as never
      );
      vi.mocked(prisma.toolExecution.update).mockResolvedValueOnce({
        id: 'exec-1',
        status: 'APPROVED',
      } as never);

      const result = await toolService.approveExecution(mockUser.id, mockWorkspace.id, 'exec-1');

      expect(result.status).toBe('APPROVED');
      const updateArgs = vi.mocked(prisma.toolExecution.update).mock.calls[0][0];
      expect(updateArgs.data).toMatchObject({
        status: 'APPROVED',
        approvedBy: mockUser.id,
      });
      expect(updateArgs.data.approvedAt).toBeInstanceOf(Date);
    });

    it('refuses to approve an execution that is not PENDING', async () => {
      const { prisma } = await import('@synora/database');

      vi.mocked(prisma.toolExecution.findUnique).mockResolvedValueOnce({
        id: 'exec-1',
        toolId: 'tool-1',
        workspaceId: mockWorkspace.id,
        status: 'COMPLETED',
        input: {},
      } as never);

      await expect(
        toolService.approveExecution(mockUser.id, mockWorkspace.id, 'exec-1')
      ).rejects.toThrow(/pending/i);
    });

    it('requires the tool:approve permission (MEMBER refused)', async () => {
      memberAs('MEMBER');
      await expect(
        toolService.approveExecution(mockUser.id, mockWorkspace.id, 'exec-1')
      ).rejects.toThrow(/permission/);
    });
  });

  describe('rejectExecution', () => {
    it('rejects a PENDING execution with a reason', async () => {
      const { prisma } = await import('@synora/database');

      vi.mocked(prisma.toolExecution.findUnique).mockResolvedValueOnce({
        id: 'exec-1',
        toolId: 'tool-1',
        workspaceId: mockWorkspace.id,
        userId: 'requester-1',
        status: 'PENDING',
        input: {},
      } as never);
      vi.mocked(prisma.toolExecution.update).mockResolvedValueOnce({
        id: 'exec-1',
        status: 'REJECTED',
        rejectionReason: 'Untrusted endpoint',
      } as never);

      const result = await toolService.rejectExecution(
        mockUser.id,
        mockWorkspace.id,
        'exec-1',
        'Untrusted endpoint'
      );

      expect(result.status).toBe('REJECTED');
      expect(vi.mocked(prisma.toolExecution.update).mock.calls[0][0].data).toMatchObject({
        status: 'REJECTED',
        rejectedBy: mockUser.id,
        rejectionReason: 'Untrusted endpoint',
      });
    });

    it('refuses to reject a non-PENDING execution', async () => {
      const { prisma } = await import('@synora/database');

      vi.mocked(prisma.toolExecution.findUnique).mockResolvedValueOnce({
        id: 'exec-1',
        toolId: 'tool-1',
        workspaceId: mockWorkspace.id,
        status: 'RUNNING',
        input: {},
      } as never);

      await expect(
        toolService.rejectExecution(mockUser.id, mockWorkspace.id, 'exec-1', 'too late')
      ).rejects.toThrow(/pending/i);
    });
  });
});
