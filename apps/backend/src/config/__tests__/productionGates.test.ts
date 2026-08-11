/**
 * The spend-cap boot gate: "set the cap BEFORE any paid key" as an
 * enforced boot condition, not a runbook sentence. The failure this
 * prevents is the founder adding ANTHROPIC_API_KEY to production without
 * ever setting AI_GLOBAL_MAX_COST_PER_DAY_CENTS — the exact path to an
 * uncontrolled bill.
 */

import { describe, it, expect } from 'vitest';
import {
  assertProductionLaunchGates,
  ProductionGateError,
  METERED_AI_CREDENTIALS,
  assertNoDevelopmentModesInProduction,
} from '../productionGates';

function secretsWithReal(...realKeys: string[]) {
  return {
    hasReal: async (key: string) => realKeys.includes(key),
  };
}

function config(
  stage: 'development' | 'testing' | 'qa' | 'staging' | 'production',
  caps: { cost?: number; tokens?: number } = {}
) {
  return {
    stage,
    ai: {
      globalMaxCostPerDayCents: caps.cost,
      globalMaxTokensPerDay: caps.tokens,
    },
  };
}

describe('assertProductionLaunchGates', () => {
  it('refuses a production boot with a metered key and no caps, naming the key', async () => {
    const error = await assertProductionLaunchGates(
      config('production'),
      secretsWithReal('ANTHROPIC_API_KEY')
    ).then(
      () => null,
      (e: unknown) => e as ProductionGateError
    );
    expect(error).toBeInstanceOf(ProductionGateError);
    expect(error!.message).toContain('ANTHROPIC_API_KEY');
    expect(error!.message).toContain('AI_GLOBAL_MAX_COST_PER_DAY_CENTS');
  });

  it('refuses in staging too — staging keys bill the same account', async () => {
    await expect(
      assertProductionLaunchGates(config('staging'), secretsWithReal('GROQ_API_KEY'))
    ).rejects.toBeInstanceOf(ProductionGateError);
  });

  it('boots when a cost cap is configured alongside the metered key', async () => {
    await expect(
      assertProductionLaunchGates(
        config('production', { cost: 500 }),
        secretsWithReal('ANTHROPIC_API_KEY', 'OPENAI_API_KEY')
      )
    ).resolves.toBeUndefined();
  });

  it('accepts a token cap alone — it still bounds what a paid key can spend', async () => {
    await expect(
      assertProductionLaunchGates(
        config('production', { tokens: 2_000_000 }),
        secretsWithReal('DEEPSEEK_API_KEY')
      )
    ).resolves.toBeUndefined();
  });

  it('boots a capless production with ONLY self-hosted endpoints — the free path stays free', async () => {
    // Ollama/self-hosted tokens are config-read, not secretsManager-read,
    // and deliberately absent from METERED_AI_CREDENTIALS: an endpoint the
    // operator runs is not a bill that scales with tokens.
    await expect(
      assertProductionLaunchGates(config('production'), secretsWithReal())
    ).resolves.toBeUndefined();
  });

  it('never blocks development — dev machines carry keys and no caps all the time', async () => {
    await expect(
      assertProductionLaunchGates(config('development'), secretsWithReal('OPENAI_API_KEY'))
    ).resolves.toBeUndefined();
  });

  it('covers every text and embeddings vendor key the secret catalog knows about', () => {
    // The gate is only as good as its list. If a new metered provider's
    // key is added to the app without joining this list, the gate develops
    // a silent hole — this pin forces the conversation.
    for (const key of [
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
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
      'REPLICATE_API_KEY',
    ]) {
      expect(METERED_AI_CREDENTIALS, `${key} missing from the metered list`).toContain(key);
    }
  });
});

describe('development modes are refused in production', () => {
  const cfg = (stage: string, modes: Record<string, boolean>) =>
    ({ stage, modes: { offline: false, mock: false, enterprise: false, government: false, selfHosted: false, ...modes } }) as never;

  it('refuses production when mock mode is active', () => {
    // The failure this prevents is invisible from outside: healthy app, HTTP
    // 200, plausible text, and not one word of it from a model.
    expect(() => assertNoDevelopmentModesInProduction(cfg('production', { mock: true })))
      .toThrow(/MOCK_MODE/);
  });

  it('refuses production when offline mode is active', () => {
    expect(() => assertNoDevelopmentModesInProduction(cfg('production', { offline: true })))
      .toThrow(/OFFLINE_MODE/);
  });

  it('names every offending mode, not just the first', () => {
    expect(() => assertNoDevelopmentModesInProduction(cfg('production', { mock: true, offline: true })))
      .toThrow(/MOCK_MODE.*OFFLINE_MODE/);
  });

  it('refuses staging too — it is the rehearsal for production', () => {
    expect(() => assertNoDevelopmentModesInProduction(cfg('staging', { mock: true })))
      .toThrow(/MOCK_MODE/);
  });

  it('allows a clean production configuration', () => {
    expect(() => assertNoDevelopmentModesInProduction(cfg('production', {}))).not.toThrow();
  });

  it('leaves development alone — mock and offline are the point there', () => {
    expect(() => assertNoDevelopmentModesInProduction(cfg('development', { mock: true, offline: true })))
      .not.toThrow();
  });
});
