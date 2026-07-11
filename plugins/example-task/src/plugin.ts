import { CLOCK, ID_GENERATOR } from '@synora/application';
import { POSTGRES_DATABASE } from '@synora/infra-postgres';
import type { Plugin, PluginContext } from '@synora/plugin-system';
import { CreateTaskUseCase, GetTaskUseCase } from './application/index.js';
import type { TaskCreated } from './domain/index.js';
import { PostgresTaskRepository } from './infrastructure/index.js';
import { registerTaskRoutes } from './presentation/index.js';

/**
 * Reference/example plugin — see README.md. Demonstrates the full composition a real
 * product plugin performs in `register()`: resolve platform ports from the DI container,
 * build its own repository/use cases, register HTTP routes, and subscribe to its own
 * domain events.
 */
export const exampleTaskPlugin: Plugin = {
  id: 'example-task',
  version: '0.1.0',

  register(context: PluginContext): void {
    const db = context.container.resolve(POSTGRES_DATABASE);
    const clock = context.container.resolve(CLOCK);
    const idGenerator = context.container.resolve(ID_GENERATOR);

    const repository = new PostgresTaskRepository(db);
    const createTask = new CreateTaskUseCase(repository, clock, idGenerator, context.eventBus);
    const getTask = new GetTaskUseCase(repository);

    registerTaskRoutes(context.routes, { createTask, getTask });

    const pluginLogger = context.logger.child({ plugin: exampleTaskPlugin.id });
    context.eventBus.subscribe<TaskCreated>('task.created', (event) => {
      pluginLogger.info('Task created', { taskId: event.aggregateId, title: event.title });
    });
  },
};
