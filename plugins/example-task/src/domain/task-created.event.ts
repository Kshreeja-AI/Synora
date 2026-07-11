import { DomainEvent, type Identifier } from '@synora/domain';

export class TaskCreated extends DomainEvent {
  readonly eventName = 'task.created';

  constructor(
    aggregateId: Identifier,
    readonly title: string,
  ) {
    super(aggregateId);
  }
}
