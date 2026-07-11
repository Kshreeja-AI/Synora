import type { PostgresDatabase } from '@synora/infra-postgres';
import { mapPostgresError } from '@synora/infra-postgres';
import { Identifier } from '@synora/domain';
import { eq } from 'drizzle-orm';
import type { TaskRepository } from '../application/task-repository.port.js';
import { Task } from '../domain/task.js';
import { tasksTable } from './schema.js';

export class PostgresTaskRepository implements TaskRepository {
  constructor(private readonly db: PostgresDatabase) {}

  async save(task: Task): Promise<void> {
    try {
      await this.db
        .insert(tasksTable)
        .values({
          id: task.id.toString(),
          title: task.title,
          completed: task.completed,
          createdAt: task.createdAt,
        })
        .onConflictDoUpdate({
          target: tasksTable.id,
          set: { title: task.title, completed: task.completed },
        });
    } catch (error) {
      throw mapPostgresError(error);
    }
  }

  async findById(id: Identifier): Promise<Task | undefined> {
    try {
      const rows = await this.db
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.id, id.toString()))
        .limit(1);
      const row = rows[0];
      if (!row) return undefined;
      return Task.reconstitute(
        { title: row.title, completed: row.completed, createdAt: row.createdAt },
        new Identifier(row.id),
      );
    } catch (error) {
      throw mapPostgresError(error);
    }
  }
}
