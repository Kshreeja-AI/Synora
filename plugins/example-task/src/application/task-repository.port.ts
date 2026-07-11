import type { Identifier } from '@synora/domain';
import type { Task } from '../domain/task.js';

/** Repository port owned by this plugin's application layer — implemented in ./infrastructure. */
export interface TaskRepository {
  save(task: Task): Promise<void>;
  findById(id: Identifier): Promise<Task | undefined>;
}
