import { Identifier } from '@synora/domain';
import { InMemoryRepository } from '@synora/test-utils';
import { describe, expect, it } from 'vitest';
import { Task } from '../domain/task.js';
import { GetTaskUseCase } from './get-task.use-case.js';

describe('GetTaskUseCase', () => {
  it('returns the task when found', async () => {
    const repository = new InMemoryRepository<Task>();
    const id = Identifier.generate();
    await repository.save(
      Task.reconstitute({ title: 'Existing', completed: false, createdAt: new Date() }, id),
    );

    const useCase = new GetTaskUseCase(repository);
    const result = await useCase.execute({ id: id.toString() });

    expect(result).toEqual({ id: id.toString(), title: 'Existing', completed: false });
  });

  it('throws NotFoundError when the task does not exist', async () => {
    const repository = new InMemoryRepository<Task>();
    const useCase = new GetTaskUseCase(repository);

    await expect(useCase.execute({ id: 'missing' })).rejects.toThrow('not found');
  });
});
