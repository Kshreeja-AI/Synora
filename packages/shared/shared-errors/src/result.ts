/**
 * Result<T, E> — for expected-failure flows within a layer where throwing would be overkill
 * (e.g. "email already taken"). Reserve thrown AppErrors for failures that should
 * short-circuit across a layer boundary. See docs/architecture/13-error-handling-standards.md.
 */
export type Result<T, E = Error> =
  Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: E }>;

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function isOk<T, E>(result: Result<T, E>): result is { ok: true; value: T } {
  return result.ok;
}

export function isErr<T, E>(result: Result<T, E>): result is { ok: false; error: E } {
  return !result.ok;
}
