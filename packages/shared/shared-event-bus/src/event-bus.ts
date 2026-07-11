import type { DomainEvent } from '@synora/domain';

export type EventHandler<E extends DomainEvent = DomainEvent> = (event: E) => Promise<void> | void;

/** Unsubscribes a previously-registered handler. */
export type Unsubscribe = () => void;

/**
 * Port for publishing and subscribing to domain events across use cases and plugins,
 * decoupling the publisher from whatever eventually reacts to the event. See
 * docs/architecture/07-event-driven-architecture.md.
 */
export interface EventBus {
  publish(event: DomainEvent): Promise<void>;
  publishAll(events: readonly DomainEvent[]): Promise<void>;
  subscribe<E extends DomainEvent>(eventName: string, handler: EventHandler<E>): Unsubscribe;
}
