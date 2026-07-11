import type { EventBus, Logger } from '@synora/core';
import { InMemoryEventBus } from './in-memory-event-bus.js';
import { RedisEventBus } from './redis-event-bus.js';

export type EventBusDriver = 'in-memory' | 'redis';

export function createEventBus(
  driver: EventBusDriver,
  options: { redisUrl?: string; logger?: Logger },
): EventBus {
  switch (driver) {
    case 'in-memory':
      return new InMemoryEventBus(options.logger);
    case 'redis':
      if (!options.redisUrl) {
        throw new Error('REDIS_URL is required when EVENT_BUS_DRIVER=redis');
      }
      return new RedisEventBus(options.redisUrl, options.logger);
    default:
      throw new Error(`Unknown event bus driver: ${driver satisfies never}`);
  }
}
