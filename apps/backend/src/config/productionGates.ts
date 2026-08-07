import type { AppConfig } from './types';

/**
 * Launch gates that only hold where real money and real users exist.
 * Separate from schema validation because the rule crosses two systems:
 * whether a METERED provider credential exists is SecretsManager's answer,
 * whether a spend cap exists is config's — and "no paid key without a cap"
 * belongs to neither alone.
 *
 * The launch runbook classifies AI_GLOBAL_MAX_COST_PER_DAY_CENTS /
 * AI_GLOBAL_MAX_TOKENS_PER_DAY as REQUIRED_PRODUCTION with the note "set
 * BEFORE any paid key". This module is what makes that sentence
 * enforceable instead of aspirational: a staging/production boot that
 * resolves a real metered credential while no global cap is configured
 * does not come up.
 *
 * Ollama and self-hosted endpoints are deliberately exempt: an endpoint
 * the operator runs is not a bill that scales with tokens, and their
 * absence from this list is what keeps the free/self-hosted path booting
 * with zero cap configuration. Vector-DB credentials (Pinecone etc.) are
 * also out of scope — they are metered by storage, not by generation, and
 * the AI spend guard does not meter them.
 */

/**
 * Every credential that lets Synora send tokens to a party that bills for
 * them. Groq has a free tier but paid tiers exist behind the same key;
 * Voyage/Cohere are embeddings — embeddings are metered too.
 */
export const METERED_AI_CREDENTIALS: readonly string[] = [
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'REPLICATE_API_KEY',
  'GOOGLE_AI_API_KEY',
  'XAI_API_KEY',
  'OPENROUTER_API_KEY',
  'DEEPSEEK_API_KEY',
  'TOGETHER_API_KEY',
  'AZURE_OPENAI_API_KEY',
  'AWS_ACCESS_KEY_ID',
  'GROQ_API_KEY',
  'VOYAGE_API_KEY',
  'COHERE_API_KEY',
];

export class ProductionGateError extends Error {
  constructor(meteredKeys: string[]) {
    super(
      `Refusing to start: metered AI credential(s) configured (${meteredKeys.join(', ')}) ` +
        'but no global spend cap is set. Set AI_GLOBAL_MAX_COST_PER_DAY_CENTS (recommended) ' +
        'and/or AI_GLOBAL_MAX_TOKENS_PER_DAY before booting with a paid provider key — ' +
        'an uncapped key is an uncontrolled bill. See docs/production/LAUNCH_RUNBOOK.md §2.'
    );
    this.name = 'ProductionGateError';
  }
}

/** The one SecretsManager capability this gate needs — keeps tests honest and small. */
interface RealCredentialCheck {
  hasReal(key: string, actor?: string): Promise<boolean>;
}

/**
 * Call once at boot, after initConfig(). Throws ProductionGateError in
 * staging/production when a real metered credential resolves and neither
 * global spend cap is configured. Development/testing/qa never throw —
 * the same soft/hard stage split validateRequired() uses.
 */
export async function assertProductionLaunchGates(
  config: Pick<AppConfig, 'stage'> & { ai: Pick<AppConfig['ai'], 'globalMaxCostPerDayCents' | 'globalMaxTokensPerDay'> },
  secrets: RealCredentialCheck
): Promise<void> {
  if (config.stage !== 'staging' && config.stage !== 'production') return;

  const capsConfigured =
    config.ai.globalMaxCostPerDayCents !== undefined ||
    config.ai.globalMaxTokensPerDay !== undefined;
  if (capsConfigured) return;

  const metered: string[] = [];
  for (const key of METERED_AI_CREDENTIALS) {
    if (await secrets.hasReal(key, 'production-gates')) {
      metered.push(key);
    }
  }

  if (metered.length > 0) {
    throw new ProductionGateError(metered);
  }
}
