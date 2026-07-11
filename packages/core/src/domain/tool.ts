import type { ToolCallId } from './ids.js';

/**
 * A JSON-Schema-shaped description of a tool's input. Kept as `unknown`
 * here (rather than importing zod) so the domain layer stays dependency
 * free; packages/tools binds this to a concrete schema library.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Declares side effects so orchestration/security can gate execution. */
  readOnly?: boolean;
}

export interface ToolInvocation {
  toolCallId: ToolCallId;
  toolName: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: ToolCallId;
  output: unknown;
  isError?: boolean;
}

export interface ToolExecutionContext {
  tenantId: string;
  agentId: string;
  sessionId: string;
  signal?: AbortSignal;
}

/**
 * Port implemented by anything that can execute a tool. Concrete tools
 * (HTTP calls, DB lookups, code execution, MCP-bridged tools) live in
 * infrastructure/product code and register against packages/tools.
 */
export interface ToolHandler {
  readonly definition: ToolDefinition;
  execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<unknown>;
}
