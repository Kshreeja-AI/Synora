import { randomUUID } from 'node:crypto';

/**
 * A typed identity value. Wrapping raw strings prevents mixing up ids across
 * unrelated aggregates at the type level (e.g. a TaskId cannot be passed where a UserId is expected).
 */
export class Identifier<T extends string = string> {
  private readonly value: T;

  constructor(value: T) {
    this.value = value;
  }

  static generate<T extends string = string>(): Identifier<T> {
    return new Identifier(randomUUID() as T);
  }

  toString(): string {
    return this.value;
  }

  toValue(): T {
    return this.value;
  }

  equals(other: Identifier<T> | undefined | null): boolean {
    if (other === undefined || other === null) return false;
    if (!(other instanceof Identifier)) return false;
    return this.value === other.value;
  }
}
