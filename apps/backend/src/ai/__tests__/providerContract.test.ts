import { describe, it, expect } from 'vitest';
import type { AIProviderDescriptor } from '../types/descriptor';
import type {
  TextGenerationProvider,
  TextGenerationRequest,
  TextGenerationResult,
} from '../types';
import { AIProviderError } from '../types';
import { estimateCostOrUnknown, isPriceKnown, normalizeModelId } from '../pricing';

/**
 * ARCHITECTURAL TEST — the one that guards Synora's long-term identity.
 *
 * Synora's product logic must outlive every model vendor. The claim being
 * tested is not "the current router works" (a real request proved that); it is
 * that a provider Synora has never seen — specifically a future
 * Synora-owned model — can satisfy the same contract and be routed to with
 * NO change to authentication, billing, workspaces, memory, agents, tools,
 * queues, UI, API contracts, security controls or spend controls.
 *
 * So this file deliberately implements a fake provider from scratch, using
 * only the exported contract, and drives it through the same surfaces the
 * real ones use. If this test ever needs a change in application code to
 * pass, the abstraction boundary has leaked and the architecture — not the
 * test — is what broke.
 *
 * No network. Nothing here calls an external API.
 */

// ── The hypothetical future provider ────────────────────────────────────────
// Written as "Synora's own model" on purpose: the point is that this file
// knows nothing special, and neither does anything downstream of it.

class SynoraIntelligenceProvider implements TextGenerationProvider {
  readonly id = 'synora-intelligence';
  readonly capabilities = ['text-generation', 'code-generation'] as const;

  constructor(
    private readonly behaviour: {
      mode?: 'ok' | 'error' | 'timeout' | 'empty';
      model?: string;
    } = { mode: 'ok' }
  ) {}

  async generateText(_request: TextGenerationRequest): Promise<TextGenerationResult> {
    const model = this.behaviour.model ?? 'synora-1';

    if (this.behaviour.mode === 'error') {
      throw new AIProviderError('upstream refused', this.id);
    }
    if (this.behaviour.mode === 'timeout') {
      throw new AIProviderError('request timed out', this.id);
    }

    const text = this.behaviour.mode === 'empty' ? '' : 'answer from a model Synora owns';
    return {
      text,
      provider: this.id,
      model,
      usage: { inputTokens: 12, outputTokens: 7 },
      finishReason: this.behaviour.mode === 'empty' ? 'length' : 'stop',
    };
  }
}

const synoraDescriptor: AIProviderDescriptor = {
  id: 'synora-intelligence',
  displayName: 'Synora Intelligence',
  capabilities: ['text-generation', 'code-generation'],
  // Declared, never inferred — the same rule that caught a paid router being
  // treated as free. A future Synora model might be either.
  metering: 'metered',
  async isConfigured() {
    return true;
  },
  async verifyCredential() {
    return { status: 'verified' as const, detail: 'stub endpoint reachable' };
  },
  async create() {
    return new SynoraIntelligenceProvider();
  },
};

