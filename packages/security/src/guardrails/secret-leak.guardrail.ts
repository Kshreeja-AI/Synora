import type { Guardrail, GuardrailVerdict } from '@synora/core';

const SECRET_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: 'anthropic_api_key', pattern: /sk-ant-[a-zA-Z0-9_-]{20,}/ },
  { name: 'openai_api_key', pattern: /sk-[a-zA-Z0-9]{20,}/ },
  { name: 'aws_access_key', pattern: /AKIA[0-9A-Z]{16}/ },
  { name: 'private_key_block', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'generic_bearer_token', pattern: /Bearer [a-zA-Z0-9._-]{20,}/ },
];

/**
 * Blocks model output (or tool output echoed back) that contains
 * something shaped like a credential, so a compromised or careless
 * tool/model turn can't exfiltrate secrets through a chat response.
 */
export class SecretLeakGuardrail implements Guardrail {
  readonly name = 'secret-leak';

  async check(input: { text: string }): Promise<GuardrailVerdict> {
    const match = SECRET_PATTERNS.find(({ pattern }) => pattern.test(input.text));
    if (match) {
      return {
        allowed: false,
        reason: `Output contains a likely ${match.name}`,
        category: 'secret_leak',
      };
    }
    return { allowed: true };
  }
}
