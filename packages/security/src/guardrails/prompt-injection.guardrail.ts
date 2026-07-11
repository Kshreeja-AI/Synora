import type { Guardrail, GuardrailVerdict } from '@synora/core';

const SUSPICIOUS_PATTERNS = [
  /ignore (all|any|the) (previous|prior|above) instructions/i,
  /disregard (all|any|the) (previous|prior|above) (rules|instructions|prompt)/i,
  /you are now (in )?(dan|developer|jailbreak|unrestricted) mode/i,
  /reveal (your |the )?(system prompt|instructions)/i,
  /act as if you have no (restrictions|guidelines|filters)/i,
];

/**
 * Cheap first line of defense against prompt-injection / jailbreak
 * attempts on model input. Pattern matching alone is not a complete
 * defense — pair with model-based classification for high-stakes
 * products — but it catches the common, low-effort attacks for free.
 */
export class PromptInjectionGuardrail implements Guardrail {
  readonly name = 'prompt-injection';

  async check(input: { text: string }): Promise<GuardrailVerdict> {
    const match = SUSPICIOUS_PATTERNS.find((pattern) => pattern.test(input.text));
    if (match) {
      return {
        allowed: false,
        reason: 'Input matched a known prompt-injection pattern',
        category: 'prompt_injection',
      };
    }
    return { allowed: true };
  }
}
