import type { AgentId } from './ids.js';
import type { Message } from './message.js';
import type { ToolDefinition } from './tool.js';

export interface GuardrailRef {
  name: string;
  config?: Record<string, unknown>;
}

/**
 * A declarative agent definition — persona, model choice, tools, and
 * guardrails — decoupled from the AgentRuntime that executes it.
 * Products (Kshreeja AI or any future one) ship a set of these; the
 * platform doesn't know or care what domain they serve.
 */
export interface AgentDefinition {
  id: AgentId;
  name: string;
  description: string;
  instructions: string;
  providerId: string;
  model: string;
  tools: ToolDefinition[];
  memoryEnabled: boolean;
  inputGuardrails?: GuardrailRef[];
  outputGuardrails?: GuardrailRef[];
  temperature?: number;
  maxOutputTokens?: number;
  maxToolRoundtrips?: number;
  /** Other agents this one is allowed to hand off to, by id. */
  handoffTargets?: AgentId[];
  metadata?: Record<string, unknown>;
}

export type AgentRunStatus = 'running' | 'completed' | 'failed' | 'handed_off' | 'cancelled';

export interface AgentRunResult {
  status: AgentRunStatus;
  messages: Message[];
  handoffTo?: AgentId;
  error?: string;
}
