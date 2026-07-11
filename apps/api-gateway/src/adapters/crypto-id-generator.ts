import { randomUUID } from 'node:crypto';
import type { IdGenerator } from '@synora/application';

export class CryptoIdGenerator implements IdGenerator {
  generate(): string {
    return randomUUID();
  }
}
