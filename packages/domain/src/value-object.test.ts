import { describe, expect, it } from 'vitest';
import { ValueObject } from './value-object.js';

interface MoneyProps {
  amount: number;
  currency: string;
}

class Money extends ValueObject<MoneyProps> {
  constructor(props: MoneyProps) {
    super(props);
  }

  get amount(): number {
    return this.props.amount;
  }
}

describe('ValueObject', () => {
  it('is equal when props are structurally equal', () => {
    const a = new Money({ amount: 100, currency: 'INR' });
    const b = new Money({ amount: 100, currency: 'INR' });
    expect(a.equals(b)).toBe(true);
  });

  it('is not equal when props differ', () => {
    const a = new Money({ amount: 100, currency: 'INR' });
    const b = new Money({ amount: 200, currency: 'INR' });
    expect(a.equals(b)).toBe(false);
  });

  it('is not equal to null/undefined', () => {
    const a = new Money({ amount: 100, currency: 'INR' });
    expect(a.equals(undefined)).toBe(false);
    expect(a.equals(null)).toBe(false);
  });
});
