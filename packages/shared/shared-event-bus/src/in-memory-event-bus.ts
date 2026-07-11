import type { DomainEvent } from '@synora/domain';
import type { EventBus, EventHandler, Unsubscribe } from './event-bus.js';

export interface InMemoryEventBusOptions {
  /** Called when a handler throws — a bad handler must never take down the publisher. Defaults to console.error. */
  onHandlerError?: (error: unknown, event: DomainEvent) => void;
}

/**
 * In-process EventBus adapter for tests and local development. Handlers for the same
 * event run sequentially and are isolated from each other's failures — see
 * docs/architecture/07-event-driven-architecture.md.
 */
export class InMemoryEventBus implements EventBus {
  private readonly handlers = new Map<string, Set<EventHandler<DomainEvent>>>();
  private readonly onHandlerError: (error: unknown, event: DomainEvent) => void;

  constructor(options: InMemoryEventBusOptions = {}) {
    this.onHandlerError =
      options.onHandlerError ??
      ((error, event) => {
        console.error(`[event-bus] handler for "${event.eventName}" threw`, error);
      });
  }

  async publish(event: DomainEvent): Promise<void> {
    const handlers = this.handlers.get(event.eventName);
    if (!handlers) return;

    for (const handler of handlers) {
      try {
        await handler(event);
      } catch (error) {
        this.onHandlerError(error, event);
      }
    }
  }

  async publishAll(events: readonly DomainEvent[]): Promise<void> {
    for (const event of events) {
      await this.publish(event);
    }
  }

  subscribe<E extends DomainEvent>(eventName: string, handler: EventHandler<E>): Unsubscribe {
    const set = this.handlers.get(eventName) ?? new Set<EventHandler<DomainEvent>>();
    set.add(handler as EventHandler<DomainEvent>);
    this.handlers.set(eventName, set);
    return () => set.delete(handler as EventHandler<DomainEvent>);
  }
}
