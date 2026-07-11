import { ValidationError } from '@synora/errors';
import type { HttpResponse, RouteRegistrar } from '@synora/plugin-system';
import type { CreateTaskUseCase } from '../application/create-task.use-case.js';
import type { GetTaskUseCase } from '../application/get-task.use-case.js';
import { toErrorResponse, toSuccessResponse } from './to-http-response.js';

export interface TaskUseCases {
  createTask: CreateTaskUseCase;
  getTask: GetTaskUseCase;
}

function isCreateTaskBody(body: unknown): body is { title: string } {
  return (
    typeof body === 'object' &&
    body !== null &&
    typeof (body as { title?: unknown }).title === 'string'
  );
}

export function registerTaskRoutes(routes: RouteRegistrar, useCases: TaskUseCases): void {
  routes.route('POST', '/tasks', async (request): Promise<HttpResponse> => {
    try {
      if (!isCreateTaskBody(request.body) || request.body.title.trim().length === 0) {
        throw new ValidationError('title is required');
      }
      const result = await useCases.createTask.execute({ title: request.body.title });
      return toSuccessResponse(result, 201);
    } catch (error) {
      return toErrorResponse(error);
    }
  });

  routes.route('GET', '/tasks/:id', async (request): Promise<HttpResponse> => {
    try {
      const id = request.params['id'];
      if (!id) {
        throw new ValidationError('id path parameter is required');
      }
      const result = await useCases.getTask.execute({ id });
      return toSuccessResponse(result);
    } catch (error) {
      return toErrorResponse(error);
    }
  });
}
