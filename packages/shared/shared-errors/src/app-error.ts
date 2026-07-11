/**
 * Base class for every expected, handled failure that crosses an application,
 * infrastructure, or presentation layer boundary. See docs/architecture/13-error-handling-standards.md.
 */
export abstract class AppError extends Error {
  /** Stable machine-readable code (SCREAMING_SNAKE_CASE), safe to log and to send to clients. */
  abstract readonly code: string;

  /** HTTP status the presentation layer should map this to. */
  abstract readonly httpStatus: number;

  /**
   * Operational errors are anticipated failure modes (bad input, missing resource, ...) whose
   * message is safe to expose. Non-operational errors indicate a bug; presentation adapters
   * must log the full error but return a generic message to the caller.
   */
  abstract readonly isOperational: boolean;

  protected constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}
