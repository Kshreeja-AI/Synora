import { describe, expect, it } from 'vitest';
import { Entity } from './entity.js';
import { Identifier } from './identifier.js';

interface WidgetProps {
  name: string;
}

class Widget extends Entity<WidgetProps> {
  constructor(props: WidgetProps, id: Identifier) {
    super(props, id);
  }

  get name(): string {
    return this.props.name;
  }
}

describe('Entity', () => {
  it('is equal when ids match, regardless of props', () => {
    const id = Identifier.generate();
    const a = new Widget({ name: 'A' }, id);
    const b = new Widget({ name: 'B' }, id);
    expect(a.equals(b)).toBe(true);
  });

  it('is not equal when ids differ', () => {
    const a = new Widget({ name: 'A' }, Identifier.generate());
    const b = new Widget({ name: 'A' }, Identifier.generate());
    expect(a.equals(b)).toBe(false);
  });
});
