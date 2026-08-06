import type { CommandRoute, CapabilityAvailability } from './types';

/**
 * WHY A CAPABILITY CANNOT RUN HERE, in words that name the actual next step.
 *
 * The catalogue used to answer this with exactly two values: `available` and
 * `needs-credentials`. Everything unavailable therefore produced the same
 * sentence — "needs a provider credential configured" — and for one
 * capability that sentence was simply wrong in a way that mattered.
 *
 * Generating text needs a MODEL. That can be satisfied two ways: connect an
 * external provider, or run a local one. The second needs no account, no
 * vendor and no money. Telling someone "an administrator must configure a
 * credential" hides the path that costs nothing, and it is the path this
 * platform intends to make ordinary.
 *
 * Sending an invitation genuinely does need a credential — SMTP — and there
 * is no local substitute. Same word, different world.
 *
 * WHY ONLY THREE VALUES. The Intelligence directive lists a longer
 * vocabulary (infrastructure required, training required, and others). Not
 * one capability in this catalogue is blocked by those today, and an enum
 * member nothing produces is a value no test can exercise and no reader can
 * trust. They are deliberately absent and will be added by whichever slice
 * first has a real capability in that state — the same rule the capability
 * catalogue itself follows: never name something that does not exist.
 */

/** One sentence naming the real obstacle and the real way past it. */
export function unavailableReason(availability: CapabilityAvailability): string {
  switch (availability) {
    case 'needs-model':
      // Both routes stated, cheapest first. A person told only about
      // providers concludes Synora costs money to think.
      return 'needs a language model — either a local model running alongside Synora, or a configured external provider';
    case 'needs-credentials':
      return 'needs a provider credential configured in this deployment';
    case 'not-implemented':
      return 'is not implemented';
    case 'available':
      // Callers should not ask, but answering honestly beats throwing: a
      // crash in a message-formatting helper would turn a working capability
      // into an error.
      return 'is available';
  }
}

/**
 * Whether this deployment can actually run the capability right now.
 *
 * The ONE question every gate asks, in one place. Before this existed the
 * check was written inline as `availability === 'available'` in six modules
 * and as `=== 'needs-credentials'` in a seventh — and that seventh was the
 * bug: widening the vocabulary would have silently stopped it reporting
 * `ai.generate` as unavailable at all, because the value no longer matched
 * the literal it was comparing against. A person would have been told
 * nothing was wrong right up until it failed.
 */
export function isRunnableHere(route: Pick<CommandRoute, 'availability'>): boolean {
  return route.availability === 'available';
}
