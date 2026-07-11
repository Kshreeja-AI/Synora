import { AsyncLocalStorage } from 'node:async_hooks';

const correlationStorage = new AsyncLocalStorage<string>();

/** Runs `fn` with `correlationId` available to every logger call inside it (see Logger.info etc.). */
export function runWithCorrelationId<T>(correlationId: string, fn: () => T): T {
  return correlationStorage.run(correlationId, fn);
}

export function getCorrelationId(): string | undefined {
  return correlationStorage.getStore();
}
