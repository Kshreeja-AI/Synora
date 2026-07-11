import type { Entity, Identifier } from '@synora/domain';

/**
 * Generic in-memory fake for a repository port keyed by entity id. Extend this in a
 * plugin's tests to get save/findById/delete/list for free instead of hand-rolling a mock.
 */
export class InMemoryRepository<T extends Entity<unknown>> {
  protected readonly items = new Map<string, T>();

  async save(entity: T): Promise<void> {
    this.items.set(entity.id.toString(), entity);
  }

  async findById(id: Identifier): Promise<T | undefined> {
    return this.items.get(id.toString());
  }

  async delete(id: Identifier): Promise<void> {
    this.items.delete(id.toString());
  }

  async list(): Promise<T[]> {
    return [...this.items.values()];
  }

  clear(): void {
    this.items.clear();
  }
}
