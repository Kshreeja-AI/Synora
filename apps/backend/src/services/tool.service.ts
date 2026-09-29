import { prisma } from '@synora/database';
import { isIP } from 'node:net';
import { isPublicAddress } from './tool-transport';
import { ToolDefinition, ToolExecution, ExecutionStatus, ToolType } from '@prisma/client';
import { NotFoundException, ValidationException } from '@synora/shared';
import { logger } from '../utils/logger';
import { requireMembership } from './checks';
import { requirePermission } from './permissions';
import { recordAuditEvent } from './audit.service';
import { SUPPORTED_EXECUTION_TYPES, validateToolInput } from './tool-engine.service';
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

/**
 * Matches the placeholder syntax `tool-engine.service` substitutes at
 * execution time. Used here ONLY to read which secret names a config
 * references — never to resolve one.
 */
const SECRET_PLACEHOLDER_PATTERN = /\{\{secret:([A-Za-z0-9_.-]+)\}\}/g;

/** Methods whose shape is "ask for data" rather than "submit a change". */
const READ_SHAPED_METHODS = new Set(['GET', 'HEAD']);

/**
 * Wording for what Synora can and cannot do after the call. The read
 * case still refuses to promise nothing happens: Synora sees the method
 * it sends, never what the remote system chooses to do about it.
 */
function reversibilityNoteFor(method: string | undefined): string {
  if (method && READ_SHAPED_METHODS.has(method)) {
    return (
      `This is a ${method} request, which asks for data rather than submitting a change. ` +
      'Synora still cannot undo anything the remote system does in response.'
    );
  }
  return 'Synora cannot undo this once it runs — the request reaches a system outside Synora.';
}

export interface ToolExecutionPreview {
  toolId: string;
  toolName: string;
  type: ToolType;
  /** Literal: no request was sent and no execution record exists. */
  executed: false;
  /** True when a person must approve before this would actually run. */
  wouldRequireApproval: boolean;
  /**
   * Where the request would go. `hostDependsOnSecret` is true when the
   * host itself comes from a secret, in which case the real destination
   * is genuinely unknown here rather than hidden.
   */
  destination: { host: string | null; method: string; hostDependsOnSecret: boolean } | null;
  /** Names only. Values are never read, resolved, or returned. */
  secretsUsed: string[];
  /**
   * Whether Synora could undo the effect. A fact, not a grade: Synora
   * has no mechanism to recall an HTTP request, so for an executable
   * tool the answer is a certain no. Whether that matters is the
   * reader's call, which is why nothing here says "risky".
   */
  reversibleBySynora: boolean;
  reversibilityNote: string;
  rateLimit: { limitPerMinute: number; usedInLastMinute: number } | null;
  blockers: string[];
  unknowns: string[];
  wouldRun: boolean;
}

/**
 * HTTP-backed tool types must carry a usable endpoint in their config;
 * catching a bad URL at definition time beats failing every execution.
 */
