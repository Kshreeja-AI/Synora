import { connect, type NatsConnection } from 'nats';
import type { NatsClientLike } from './nats-client-like.js';

export interface NatsConnectionOptions {
  servers: string | string[];
}

export async function createNatsConnection(
  options: NatsConnectionOptions,
): Promise<NatsConnection> {
  return connect({ servers: options.servers });
}

/** Bridges a real NatsConnection to the minimal NatsClientLike surface NatsEventBus depends on. */
export function toNatsClientLike(connection: NatsConnection): NatsClientLike {
  return {
    publish(subject, data) {
      connection.publish(subject, data);
    },
    subscribe(subject, onMessage) {
      const subscription = connection.subscribe(subject);
      void (async () => {
        for await (const message of subscription) {
          onMessage(message.data);
        }
      })();
      return { unsubscribe: () => subscription.unsubscribe() };
    },
  };
}
