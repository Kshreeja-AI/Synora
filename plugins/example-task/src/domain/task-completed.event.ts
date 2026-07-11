import { DomainEvent, type Identifier } from '@synora/domain';

export class TaskCompleted extends DomainEvent {
  readonly eventName = 'task.completed';

  constructor(aggregateId: Identifier) {
    super(aggregateId);
  }
}
