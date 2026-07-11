/**
 * Base class for violations of a domain invariant/business rule (e.g. "a Task cannot be
 * completed twice"). Intentionally separate from @synora/errors' AppError hierarchy: the
 * domain layer has zero dependencies, and domain rule violations are a different concern
 * from application/infrastructure/transport failures. Application-layer code that catches
 * a DomainError typically translates it into an AppError subtype before it crosses the
 * layer boundary — see docs/architecture/13-error-handling-standards.md.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