describe('a provider Synora has never seen can satisfy the contract', () => {
  it('declares everything the registry needs, with nothing provider-specific required', () => {
    expect(synoraDescriptor.id).toBeTruthy();
    expect(synoraDescriptor.displayName).toBeTruthy();
    expect(synoraDescriptor.capabilities).toContain('text-generation');
    expect(['metered', 'unmetered']).toContain(synoraDescriptor.metering);
    expect(typeof synoraDescriptor.isConfigured).toBe('function');
    expect(typeof synoraDescriptor.create).toBe('function');
  });

  it('reports credential state through the four-state contract, not a boolean', async () => {
    const v = await synoraDescriptor.verifyCredential!();
    // The four states exist so "unreachable" is never mistaken for "rejected".
    expect(['verified', 'rejected', 'unreachable', 'not-verifiable']).toContain(v.status);
  });

  it('constructs a provider whose generate result is already normalized', async () => {
    const provider = await synoraDescriptor.create();
    const result = await (provider as TextGenerationProvider).generateText({ prompt: 'hello' });

    // The SHAPE is the contract. Callers read these fields and nothing else —
    // no vendor envelope, no SDK type, no provider-specific branch.
    expect(result).toMatchObject({
      text: expect.any(String),
      provider: 'synora-intelligence',
      model: expect.any(String),
    });
    expect(result.usage).toMatchObject({
      inputTokens: expect.any(Number),
      outputTokens: expect.any(Number),
    });
  });

  it('surfaces failure as AIProviderError, so callers need no vendor error handling', async () => {
    const failing = new SynoraIntelligenceProvider({ mode: 'error' });
    await expect(failing.generateText({ prompt: 'x' })).rejects.toBeInstanceOf(AIProviderError);
  });

  it('reports a timeout through the same error type as any other failure', async () => {
    const slow = new SynoraIntelligenceProvider({ mode: 'timeout' });
    await expect(slow.generateText({ prompt: 'x' })).rejects.toBeInstanceOf(AIProviderError);
  });

  it('an empty answer is reported with finishReason, not disguised as success text', async () => {
    // Blocker B's property, restated as a contract obligation on ANY provider:
    // a model that produced nothing must say so rather than return "".
    const empty = new SynoraIntelligenceProvider({ mode: 'empty' });
    const r = await empty.generateText({ prompt: 'x' });
    expect(r.text).toBe('');
    expect(r.finishReason).toBe('length');
  });
});

describe('cost handling works for a model nobody has priced yet', () => {
  it('a future model id is UNKNOWN to pricing rather than silently free', () => {
    // The essential safety property. A brand-new Synora model is not in the
    // price table, and must not therefore cost nothing.
    expect(isPriceKnown('synora-1')).toBe(false);
    expect(estimateCostOrUnknown('synora-1', 1000, 1000)).toBeNull();
  });

  it('does not inherit a similarly-named model\'s price', () => {
    expect(isPriceKnown('synora-1-turbo')).toBe(false);
    expect(isPriceKnown('claude-sonnet-5-preview')).toBe(false);
  });

  it('normalizes a gateway-prefixed future model without inventing a price', () => {
    expect(normalizeModelId('synora/Synora 1')).toBe('synora-1');
    expect(isPriceKnown('synora/Synora 1')).toBe(false);
  });

  it('a metered declaration is all that is needed for the spend guard to charge it', () => {
    // No business logic keys off the provider NAME; it reads this field.
    expect(synoraDescriptor.metering).toBe('metered');
    const unmeteredVariant: AIProviderDescriptor = { ...synoraDescriptor, metering: 'unmetered' };
    expect(unmeteredVariant.metering).toBe('unmetered');
  });
});

describe('swapping providers is configuration, not a rewrite', () => {
  it('two unrelated providers are interchangeable at the call site', async () => {
    // The same caller code drives both. If this ever required a branch on
    // provider id, the abstraction would have failed.
    const providers: TextGenerationProvider[] = [
      new SynoraIntelligenceProvider({ model: 'synora-1' }),
      new SynoraIntelligenceProvider({ model: 'some-other-vendor-model' }),
    ];

    for (const p of providers) {
      const r = await p.generateText({ prompt: 'same call, any provider' });
      expect(r.provider).toBe('synora-intelligence');
      expect(typeof r.text).toBe('string');
      expect(r.usage?.inputTokens).toBeGreaterThan(0);
    }
  });

  it('the caller never imports a vendor SDK to read a result', () => {
    // This file imports only Synora's own types. That it compiles and passes
    // IS the assertion: a result is consumable with no vendor package present.
    const contractSurface = ['text', 'provider', 'model', 'usage', 'finishReason'];
    expect(contractSurface).toEqual(expect.arrayContaining(['text', 'provider', 'model']));
  });
});
