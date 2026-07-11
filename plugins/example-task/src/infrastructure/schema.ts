import { boolean, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/** Owned entirely by this plugin — the platform kernel has no opinion on plugin schemas. */
export const tasksTable = pgTable('tasks', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  completed: boolean('completed').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});