function validateHttpConfig(type: ToolType, config: unknown): void {
  if (type !== ToolType.HTTP && type !== ToolType.Webhook) return;
  const url = (config as { url?: unknown } | null | undefined)?.url;
  if (typeof url !== 'string' || url.length === 0) {
    throw new ValidationException(`${type} tools require a "url" in their config`);
  }
  // Secret placeholders can appear anywhere in the URL; validate shape on
  // a version with placeholders collapsed to a syntactically valid token.
  const probe = url.replace(/\{\{secret:[A-Za-z0-9_.-]+\}\}/g, 'secret');
  let parsed: URL;
  try {
    parsed = new URL(probe);
  } catch {
    throw new ValidationException(`${type} tool config "url" is not a valid URL`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ValidationException(`${type} tool config "url" must use http or https`);
  }
  // Refuse an obviously-internal IP literal at CONFIGURATION time, so a
  // person gets a clear message now instead of a mysterious failure later.
  //
  // Reuses `isPublicAddress` from the transport rather than reimplementing
  // range checks: two copies of a security predicate eventually disagree,
  // and the more permissive copy wins by accident. The AUTHORITATIVE check
  // remains in the transport, which resolves DNS through a lookup hook at
  // connect time — a hostname's answer can change between saving a tool
  // and running it, so only the transport can see the address that is
  // actually dialled.
  const host = parsed.hostname;
  if (isIP(host) && !isPublicAddress(host)) {
    throw new ValidationException(
      `${type} tool config "url" points inside Synora's own network, which is not allowed`
    );
  }
}

export class ToolService {
  async createTool(userId: string, workspaceId: string, data: CreateToolInput): Promise<ToolDefinition> {
    const membership = await requireMembership(userId, workspaceId);
    requirePermission(membership.role, 'tool:manage');

    validateHttpConfig(data.type, data.config);

    // Validate tool name is unique within workspace
    const existing = await prisma.toolDefinition.findFirst({
      where: { workspaceId, name: data.name },
    });

    if (existing) {
      throw new ValidationException(`Tool with name "${data.name}" already exists in this workspace`);
    }

    const tool = await prisma.toolDefinition.create({
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

    await recordAuditEvent(workspaceId, userId, 'tool.created', 'tool', tool.id, {
      name: tool.name,
      type: tool.type,
    });

    return tool;
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
    const membership = await requireMembership(userId, workspaceId);
    requirePermission(membership.role, 'tool:manage');

    const tool = await this.getTool(userId, workspaceId, toolId);

    if (data.config !== undefined) {
      validateHttpConfig(tool.type, data.config);
    }

    const updated = await prisma.toolDefinition.update({
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

    await recordAuditEvent(workspaceId, userId, 'tool.updated', 'tool', toolId, {
      name: updated.name,
      version: updated.version,
    });

    return updated;
  }

  async deleteTool(userId: string, workspaceId: string, toolId: string): Promise<void> {
    const membership = await requireMembership(userId, workspaceId);
    requirePermission(membership.role, 'tool:manage');

    const tool = await this.getTool(userId, workspaceId, toolId);

    await prisma.toolDefinition.update({
      where: { id: toolId },
      data: { isActive: false },
    });

    await recordAuditEvent(workspaceId, userId, 'tool.deleted', 'tool', toolId, {
      name: tool.name,
    });

    logger.info('Tool deleted (soft)', { toolId, workspaceId });
  }

  /**
   * What executing this tool WOULD do, without doing it.
   *
   * The last unpreviewed path in the command pipeline: agent runs and
   * workflows both had previews, but pressing Execute on a tool sent a
   * real HTTP request to a real endpoint with no statement beforehand of
   * where it goes. For a tool that emails a customer or posts to a
   * webhook, that moment is exactly when a person needs the facts.
   *
   * FACTS, NEVER VERDICTS. The report says where the request goes, what
   * method it uses, which declared secrets would be filled in, and what
   * would stop it. It does not grade the tool "safe" or "risky" — Synora
   * has no system that can judge that, and inventing a rating would be
   * the same fabricated confidence this platform refuses everywhere.
   *
   * SECRETS ARE NEVER RESOLVED HERE. The preview reads the UNSUBSTITUTED
   * config: it reports the secret NAMES the config references and never
   * calls the secrets manager at all, so previewing cannot become a way
   * to read a secret value.
   */
  async previewExecution(
    userId: string,
    workspaceId: string,
    toolId: string,
    input: Record<string, unknown>,
  ): Promise<ToolExecutionPreview> {
    const membership = await requireMembership(userId, workspaceId);
    const tool = await this.getTool(userId, workspaceId, toolId);

    const blockers: string[] = [];
    const unknowns: string[] = [];

    try {
      requirePermission(membership.role, 'tool:execute');
    } catch {
      // Reported, not thrown — the same choice the workflow dry run
      // makes. Someone who cannot execute still deserves to know what
      // this tool would do, and why they are stopped.
      blockers.push('you do not have permission to execute tools in this workspace');
    }

    if (!tool.isActive) blockers.push('this tool is not active');

    if (!SUPPORTED_EXECUTION_TYPES.has(tool.type)) {
      blockers.push(
        `${tool.type} tools cannot be executed yet (supported: ${[...SUPPORTED_EXECUTION_TYPES].join(', ')})`,
      );
    }

    try {
      validateToolInput(input, tool.inputSchema as Record<string, unknown>);
    } catch (err) {
      blockers.push(err instanceof Error ? err.message : String(err));
    }

    let rateLimit: ToolExecutionPreview['rateLimit'] = null;
    if (tool.rateLimit) {
      const usedInLastMinute = await prisma.toolExecution.count({
        where: { toolId, createdAt: { gte: new Date(Date.now() - 60000) } },
      });
      rateLimit = { limitPerMinute: tool.rateLimit, usedInLastMinute };
      if (usedInLastMinute >= tool.rateLimit) {
        blockers.push(`rate limit reached (${tool.rateLimit} calls per minute)`);
      }
    }

    const config = (tool.config ?? {}) as { url?: unknown; method?: unknown; headers?: unknown };
    let destination: ToolExecutionPreview['destination'] = null;
    const secretsUsed = new Set<string>();

    if (SUPPORTED_EXECUTION_TYPES.has(tool.type)) {
      if (typeof config.url !== 'string' || config.url.length === 0) {
        blockers.push('this tool has no destination URL configured');
      } else {
        for (const match of config.url.matchAll(SECRET_PLACEHOLDER_PATTERN)) {
          secretsUsed.add(match[1]);
        }
        if (config.headers && typeof config.headers === 'object') {
          for (const value of Object.values(config.headers as Record<string, unknown>)) {
            if (typeof value === 'string') {
              for (const match of value.matchAll(SECRET_PLACEHOLDER_PATTERN)) {
                secretsUsed.add(match[1]);
              }
            }
          }
        }

        const method =
          typeof config.method === 'string' ? config.method.toUpperCase() : 'POST';
        // The host is read from the UNSUBSTITUTED url. A placeholder
        // inside the host means the real destination depends on a secret
        // — stated plainly rather than shown as a broken hostname.
        let host: string | null = null;
        try {
          host = new URL(config.url).host;
        } catch {
          host = null;
        }
        // A plain substring check, deliberately: `.test()` on a /g regex
        // advances its lastIndex and would answer differently on the
        // next call for the same input.
        if (host && host.includes('{{secret:')) host = null;
        destination = {
          host,
          method,
          hostDependsOnSecret: host === null,
        };
        unknowns.push('the remote endpoint is not contacted by a preview, so its response is unknown');
      }
    }

    return {
      toolId: tool.id,
      toolName: tool.displayName,
      type: tool.type,
      executed: false,
      wouldRequireApproval: Boolean(tool.requiresApproval),
      destination,
      secretsUsed: [...secretsUsed],
      // Synora has no undo mechanism for anything outside itself, so
      // this stays false for every outbound call — the field means
      // exactly what it says. The NOTE, however, distinguishes a
      // request shaped to READ from one shaped to CHANGE: telling
      // someone a plain lookup "cannot be undone" is true but breeds
      // the alarm fatigue that makes people stop reading warnings at
      // the moment one finally matters.
      reversibleBySynora: false,
      reversibilityNote: reversibilityNoteFor(destination?.method),
      rateLimit,
      blockers,
      unknowns,
      wouldRun: blockers.length === 0,
    };
  }

  async executeTool(userId: string, workspaceId: string, toolId: string, data: ExecuteToolInput): Promise<ToolExecution> {
    const membership = await requireMembership(userId, workspaceId);
    requirePermission(membership.role, 'tool:execute');

    const tool = await this.getTool(userId, workspaceId, toolId);

    if (!tool.isActive) {
      throw new ValidationException('Tool is not active');
    }

    // Honest capability gate: types without a real executor are refused
    // up front instead of producing an execution that pretends to run.
    if (!SUPPORTED_EXECUTION_TYPES.has(tool.type)) {
      throw new ValidationException(
        `Execution for ${tool.type} tools is not supported yet (supported: ${[...SUPPORTED_EXECUTION_TYPES].join(', ')})`
      );
    }

    validateToolInput(data.input, tool.inputSchema as Record<string, unknown>);

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
        maxAttempts: tool.maxRetries,
      },
    });

    logger.info('Tool execution started', { executionId: execution.id, toolId, userId });

    // Input values may be sensitive; the audit trail records shape, not content.
    await recordAuditEvent(workspaceId, userId, 'tool.executed', 'tool_execution', execution.id, {
      toolId,
      toolName: tool.name,
      conversationId: data.conversationId ?? null,
      inputKeys: Object.keys(data.input),
      requiresApproval: tool.requiresApproval,
    });

    // Trigger async execution if approval not required
    if (!tool.requiresApproval) {
      this.runAsync(execution.id, toolId, data.input, tool.timeout);
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

  async listExecutions(
    userId: string,
    workspaceId: string,
    toolId?: string,
    status?: ExecutionStatus,
  ): Promise<
    (ToolExecution & {
      tool?: { name: string };
      user?: { name: string | null; email: string };
    })[]
  > {
    await requireMembership(userId, workspaceId);

    // The tool's name and the requester ride along so a list of
    // executions can say WHICH tool is waiting and WHO asked for it
    // without a lookup per row — the same batched-name principle the
    // project timeline uses for runs and notes. WHO is part of a
    // decision's context: approving means unblocking a specific person.
    return prisma.toolExecution.findMany({
      where: {
        workspaceId,
        ...(toolId && { toolId }),
        ...(status && { status }),
      },
      include: {
        tool: { select: { name: true } },
        user: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async approveExecution(userId: string, workspaceId: string, executionId: string): Promise<ToolExecution> {
    const membership = await requireMembership(userId, workspaceId);
    requirePermission(membership.role, 'tool:approve');

    const execution = await this.getExecution(userId, workspaceId, executionId);
    if (execution.status !== ExecutionStatus.PENDING) {
      throw new ValidationException('Only pending executions can be approved');
    }

    const tool = await this.getTool(userId, workspaceId, execution.toolId);

    const approved = await prisma.toolExecution.update({
      where: { id: executionId },
      data: {
        status: ExecutionStatus.APPROVED,
        approvedBy: userId,
        approvedAt: new Date(),
      },
    });

    await recordAuditEvent(workspaceId, userId, 'tool.execution.approved', 'tool_execution', executionId, {
      toolId: execution.toolId,
      requestedBy: execution.userId,
    });

    this.runAsync(executionId, execution.toolId, execution.input as Record<string, unknown>, tool.timeout);

    return approved;
  }

  async rejectExecution(userId: string, workspaceId: string, executionId: string, reason: string): Promise<ToolExecution> {
    const membership = await requireMembership(userId, workspaceId);
    requirePermission(membership.role, 'tool:approve');

    const execution = await this.getExecution(userId, workspaceId, executionId);
    if (execution.status !== ExecutionStatus.PENDING) {
      throw new ValidationException('Only pending executions can be rejected');
    }

    const rejected = await prisma.toolExecution.update({
      where: { id: executionId },
      data: {
        status: ExecutionStatus.REJECTED,
        rejectedBy: userId,
        rejectedAt: new Date(),
        rejectionReason: reason,
        completedAt: new Date(),
      },
    });

    await recordAuditEvent(workspaceId, userId, 'tool.execution.rejected', 'tool_execution', executionId, {
      toolId: execution.toolId,
      requestedBy: execution.userId,
      reason,
    });

    return rejected;
  }

  /**
   * Hand an accepted execution to the engine off the request path. The
   * engine records terminal state on the execution row; this wrapper
   * only guards against the engine itself rejecting unexpectedly.
   */
  private runAsync(executionId: string, toolId: string, input: Record<string, unknown>, timeout: number): void {
    setImmediate(async () => {
      try {
        const { toolEngineService } = await import('./tool-engine.service');
        await toolEngineService.executeWithRetries(executionId, toolId, input, { timeout });
      } catch (error) {
        logger.error('[toolService] Tool execution failed', {
          executionId,
          toolId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }
}

export const toolService = new ToolService();
