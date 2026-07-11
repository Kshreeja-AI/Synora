import type { Clock } from '@synora/application';

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
