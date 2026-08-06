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

import { describe, it, expect } from 'vitest';
import { isRunnableHere, unavailableReason } from '../availability';
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
