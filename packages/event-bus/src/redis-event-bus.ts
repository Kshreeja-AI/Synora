import type { DomainEvent, EventBus, EventHandler, Logger, Subscription } from '@synora/core';
import { Redis } from 'ioredis';

const CHANNEL_PREFIX = 'synora:events:';

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
 * Redis-backed EventBus for multi-instance deployments: every process
 * publishes to and psubscribes on the same Redis instance, so an
 * event published by one gateway pod fans out to subscribers running
 * in any pod. Same EventBus contract as InMemoryEventBus — orchestration,
 * memory, and product code never know which implementation is wired in.
 */
export class RedisEventBus implements EventBus {
  private readonly publisher: Redis;
  private readonly subscriber: Redis;
  private readonly registrations = new Set<Registration>();
  private started = false;

  constructor(
    redisUrl: string,
    private readonly logger?: Logger,
  ) {
    this.publisher = new Redis(redisUrl);
    this.subscriber = new Redis(redisUrl);
  }

  private ensureStarted(): void {
    if (this.started) return;
    this.started = true;
    this.subscriber.psubscribe(`${CHANNEL_PREFIX}*`).catch((error) => {
      this.logger?.error('failed to psubscribe', { error: String(error) });
    });
    this.subscriber.on('pmessage', (_pattern, _channel, message) => {
      let event: DomainEvent<unknown>;
      try {
        event = JSON.parse(message);
      } catch {
        this.logger?.warn('dropped malformed event payload');
        return;
      }
      for (const registration of this.registrations) {
        if (!matches(registration.matcher, event.type)) continue;
        Promise.resolve(registration.handler(event)).catch((error) => {
          this.logger?.error('event handler threw', {
            eventType: event.type,
            eventId: event.id,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
    });
  }

  async publish<TPayload>(event: DomainEvent<TPayload>): Promise<void> {
    await this.publisher.publish(`${CHANNEL_PREFIX}${event.type}`, JSON.stringify(event));
  }

  subscribe<TPayload>(eventType: string | RegExp, handler: EventHandler<TPayload>): Subscription {
    this.ensureStarted();
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

  async close(): Promise<void> {
    await Promise.all([this.publisher.quit(), this.subscriber.quit()]);
  }
}
