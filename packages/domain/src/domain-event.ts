import { randomUUID } from 'node:crypto';
import type { Identifier } from './identifier.js';

/**
 * Base class for events raised by an AggregateRoot when a business-significant
 * state change occurs. Handlers live in the application layer or in other plugins'
 * event subscribers — see @synora/event-bus and docs/architecture/07-event-driven-architecture.md.
 */
export abstract class DomainEvent {
  readonly eventId: string;
  readonly occurredAt: Date;
  readonly aggregateId: string;

  protected constructor(aggregateId: Identifier | string) {
    this.eventId = randomUUID();
    this.occurredAt = new Date();
    this.aggregateId = typeof aggregateId === 'string' ? aggregateId : aggregateId.toString();
  }

  /** Stable, unique name used for subscription routing and serialization (e.g. "task.created"). */
  abstract readonly eventName: string;
}
