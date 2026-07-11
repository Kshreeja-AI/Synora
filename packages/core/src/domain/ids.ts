/**
 * Branded identifier types. Branding prevents accidentally passing a
 * TenantId where an AgentId is expected, even though both are strings
 * at runtime.
 */
export type Brand<T, B extends string> = T & { readonly __brand: B };

export type TenantId = Brand<string, 'TenantId'>;
export type UserId = Brand<string, 'UserId'>;
export type AgentId = Brand<string, 'AgentId'>;
export type SessionId = Brand<string, 'SessionId'>;
export type RunId = Brand<string, 'RunId'>;
export type MessageId = Brand<string, 'MessageId'>;
export type ToolCallId = Brand<string, 'ToolCallId'>;
export type MemoryId = Brand<string, 'MemoryId'>;
export type WorkflowRunId = Brand<string, 'WorkflowRunId'>;

const brand =
  <B extends string>() =>
  (value: string): Brand<string, B> =>
    value as Brand<string, B>;

export const asTenantId = brand<'TenantId'>();
export const asUserId = brand<'UserId'>();
export const asAgentId = brand<'AgentId'>();
export const asSessionId = brand<'SessionId'>();
export const asRunId = brand<'RunId'>();
export const asMessageId = brand<'MessageId'>();
export const asToolCallId = brand<'ToolCallId'>();
export const asMemoryId = brand<'MemoryId'>();
export const asWorkflowRunId = brand<'WorkflowRunId'>();
