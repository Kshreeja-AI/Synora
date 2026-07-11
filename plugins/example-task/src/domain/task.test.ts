import { Identifier } from '@synora/domain';
import { describe, expect, it } from 'vitest';
import { Task, TaskAlreadyCompletedError } from './task.js';

describe('Task', () => {
  it('records a TaskCreated event on creation', () => {
    const task = Task.create('Write docs', Identifier.generate(), new Date('2024-01-01'));

    const events = task.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventName).toBe('task.created');
    expect(task.completed).toBe(false);
  });

  it('records a TaskCompleted event when completed', () => {
    const task = Task.create('Write docs', Identifier.generate(), new Date('2024-01-01'));
    task.pullDomainEvents();

    task.complete();

    expect(task.completed).toBe(true);
    const events = task.pullDomainEvents();
    expect(events[0]?.eventName).toBe('task.completed');
  });

  it('cannot be completed twice', () => {
    const task = Task.create('Write docs', Identifier.generate(), new Date('2024-01-01'));
    task.complete();

    expect(() => task.complete()).toThrow(TaskAlreadyCompletedError);
  });

  it('reconstitute does not raise domain events', () => {
    const id = Identifier.generate();
    const task = Task.reconstitute(
      { title: 'Existing', completed: true, createdAt: new Date() },
      id,
    );

    expect(task.pullDomainEvents()).toHaveLength(0);
    expect(task.title).toBe('Existing');
  });
});
