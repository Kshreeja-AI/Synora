/**
 * Published prices for capabilities that are not billed per token.
 *
 * WHY THIS TABLE IS ALLOWED TO EXIST. Everywhere else the platform refuses
 * hardcoded expectations and measures instead. That refusal is not possible
 * here: an image provider bills per image and reports no cost with the
 * response, so there is no observation to derive a price from. Without a
 * table, image and audio spend is permanently unmeasurable — which is how
 * it stands today, and it is the largest hole in the cost picture.
 *
 * WHAT KEEPS IT HONEST. Three constraints, all load-bearing:
 *
 * 1. Every entry records the date it was stated and where it came from. A
 *    price is a claim about the world on a particular day, not a fact, and
 *    a stale claim should be visibly stale rather than quietly wrong.
 *
 * 2. A cost derived from this table is marked `stated`, never `observed`.
 *    Downstream it must stay distinguishable from a figure a provider
 *    actually reported.
 *
 * 3. Anomaly detection still compares each model against its own measured
 *    history, never against this table. The table converts units into
 *    money; it is not a source of expectations about what money is normal.
 *
 * An unlisted provider or model yields null — no price, rather than a
 * guessed one. That keeps the "unmeasured is not zero" rule intact: an
 * absent price means we cannot say what it cost, not that it was free.
 */

export type PricingBasis = 'token' | 'per-image' | 'per-character' | 'per-second';

export interface MediaPrice {
  providerId: string;
  modelId: string;
  basis: Exclude<PricingBasis, 'token'>;
  /** Price in cents for one unit of the basis. */
  centsPerUnit: number;
  /** ISO date the price was recorded from the provider's published rates. */
  statedOn: string;
  /** Where the figure came from, so it can be rechecked. */
  source: string;
}

/**
 * Deliberately empty until real published prices are entered against real
 * provider accounts. An invented placeholder price would flow into cost
 * reporting as though it were real, and a wrong number that looks
 * authoritative is worse than an admitted absence.
 */
const prices = new Map<string, MediaPrice>();

function key(providerId: string, modelId: string): string {
  return `${providerId}:${modelId}`;
}

export function registerMediaPrice(price: MediaPrice): void {
  prices.set(key(price.providerId, price.modelId), price);
}

export function getMediaPrice(providerId: string, modelId: string): MediaPrice | null {
  return prices.get(key(providerId, modelId)) ?? null;
}

export function listMediaPrices(): MediaPrice[] {
  return [...prices.values()].sort((a, b) => a.providerId.localeCompare(b.providerId));
}

export function resetMediaPrices(): void {
  prices.clear();
}

export interface PricingResult {
  costCents: number;
  basis: PricingBasis;
  /** Always 'stated' here — this figure came from a table, not a provider response. */
  provenance: 'stated';
  statedOn: string;
  source: string;
}

/**
 * Converts units into money. Returns null when no price is on record, so
 * the caller reports nothing rather than reporting zero.
 */
export function priceMediaUsage(params: {
  providerId: string;
  modelId: string;
  /** Images produced, characters synthesised, or seconds generated. */
  units: number;
}): PricingResult | null {
  const price = getMediaPrice(params.providerId, params.modelId);
  if (!price) return null;
  if (!Number.isFinite(params.units) || params.units < 0) return null;

  return {
    costCents: price.centsPerUnit * params.units,
    basis: price.basis,
    provenance: 'stated',
    statedOn: price.statedOn,
    source: price.source,
  };
}

/**
 * How old a stated price is, in days. A price nobody has rechecked for a
 * year is still reported — with its age — rather than silently trusted or
 * silently dropped.
 */
export function priceAgeDays(price: MediaPrice, now = Date.now()): number | null {
  const stated = Date.parse(price.statedOn);
  if (!Number.isFinite(stated)) return null;
  return Math.floor((now - stated) / 86_400_000);
}
