import { AggregateRoot, DomainError, type Identifier } from '@synora/domain';
import { TaskCompleted } from './task-completed.event.js';
import { TaskCreated } from './task-created.event.js';

export class TaskAlreadyCompletedError extends DomainError {
  readonly code = 'TASK_ALREADY_COMPLETED';
  constructor() {
    super('Task is already completed');
  }
}

export interface TaskProps {
  title: string;
  completed: boolean;
  createdAt: Date;
}

export class Task extends AggregateRoot<TaskProps> {
  private constructor(props: TaskProps, id: Identifier) {
    super(props, id);
  }

  static create(title: string, id: Identifier, now: Date): Task {
    const task = new Task({ title, completed: false, createdAt: now }, id);
    task.addDomainEvent(new TaskCreated(id, title));
    return task;
  }

  /** Reconstructs a Task from persisted state — does not raise domain events. */
  static reconstitute(props: TaskProps, id: Identifier): Task {
    return new Task(props, id);
  }

  get title(): string {
    return this.props.title;
  }

  get completed(): boolean {
    return this.props.completed;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  complete(): void {
    if (this.props.completed) {
      throw new TaskAlreadyCompletedError();
    }
    this.props.completed = true;
    this.addDomainEvent(new TaskCompleted(this.id));
  }
}
