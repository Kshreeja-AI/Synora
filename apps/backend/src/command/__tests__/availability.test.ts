/**
 * "Why can't Synora do this here?"
 *
 * The catalogue used to answer with two values, so every unavailable
 * capability produced the same sentence — "needs a provider credential" —
 * and for text generation that was wrong in the way that matters most: it
 * hides the fact that a LOCAL model would serve it, needing no vendor, no
 * account and no money.
 *
 * These tests pin the distinction, and pin the bug that widening the
 * vocabulary nearly introduced.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  isRunnableHere,
  unavailableReason,
  withLiveAvailability,
  anyTextProviderConfigured,
} from '../availability';
import { initConfig, __resetConfigForTests } from '../../config';
import { routesForIntent } from '../capabilities';
import { understandCommand } from '../understand';
import type { CommandIntent, CommandRoute } from '../types';

// Declared here rather than imported: `capabilities.ts` exports no list of
// intents, and inventing an export purely for a test would put a seam in
// production code that only tests use.
// The nine intents the catalogue actually has entries for. `not-yet-capable`
// and `unrecognized` are real members of the union but hold no routes by
// design, so including them would say nothing.
const INTENTS: CommandIntent[] = [
  'find', 'ask', 'create', 'automate', 'plan', 'decide', 'monitor',
  'communicate', 'control',
];

function allRoutes(): CommandRoute[] {
  return INTENTS.flatMap((intent) => routesForIntent(intent));
}

describe('capability availability', () => {
  it('tells someone a model can be LOCAL, not only bought', () => {
    const reason = unavailableReason('needs-model');
    expect(reason).toMatch(/local model/i);
    expect(reason).toMatch(/external provider/i);
  });

  it('keeps a credential a credential', () => {
    // Sending mail has no local substitute. Offering one would be a lie in
    // the opposite direction from the one this slice fixes.
    const reason = unavailableReason('needs-credentials');
    expect(reason).toMatch(/credential/i);
    expect(reason).not.toMatch(/local model/i);
  });

  it('classifies text generation as needing a model, not a credential', () => {
    const generate = allRoutes().find((r) => r.capabilityId === 'ai.generate');
    expect(generate?.availability).toBe('needs-model');
  });

  it('classifies sending an invitation as needing a credential', () => {
    const invite = allRoutes().find((r) => r.capabilityId === 'workspace.invite');
    expect(invite?.availability).toBe('needs-credentials');
  });

  it('treats only `available` as runnable, whatever else is added later', () => {
    // The gate every caller uses. If a future value slipped through as
    // runnable, the command layer would attempt a capability this
    // deployment cannot serve and report the miss as a failure.
    expect(isRunnableHere({ availability: 'available' })).toBe(true);
    expect(isRunnableHere({ availability: 'needs-model' })).toBe(false);
    expect(isRunnableHere({ availability: 'needs-credentials' })).toBe(false);
    expect(isRunnableHere({ availability: 'not-implemented' })).toBe(false);
  });

  it('still reports an unavailable capability after the vocabulary widened', () => {
    // THE REGRESSION THIS SLICE NEARLY SHIPPED. `understandCommand` filtered
    // for the literal 'needs-credentials'. Reclassifying `ai.generate` to
    // 'needs-model' would have dropped it from the list silently, and a
    // person asking for text generation would have been told nothing was
    // wrong with it right up until it failed.
    const result = understandCommand('explain the pricing changes to me');
    const mentionsModel = result.unknowns.some((u) => /language model/i.test(u));
    expect(mentionsModel, `unknowns were: ${JSON.stringify(result.unknowns)}`).toBe(true);
  });

  it('names every catalogue availability value that a reader could meet', () => {
    // Guards the other direction: a value in the enum that no capability
    // ever produces is untestable and untrustworthy, and the directive's
    // longer vocabulary was trimmed for exactly that reason. If a future
    // slice adds a value, it must add a capability that uses it.
    const used = new Set(allRoutes().map((r) => r.availability));
    expect([...used].sort()).toEqual(['available', 'needs-credentials', 'needs-model']);
  });
});

describe('live availability — needs-model becomes a deployment answer', () => {
  afterEach(async () => {
    delete process.env.OLLAMA_BASE_URL;
    __resetConfigForTests();
    await initConfig();
  });

  it('reports no text provider configured in a bare deployment', async () => {
    __resetConfigForTests();
    await initConfig();
    await expect(anyTextProviderConfigured()).resolves.toBe(false);
  });

  it('flips ai.generate to available once an endpoint is REALLY configured', async () => {
    // End to end through env → config → registry → understander, no mocks:
    // the same wiring a real deployment uses.
    process.env.OLLAMA_BASE_URL = 'http://gpu.example.com/v1';
    __resetConfigForTests();
    await initConfig();

    await expect(anyTextProviderConfigured()).resolves.toBe(true);
    const result = understandCommand('Explain how our billing works', {
      textProviderConfigured: true,
    });
    expect(result.routes[0].availability).toBe('available');
    // The "needs a language model" unknown is gone — the person is no
    // longer warned away from a capability that would work.
    expect(result.unknowns.join(' ')).not.toMatch(/language model/i);
  });

  it('keeps the static under-claiming default when no flag is passed', () => {
    // Sync callers with no async context get catalogue answers, which only
    // ever UNDER-claim — the safe direction for a default.
    const result = understandCommand('Explain how our billing works');
    expect(result.routes[0].availability).toBe('needs-model');
  });

  it('flips ONLY needs-model — never credentials, never not-implemented', () => {
    const credentialRoute = allRoutes().find((r) => r.availability === 'needs-credentials')!;
    // A configured MODEL is not a configured SMTP server; flipping a
    // credential-gated capability on the strength of a model would promise
    // email nobody can send.
    expect(withLiveAvailability(credentialRoute, true)).toBe(credentialRoute);
    const available = allRoutes().find((r) => r.availability === 'available')!;
    expect(withLiveAvailability(available, true)).toBe(available);
  });

  it('never mutates the shared catalogue entry', () => {
    const route = allRoutes().find((r) => r.capabilityId === 'ai.generate')!;
    const flipped = withLiveAvailability(route, true);
    expect(flipped).not.toBe(route);
    expect(route.availability).toBe('needs-model');
  });
});
