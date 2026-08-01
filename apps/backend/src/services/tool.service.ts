import { prisma } from '@synora/database';
import { ToolDefinition, ToolExecution, ExecutionStatus, ToolType } from '@prisma/client';
import { NotFoundException, ValidationException } from '@synora/shared';
import { logger } from '../utils/logger';
import { requireMembership } from './checks';
import type { InputJsonValue } from '@prisma/client/runtime/library';

export interface CreateToolInput {
  name: string;
  displayName: string;
  description: string;
  category: string;
  type: ToolType;
  inputSchema: InputJsonValue;
  outputSchema?: InputJsonValue;
  config: InputJsonValue;
  secrets?: string[];
  capabilities?: string[];
  permission?: 'PRIVATE' | 'WORKSPACE' | 'SHARED' | 'PUBLIC';
  maxParallelCalls?: number;
  rateLimit?: number;
  timeout?: number;
  maxRetries?: number;
  isAsync?: boolean;
  supportsStreaming?: boolean;
  requiresApproval?: boolean;
}

export interface ExecuteToolInput {
  input: Record<string, unknown>;
  conversationId?: string;
}

export class ToolService {
  async createTool(userId: string, workspaceId: string, data: CreateToolInput): Promise<ToolDefinition> {
    await requireMembership(userId, workspaceId);

    // Validate tool name is unique within workspace
    const existing = await prisma.toolDefinition.findFirst({
      where: { workspaceId, name: data.name },
    });

    if (existing) {
      throw new ValidationException(`Tool with name "${data.name}" already exists in this workspace`);
    }

    return prisma.toolDefinition.create({
      data: {
        workspaceId,
        name: data.name,
        displayName: data.displayName,
        description: data.description,
        category: data.category,
        type: data.type,
        inputSchema: data.inputSchema as InputJsonValue,
        outputSchema: data.outputSchema ? (data.outputSchema as InputJsonValue) : undefined,
        config: data.config as InputJsonValue,
        secrets: data.secrets || [],
        capabilities: data.capabilities || [],
        permission: data.permission || 'PRIVATE',
        maxParallelCalls: data.maxParallelCalls || 10,
        rateLimit: data.rateLimit || null,
        timeout: data.timeout || 30000,
        maxRetries: data.maxRetries || 3,
        isAsync: data.isAsync || false,
        supportsStreaming: data.supportsStreaming || false,
        requiresApproval: data.requiresApproval || false,
        createdBy: userId,
      },
    });
  }

  async getTool(userId: string, workspaceId: string, toolId: string): Promise<ToolDefinition> {
    await requireMembership(userId, workspaceId);

    const tool = await prisma.toolDefinition.findUnique({
      where: { id: toolId },
    });

    if (!tool || tool.workspaceId !== workspaceId) {
      throw new NotFoundException('Tool not found');
    }

    return tool;
  }

