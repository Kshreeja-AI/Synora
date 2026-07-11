import type { DomainEvent, EventBus, EventHandler, Logger, Subscription } from '@synora/core';

interface Registration {
  matcher: string | RegExp;
  handler: EventHandler<unknown>;
}

function matches(matcher: string | RegExp, eventType: string): boolean {
  if (matcher instanceof RegExp) return matcher.test(eventType);
  if (matcher.endsWith('*')) return eventType.startsWith(matcher.slice(0, -1));
  return matcher === eventType;
}

/**
 * Single-process event bus. Handlers run concurrently and are isolated
 * from each other and from the publisher: one throwing handler never
 * blocks publish() or other subscribers. Good default for tests, local
 * dev, and single-instance deployments; swap for RedisEventBus once
 * you run more than one process.
 */
export class InMemoryEventBus implements EventBus {
  private readonly registrations = new Set<Registration>();

  constructor(private readonly logger?: Logger) {}

  async publish<TPayload>(event: DomainEvent<TPayload>): Promise<void> {
    const matching = Array.from(this.registrations).filter((r) => matches(r.matcher, event.type));
    await Promise.all(
      matching.map(async (registration) => {
        try {
          await registration.handler(event);
        } catch (error) {
          this.logger?.error('event handler threw', {
            eventType: event.type,
            eventId: event.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }),
    );
  }

  subscribe<TPayload>(eventType: string | RegExp, handler: EventHandler<TPayload>): Subscription {
    const registration: Registration = {
      matcher: eventType,
      handler: handler as EventHandler<unknown>,
    };
    this.registrations.add(registration);
    return {
      unsubscribe: () => {
        this.registrations.delete(registration);
      },
    };
  }
}
