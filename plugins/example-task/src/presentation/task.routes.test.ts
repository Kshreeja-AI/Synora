import { InMemoryEventBus } from '@synora/event-bus';
import type {
  HttpMethod,
  HttpRequest,
  HttpRouteHandler,
  RouteRegistrar,
} from '@synora/plugin-system';
import { FixedClock, InMemoryRepository, SequentialIdGenerator } from '@synora/test-utils';
import { describe, expect, it } from 'vitest';
import { CreateTaskUseCase } from '../application/create-task.use-case.js';
import { GetTaskUseCase } from '../application/get-task.use-case.js';
import type { Task } from '../domain/task.js';
import { registerTaskRoutes } from './task.routes.js';

class FakeRouteRegistrar implements RouteRegistrar {
  private readonly handlers = new Map<string, HttpRouteHandler>();

  route(method: HttpMethod, path: string, handler: HttpRouteHandler): void {
    this.handlers.set(`${method} ${path}`, handler);
  }

  invoke(method: HttpMethod, path: string, request: Partial<HttpRequest> = {}) {
    const handler = this.handlers.get(`${method} ${path}`);
    if (!handler) throw new Error(`No handler registered for ${method} ${path}`);
    return handler({ params: {}, query: {}, body: undefined, headers: {}, ...request });
  }
}

function buildUseCases() {
  const repository = new InMemoryRepository<Task>();
  const eventBus = new InMemoryEventBus();
  const createTask = new CreateTaskUseCase(
    repository,
    new FixedClock(),
    new SequentialIdGenerator('task'),
    eventBus,
  );
  const getTask = new GetTaskUseCase(repository);
  return { createTask, getTask };
}

describe('task routes', () => {
  it('POST /tasks creates a task and returns 201', async () => {
    const registrar = new FakeRouteRegistrar();
    registerTaskRoutes(registrar, buildUseCases());

    const response = await registrar.invoke('POST', '/tasks', { body: { title: 'Write docs' } });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      success: true,
      data: { id: 'task-1', title: 'Write docs', completed: false },
    });
  });

  it('POST /tasks rejects a missing title with 400', async () => {
    const registrar = new FakeRouteRegistrar();
    registerTaskRoutes(registrar, buildUseCases());

    const response = await registrar.invoke('POST', '/tasks', { body: {} });

    expect(response.status).toBe(400);
  });

  it('GET /tasks/:id returns the created task', async () => {
    const registrar = new FakeRouteRegistrar();
    const useCases = buildUseCases();
    registerTaskRoutes(registrar, useCases);

    await registrar.invoke('POST', '/tasks', { body: { title: 'Write docs' } });
    const response = await registrar.invoke('GET', '/tasks/:id', { params: { id: 'task-1' } });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: { id: 'task-1', title: 'Write docs', completed: false },
    });
  });

  it('GET /tasks/:id returns 404 for an unknown id', async () => {
    const registrar = new FakeRouteRegistrar();
    registerTaskRoutes(registrar, buildUseCases());

    const response = await registrar.invoke('GET', '/tasks/:id', { params: { id: 'missing' } });

    expect(response.status).toBe(404);
  });
});
