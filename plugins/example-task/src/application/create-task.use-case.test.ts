import { InMemoryEventBus } from '@synora/event-bus';
import { FixedClock, InMemoryRepository, SequentialIdGenerator } from '@synora/test-utils';
import { describe, expect, it } from 'vitest';
import type { Task } from '../domain/task.js';
import { CreateTaskUseCase } from './create-task.use-case.js';

describe('CreateTaskUseCase', () => {
  it('saves the task and publishes its domain events', async () => {
    const repository = new InMemoryRepository<Task>();
    const eventBus = new InMemoryEventBus();
    const published: string[] = [];
    eventBus.subscribe('task.created', (event) => {
      published.push(event.eventName);
    });

    const useCase = new CreateTaskUseCase(
      repository,
      new FixedClock(),
      new SequentialIdGenerator('task'),
      eventBus,
    );
    const result = await useCase.execute({ title: 'Write docs' });

    expect(result).toEqual({ id: 'task-1', title: 'Write docs', completed: false });
    expect(published).toEqual(['task.created']);
    expect(await repository.list()).toHaveLength(1);
  });
});