  async listTools(userId: string, workspaceId: string, category?: string): Promise<ToolDefinition[]> {
    await requireMembership(userId, workspaceId);

    return prisma.toolDefinition.findMany({
      where: {
        workspaceId,
        isActive: true,
        ...(category && { category }),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateTool(userId: string, workspaceId: string, toolId: string, data: Partial<CreateToolInput>): Promise<ToolDefinition> {
    await requireMembership(userId, workspaceId);

    const tool = await this.getTool(userId, workspaceId, toolId);

    return prisma.toolDefinition.update({
      where: { id: toolId },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.displayName && { displayName: data.displayName }),
        ...(data.description && { description: data.description }),
        ...(data.category && { category: data.category }),
        ...(data.inputSchema && { inputSchema: data.inputSchema as InputJsonValue }),
        ...(data.outputSchema && { outputSchema: data.outputSchema as InputJsonValue }),
        ...(data.config && { config: data.config as InputJsonValue }),
        ...(data.secrets !== undefined && { secrets: data.secrets }),
        ...(data.capabilities !== undefined && { capabilities: data.capabilities }),
        ...(data.permission && { permission: data.permission }),
        ...(data.maxParallelCalls !== undefined && { maxParallelCalls: data.maxParallelCalls }),
        ...(data.rateLimit !== undefined && { rateLimit: data.rateLimit }),
        ...(data.timeout !== undefined && { timeout: data.timeout }),
        ...(data.maxRetries !== undefined && { maxRetries: data.maxRetries }),
        ...(data.isAsync !== undefined && { isAsync: data.isAsync }),
        ...(data.supportsStreaming !== undefined && { supportsStreaming: data.supportsStreaming }),
        ...(data.requiresApproval !== undefined && { requiresApproval: data.requiresApproval }),
        version: tool.version + 1,
      },
    });
  }

  async deleteTool(userId: string, workspaceId: string, toolId: string): Promise<void> {
    await requireMembership(userId, workspaceId);

    const _tool = await this.getTool(userId, workspaceId, toolId);

    await prisma.toolDefinition.update({
      where: { id: toolId },
      data: { isActive: false },
    });

    logger.info('Tool deleted (soft)', { toolId, workspaceId });
  }

  async executeTool(userId: string, workspaceId: string, toolId: string, data: ExecuteToolInput): Promise<ToolExecution> {
    await requireMembership(userId, workspaceId);

    const tool = await this.getTool(userId, workspaceId, toolId);

    if (!tool.isActive) {
      throw new ValidationException('Tool is not active');
    }

    // Validate input against schema
    try {
      // Simple validation: check required fields exist
      if (tool.inputSchema && typeof tool.inputSchema === 'object') {
        const schema = tool.inputSchema as Record<string, unknown>;
        const required = (schema.required || []) as string[];
        for (const field of required) {
          if (!(field in data.input)) {
            throw new Error(`Missing required field: ${field}`);
          }
        }
      }
    } catch (error) {
      throw new ValidationException(`Invalid tool input: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Check rate limit
    if (tool.rateLimit) {
      const oneMinuteAgo = new Date(Date.now() - 60000);
      const recentExecutions = await prisma.toolExecution.count({
        where: {
          toolId,
          createdAt: { gte: oneMinuteAgo },
        },
      });

      if (recentExecutions >= tool.rateLimit) {
        throw new ValidationException(`Tool rate limit exceeded (${tool.rateLimit} calls per minute)`);
      }
    }

    // Create execution record
    const execution = await prisma.toolExecution.create({
      data: {
        toolId,
        workspaceId,
        userId,
        conversationId: data.conversationId || null,
        input: data.input as InputJsonValue,
        status: tool.requiresApproval ? ExecutionStatus.PENDING : ExecutionStatus.RUNNING,
      },
    });

    logger.info('Tool execution started', { executionId: execution.id, toolId, userId });

    // Trigger async execution if approval not required
    if (!tool.requiresApproval) {
      setImmediate(async () => {
        try {
          const { toolEngineService } = await import('./tool-engine.service');
          await toolEngineService.executeWithRetries(execution.id, toolId, data.input, { timeout: tool.timeout || 30000 });
        } catch (error) {
          logger.error('[toolService] Tool execution failed', {
            executionId: execution.id,
            toolId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    }

    return execution;
  }

  async getExecution(userId: string, workspaceId: string, executionId: string): Promise<ToolExecution> {
    await requireMembership(userId, workspaceId);

    const execution = await prisma.toolExecution.findUnique({
      where: { id: executionId },
    });

    if (!execution || execution.workspaceId !== workspaceId) {
      throw new NotFoundException('Execution not found');
    }

    return execution;
  }

  async listExecutions(userId: string, workspaceId: string, toolId?: string): Promise<ToolExecution[]> {
    await requireMembership(userId, workspaceId);

    return prisma.toolExecution.findMany({
      where: {
        workspaceId,
        ...(toolId && { toolId }),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async updateExecutionStatus(
    userId: string,
    workspaceId: string,
    executionId: string,
    status: ExecutionStatus,
    output?: Record<string, unknown>,
    error?: string
  ): Promise<ToolExecution> {
    await requireMembership(userId, workspaceId);

    const execution = await this.getExecution(userId, workspaceId, executionId);

    const completedAt = ['COMPLETED', 'FAILED', 'CANCELLED', 'TIMEOUT', 'REJECTED'].includes(status)
      ? new Date()
      : null;

    const duration = completedAt && execution.startedAt ? completedAt.getTime() - execution.startedAt.getTime() : null;

    return prisma.toolExecution.update({
      where: { id: executionId },
      data: {
        status,
        output: output ? (output as InputJsonValue) : undefined,
        error: error || null,
        completedAt,
        duration: duration || execution.duration,
      },
    });
  }

  async approveExecution(userId: string, workspaceId: string, executionId: string): Promise<ToolExecution> {
    const execution = await this.updateExecutionStatus(userId, workspaceId, executionId, ExecutionStatus.APPROVED);

    // Trigger async execution after approval
    setImmediate(async () => {
      try {
        const tool = await this.getTool(userId, workspaceId, execution.toolId);
        const { toolEngineService } = await import('./tool-engine.service');
        await toolEngineService.executeWithRetries(execution.id, execution.toolId, execution.input as Record<string, unknown>, {
          timeout: tool.timeout || 30000,
        });
      } catch (error) {
        logger.error('[toolService] Tool execution after approval failed', {
          executionId: execution.id,
          toolId: execution.toolId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    return execution;
  }

  async rejectExecution(userId: string, workspaceId: string, executionId: string, reason: string): Promise<ToolExecution> {
    const _execution = await this.getExecution(userId, workspaceId, executionId);

    return prisma.toolExecution.update({
      where: { id: executionId },
      data: {
        status: ExecutionStatus.REJECTED,
        rejectedBy: userId,
        rejectedAt: new Date(),
        rejectionReason: reason,
      },
    });
  }
}

export const toolService = new ToolService();
