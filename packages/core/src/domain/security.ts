import type { TenantId, UserId } from './ids.js';

export type Scope = 'admin' | 'agent:invoke' | 'memory:read' | 'memory:write' | 'workflow:run';

export interface Principal {
  tenantId: TenantId;
  userId: UserId;
  scopes: Scope[];
  keyId?: string;
}

export interface AuthContext {
  principal: Principal;
  requestId: string;
}

export type GuardrailVerdict =
  | { allowed: true }
  | { allowed: false; reason: string; category: string };

/**
 * Guardrails validate content flowing in or out of a model call
 * (PII, jailbreak attempts, toxicity, secrets leakage, policy
 * violations). Implementations are pluggable so products can layer
 * domain-specific checks on top of platform defaults.
 */
export interface Guardrail {
  readonly name: string;
  check(input: { text: string; context: AuthContext }): Promise<GuardrailVerdict>;
}
