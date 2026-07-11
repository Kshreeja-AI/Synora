import type { TenantId } from './ids.js';

/**
 * Base envelope for every domain event flowing through the platform's
 * event bus. Products define their own payload types but must fit this
 * shape so cross-cutting subscribers (observability, audit, billing)
 * can handle any event uniformly.
 */
export interface DomainEvent<TPayload = unknown> {
  id: string;
  type: string;
  tenantId: TenantId;
  occurredAt: string;
  payload: TPayload;
  source: string;
  correlationId?: string;
  causationId?: string;
}

export type EventHandler<TPayload = unknown> = (
  event: DomainEvent<TPayload>,
) => Promise<void> | void;

export interface Subscription {
  unsubscribe(): Promise<void> | void;
}

/**
 * Port for the platform's event-driven backbone. `publish` fires
 * fire-and-forget notifications (agent started, tool invoked, memory
 * written); `subscribe` lets any module — including future products —
 * react without the publisher knowing who's listening. Swappable
 * between an in-memory bus (single process / tests) and Redis/Kafka
 * for multi-instance deployments, with no change to callers.
 */
export interface EventBus {
  publish<TPayload>(event: DomainEvent<TPayload>): Promise<void>;
  subscribe<TPayload>(eventType: string | RegExp, handler: EventHandler<TPayload>): Subscription;
}

// --- Well-known platform event type names (products may add their own) ---
export const PlatformEvents = {
  AgentRunStarted: 'platform.agent_run.started',
  AgentRunCompleted: 'platform.agent_run.completed',
  AgentRunFailed: 'platform.agent_run.failed',
  ToolInvoked: 'platform.tool.invoked',
  ToolCompleted: 'platform.tool.completed',
  ToolFailed: 'platform.tool.failed',
  MemoryWritten: 'platform.memory.written',
  MemoryRetrieved: 'platform.memory.retrieved',
  GuardrailBlocked: 'platform.guardrail.blocked',
  WorkflowStepStarted: 'platform.workflow.step_started',
  WorkflowStepCompleted: 'platform.workflow.step_completed',
  AgentHandoff: 'platform.agent.handoff',
} as const;
