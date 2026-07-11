/**
 * Every application-layer operation is a UseCase: a single, named, testable unit of
 * business orchestration between the domain layer and the ports it depends on.
 * Presentation-layer adapters (HTTP controllers, CLI commands, event subscribers, ...)
 * are the only callers of `execute` — they never reach into the domain layer directly.
 */
export interface UseCase<Input, Output> {
  execute(input: Input): Promise<Output>;
}
