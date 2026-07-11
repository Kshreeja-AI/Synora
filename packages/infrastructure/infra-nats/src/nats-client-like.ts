export interface NatsSubscription {
  unsubscribe(): void;
}

/** The minimal pub/sub surface NatsEventBus needs — lets tests inject a fake in-process bus. */
export interface NatsClientLike {
  publish(subject: string, data: Uint8Array): void;
  subscribe(subject: string, onMessage: (data: Uint8Array) => void): NatsSubscription;
}
