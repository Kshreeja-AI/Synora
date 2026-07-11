import { Entity } from './entity.js';
import type { DomainEvent } from './domain-event.js';
import type { Identifier } from './identifier.js';

/**
 * An Entity that is the consistency boundary for a cluster of domain objects and the
 * only object external code (application layer) is allowed to reference directly.
 * Records domain events as it mutates; the application layer pulls and publishes them
 * (typically after a successful persistence transaction) via @synora/event-bus.
 */
export abstract class AggregateRoot<Props> extends Entity<Props> {
  private _domainEvents: DomainEvent[] = [];

  protected constructor(props: Props, id: Identifier) {
    super(props, id);
  }

  protected addDomainEvent(event: DomainEvent): void {
    this._domainEvents.push(event);
  }

  pullDomainEvents(): DomainEvent[] {
    const events = [...this._domainEvents];
    this._domainEvents = [];
    return events;
  }
}
