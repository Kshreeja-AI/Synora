/**
 * Bounded waiting for provider calls.
 *
 * Before this existed, a text-generation call had NO upper bound: a
 * provider that accepted the connection and then stalled would hold the
 * request — and the person waiting on it — forever. A timeout converts
 * "hung" into a failure the retry layer can classify and act on.
 *
 * The error message deliberately contains the word "timeout" so
 * `isRetryableError` in `./retry` recognizes it as transient — one
 * vocabulary across the resilience layer, not a coincidence.
 *
 * LIMITATION, stated: this bounds how long Synora WAITS; it does not
 * cancel the underlying HTTP request (the live provider SDK calls do not
 * yet accept an AbortSignal). The remote call may still complete and
 * bill after we have stopped waiting. Wiring true cancellation through
 * the SDKs is the follow-up, tracked in the provider readiness matrix.
 */
export async function withTimeout<T>(
  work: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timeout after ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
