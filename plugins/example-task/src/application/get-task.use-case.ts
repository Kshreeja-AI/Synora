import type { UseCase } from '@synora/application';
import { Identifier } from '@synora/domain';
import { NotFoundError } from '@synora/errors';
import type { TaskRepository } from './task-repository.port.js';

export interface GetTaskInput {
  id: string;
}

export interface GetTaskOutput {
  id: string;
  title: string;
  completed: boolean;
}

export class GetTaskUseCase implements UseCase<GetTaskInput, GetTaskOutput> {
  constructor(private readonly repository: TaskRepository) {}

  async execute(input: GetTaskInput): Promise<GetTaskOutput> {
    const task = await this.repository.findById(new Identifier(input.id));
    if (!task) {
      throw new NotFoundError(`Task "${input.id}" not found`);
    }
    return { id: task.id.toString(), title: task.title, completed: task.completed };
  }
}
