/**
 * Port for generating unique identifiers. Use cases must never call `crypto.randomUUID()`
 * directly — going through this port keeps id generation swappable and testable
 * (see @synora/test-utils' SequentialIdGenerator).
 */
export interface IdGenerator {
  generate(): string;
}
