import type { Clock, IdGenerator, UseCase } from '@synora/application';
import { Identifier } from '@synora/domain';
import type { EventBus } from '@synora/event-bus';
import { Task } from '../domain/task.js';
import type { TaskRepository } from './task-repository.port.js';

export interface CreateTaskInput {
  title: string;
}

export interface CreateTaskOutput {
  id: string;
  title: string;
  completed: boolean;
}

export class CreateTaskUseCase implements UseCase<CreateTaskInput, CreateTaskOutput> {
  constructor(
    private readonly repository: TaskRepository,
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
    private readonly eventBus: EventBus,
  ) {}

  async execute(input: CreateTaskInput): Promise<CreateTaskOutput> {
    const task = Task.create(
      input.title,
      new Identifier(this.idGenerator.generate()),
      this.clock.now(),
    );

    await this.repository.save(task);
    await this.eventBus.publishAll(task.pullDomainEvents());

    return { id: task.id.toString(), title: task.title, completed: task.completed };
  }
}
