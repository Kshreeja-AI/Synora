/**
 * Port for reading the current time. Use cases must never call `new Date()`/`Date.now()`
 * directly — going through this port keeps them deterministic and testable
 * (see @synora/test-utils' FixedClock).
 */
export interface Clock {
  now(): Date;
}
