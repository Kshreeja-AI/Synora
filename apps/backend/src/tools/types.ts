/**
 * Universal Tool Calling Engine - Type Definitions
 * Provider-agnostic tool execution with streaming, retry, circuit breaker
 */

export enum ToolType {
  HTTP = 'HTTP',
  GraphQL = 'GraphQL',
  Database = 'Database',
  Search = 'Search',
  File = 'File',
  Browser = 'Browser',
  Python = 'Python',
  Webhook = 'Webhook',
  MCP = 'MCP',
  Custom = 'Custom',
}

export enum ToolPermission {
  PRIVATE = 'PRIVATE',
  WORKSPACE = 'WORKSPACE',
  SHARED = 'SHARED',
  PUBLIC = 'PUBLIC',
}

export enum ExecutionStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  RUNNING = 'RUNNING',
  STREAMING = 'STREAMING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  TIMEOUT = 'TIMEOUT',
  REJECTED = 'REJECTED',
}

// Tool definition types
export interface ToolDefinition {
  id: string;
  workspaceId?: string;
  name: string;
  displayName: string;
  description: string;
  category: string;
  type: ToolType;

  inputSchema: Record<string, any>; // JSON Schema
  outputSchema?: Record<string, any>;

  config: Record<string, any>;
  secrets: string[];

  capabilities: string[];
  permission: ToolPermission;
  allowedRoles: string[];

  maxParallelCalls: number;
  rateLimit?: number;
  timeout: number;
  maxRetries: number;

  isActive: boolean;
  isAsync: boolean;
  supportsStreaming: boolean;
  requiresApproval: boolean;

  version: number;
  parentId?: string;

  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

// Tool execution types
export interface ToolExecution {
  id: string;
  toolId: string;
  workspaceId: string;
  conversationId?: string;
  userId: string;

  input: Record<string, any>;
  output?: Record<string, any>;
  error?: string;

  status: ExecutionStatus;
  progress: number;

  isStreaming: boolean;
  streamStartedAt?: Date;

  attemptNumber: number;
  maxAttempts: number;
  lastError?: string;

  circuitBreakerOpen: boolean;

  startedAt?: Date;
  completedAt?: Date;
  duration?: number;

  inputTokens: number;
  outputTokens: number;
  costCents: number;

  approvedBy?: string;
  approvedAt?: Date;
  rejectedBy?: string;
  rejectedAt?: Date;
  rejectionReason?: string;

  createdAt: Date;
  updatedAt: Date;
}

// Tool invocation (atomic operation)
export interface ToolInvocation {
  id: string;
  executionId: string;
  parentInvocationId?: string;

  input: Record<string, any>;
  output?: Record<string, any>;
  error?: string;

  status: ExecutionStatus;

  startedAt?: Date;
  completedAt?: Date;

  sequenceNumber: number;
  retryCount: number;

  createdAt: Date;
}

// Request/Response types
export interface CreateToolInput {
  name: string;
  displayName: string;
  description: string;
  category: string;
  type: ToolType;
  inputSchema: Record<string, any>;
  outputSchema?: Record<string, any>;
  config: Record<string, any>;
  secrets?: string[];
  capabilities?: string[];
  permission?: ToolPermission;
  maxParallelCalls?: number;
  rateLimit?: number;
  timeout?: number;
  maxRetries?: number;
  isAsync?: boolean;
  supportsStreaming?: boolean;
  requiresApproval?: boolean;
}

export interface UpdateToolInput {
  displayName?: string;
  description?: string;
  category?: string;
  config?: Record<string, any>;
  capabilities?: string[];
  permission?: ToolPermission;
  maxParallelCalls?: number;
  rateLimit?: number;
  timeout?: number;
  maxRetries?: number;
  isActive?: boolean;
  supportsStreaming?: boolean;
  requiresApproval?: boolean;
}

export interface ExecuteToolInput {
  input: Record<string, any>;
  conversationId?: string;
  requiresApproval?: boolean;
  dependencies?: Record<string, any>;
  parallelMode?: 'sequential' | 'parallel';
  timeout?: number;
}

export interface ToolSearchQuery {
  workspaceId?: string;
  category?: string;
  type?: ToolType;
  permission?: ToolPermission;
  isActive?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}

// Provider interface
export interface IToolProvider {
  validate(input: Record<string, any>, schema: Record<string, any>): Promise<boolean>;
  execute(definition: ToolDefinition, input: Record<string, any>): Promise<Record<string, any>>;
  executeStream(definition: ToolDefinition, input: Record<string, any>): AsyncGenerator<Record<string, any>>;
  cancel(executionId: string): Promise<void>;
}

// Circuit breaker state
export interface CircuitBreakerConfig {
  failureThreshold: number;
  successThreshold: number;
  timeout: number;
  halfOpenMaxCalls: number;
}

export interface CircuitBreakerState {
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  failureCount: number;
  successCount: number;
  lastFailureTime?: Date;
  nextAttemptTime?: Date;
}

// Retry configuration
export interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  jitter: boolean;
}

// Metrics
export interface ToolMetrics {
  id: string;
  toolId: string;
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  avgDuration: number;
  minDuration?: number;
  maxDuration?: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  totalCostCents: number;
  lastExecutedAt?: Date;
}

// Audit log
export interface ToolAuditLog {
  id: string;
  toolId: string;
  executionId?: string;
  userId: string;
  action: 'CREATED' | 'EXECUTED' | 'FAILED' | 'APPROVED' | 'REJECTED' | 'UPDATED' | 'DELETED';
  status?: string;
  changes?: Record<string, any>;
  metadata?: Record<string, any>;
  createdAt: Date;
}

// Tool quota
export interface ToolQuota {
  id: string;
  workspaceId: string;
  maxToolsPerWorkspace: number;
  maxExecutionsPerDay: number;
  maxCostPerMonth: number;
  executionsUsedToday: number;
  costUsedThisMonth: number;
  lastResetAt: Date;
}

// Webhook configuration
export interface ToolWebhook {
  id: string;
  toolId: string;
  event: 'on-start' | 'on-progress' | 'on-complete' | 'on-error';
  url: string;
  method: 'POST' | 'PUT' | 'PATCH';
  headers?: Record<string, string>;
  isActive: boolean;
}

// Tool dependency
export interface ToolDependency {
  id: string;
  fromId: string;
  toId: string;
  passOutputAs?: string;
  transformOutput?: string;
  isOptional: boolean;
}
