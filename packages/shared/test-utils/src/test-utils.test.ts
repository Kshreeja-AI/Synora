import { Entity, Identifier } from '@synora/domain';
import { describe, expect, it } from 'vitest';
import { FixedClock } from './fixed-clock.js';
import { InMemoryRepository } from './in-memory-repository.js';
import { SequentialIdGenerator } from './sequential-id-generator.js';

class Widget extends Entity<{ name: string }> {
  constructor(name: string, id: Identifier = Identifier.generate()) {
    super({ name }, id);
  }
}

describe('FixedClock', () => {
  it('returns the same instant until advanced', () => {
    const clock = new FixedClock(new Date('2024-06-01T00:00:00.000Z'));
    const first = clock.now();
    expect(clock.now()).toBe(first);
    clock.advance(1000);
    expect(clock.now().getTime()).toBe(first.getTime() + 1000);
  });
});

describe('SequentialIdGenerator', () => {
  it('produces deterministic, incrementing ids', () => {
    const generator = new SequentialIdGenerator('task');
    expect(generator.generate()).toBe('task-1');
    expect(generator.generate()).toBe('task-2');
  });
});

describe('InMemoryRepository', () => {
  it('saves, finds, lists, and deletes entities by id', async () => {
    const repo = new InMemoryRepository<Widget>();
    const widget = new Widget('gadget');

    await repo.save(widget);
    expect(await repo.findById(widget.id)).toBe(widget);
    expect(await repo.list()).toHaveLength(1);

    await repo.delete(widget.id);
    expect(await repo.findById(widget.id)).toBeUndefined();
  });
});
