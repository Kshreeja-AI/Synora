import type { DomainEvent } from '@synora/domain';
import type { EventBus, EventHandler, Unsubscribe } from '@synora/event-bus';
import type { NatsClientLike } from './nats-client-like.js';

export interface NatsEventBusOptions {
  onHandlerError?: (error: unknown, event: DomainEvent) => void;
}

/**
 * Production EventBus adapter — one NATS subject per `event.eventName`. Note that events
 * cross the wire as plain JSON: subscribers receive a structurally-identical object, not
 * an `instanceof DomainEvent`. Handlers should only rely on the event's own fields.
 */
export class NatsEventBus implements EventBus {
  private readonly onHandlerError: (error: unknown, event: DomainEvent) => void;

  constructor(
    private readonly client: NatsClientLike,
    options: NatsEventBusOptions = {},
  ) {
    this.onHandlerError =
      options.onHandlerError ??
      ((error, event) => {
        console.error(`[nats-event-bus] handler for "${event.eventName}" threw`, error);
      });
  }

  async publish(event: DomainEvent): Promise<void> {
    const data = new TextEncoder().encode(JSON.stringify(event));
    this.client.publish(event.eventName, data);
  }

  async publishAll(events: readonly DomainEvent[]): Promise<void> {
    for (const event of events) {
      await this.publish(event);
    }
  }

  subscribe<E extends DomainEvent>(eventName: string, handler: EventHandler<E>): Unsubscribe {
    const subscription = this.client.subscribe(eventName, (data) => {
      const event = JSON.parse(new TextDecoder().decode(data)) as E;
      try {
        Promise.resolve(handler(event)).catch((error: unknown) =>
          this.onHandlerError(error, event),
        );
      } catch (error) {
        this.onHandlerError(error, event);
      }
    });
    return () => subscription.unsubscribe();
  }
}
