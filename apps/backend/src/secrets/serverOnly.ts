/**
 * Hard runtime guard: throws if this module graph ever ends up evaluated
 * in a browser bundle. Secrets must never be exposed to the frontend —
 * this backstops that even if someone accidentally imports the secrets
 * package from client code, since a bundler pulling this in would still
 * execute the check the moment the chunk runs.
 */
export function assertServerOnly(): void {
  if (typeof window !== 'undefined') {
    throw new Error(
      'apps/backend/src/secrets must never be imported into client-side code. ' +
        'Secrets must never be exposed to the frontend.'
    );
  }
}
