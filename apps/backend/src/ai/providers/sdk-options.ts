/**
 * The SDK client options every metered provider must be constructed with.
 *
 * WHY THIS EXISTS. Synora already wraps provider calls in its own timeout,
 * retry and circuit-breaker layer (`ai/textResilience.ts`), and the spend
 * guard charges per attempt made. But the vendor SDKs ALSO retry internally
 * and by default — the Anthropic and OpenAI clients both ship
 * `maxRetries: 2`, i.e. up to 3 HTTP requests per call Synora believes is
 * one. Stacked with Synora's own 3 attempts that is up to NINE billable
 * requests for a single logical generation, and the eight Synora never
 * learns about are invisible to the cap.
 *
 * Worse for accounting: the Anthropic SDK's default timeout is ten minutes,
 * five times Synora's own 120s bound. Synora abandons the wait at 120s and
 * retries, while the SDK keeps the original request alive and billing.
 *
 * So retries are Synora's job, once, in one place:
 *  - `maxRetries: 0` — the resilience layer owns retry policy, backoff and
 *    the circuit breaker, and it is the layer the spend guard can see.
 *  - `timeout` slightly BELOW Synora's own, so the SDK gives up first and
 *    the request is actually dead rather than orphaned and billing.
 *
 * This is not a vendor-specific concession: it is the general rule that a
 * capability's retry behaviour belongs to whichever layer accounts for it.
 */

/** Synora's own text-path bound, mirrored from `ai/textResilience.ts`. */
const SYNORA_TEXT_TIMEOUT_MS = 120_000;

/**
 * A little under Synora's own timeout so the SDK aborts FIRST. If the SDK
 * outlived Synora's bound, the abandoned request would keep running — and
 * keep billing — with nothing left watching it.
 */
export const SDK_TIMEOUT_MS = SYNORA_TEXT_TIMEOUT_MS - 5_000;

export const SDK_CLIENT_OPTIONS = {
  maxRetries: 0,
  timeout: SDK_TIMEOUT_MS,
} as const;
