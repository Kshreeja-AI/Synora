import { describe, expect, it } from 'vitest';
import { AggregateRoot } from './aggregate-root.js';
import { DomainEvent } from './domain-event.js';
import { Identifier } from './identifier.js';

class WidgetRenamed extends DomainEvent {
  readonly eventName = 'widget.renamed';
}

interface WidgetProps {
  name: string;
}

class Widget extends AggregateRoot<WidgetProps> {
  private constructor(props: WidgetProps, id: Identifier) {
    super(props, id);
  }

  static create(name: string): Widget {
    const widget = new Widget({ name }, Identifier.generate());
    return widget;
  }

  rename(name: string): void {
    this.props.name = name;
    this.addDomainEvent(new WidgetRenamed(this.id));
  }
}

describe('AggregateRoot', () => {
  it('records domain events and clears them once pulled', () => {
    const widget = Widget.create('Original');
    widget.rename('Renamed');

    const events = widget.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventName).toBe('widget.renamed');

    expect(widget.pullDomainEvents()).toHaveLength(0);
  });
});
