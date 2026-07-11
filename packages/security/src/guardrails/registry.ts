import type { Guardrail } from '@synora/core';
import { PiiGuardrail } from './pii.guardrail.js';
import { PromptInjectionGuardrail } from './prompt-injection.guardrail.js';
import { SecretLeakGuardrail } from './secret-leak.guardrail.js';

/**
 * Name-keyed registry of Guardrail implementations, satisfying the
 * GuardrailResolver shape AgentRuntime expects. Comes pre-loaded with
 * platform defaults; products register additional domain-specific
 * guardrails (e.g. medical-advice-disclaimer) under their own names.
 */
export class GuardrailRegistry {
  private readonly guardrails = new Map<string, Guardrail>();

  constructor(seedDefaults = true) {
    if (seedDefaults) {
      this.register(new PromptInjectionGuardrail());
      this.register(new PiiGuardrail());
      this.register(new SecretLeakGuardrail());
    }
  }

  register(guardrail: Guardrail): void {
    this.guardrails.set(guardrail.name, guardrail);
  }

  resolve(name: string): Guardrail {
    const guardrail = this.guardrails.get(name);
    if (!guardrail) throw new Error(`Unknown guardrail "${name}"`);
    return guardrail;
  }
}
