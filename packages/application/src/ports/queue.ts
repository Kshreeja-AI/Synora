/** Port for a background job queue (default provider: Redis — see infra-redis). */
export interface Queue {
  enqueue<T>(queueName: string, payload: T): Promise<void>;
  process<T>(queueName: string, handler: (payload: T) => Promise<void>): void;
}
