import { AppError } from '@synora/errors';
import type { Logger } from '@synora/logger';
import type { ApiResponse } from '@synora/types';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';

/** The one place presentation code knows both AppError and the ApiResponse envelope — see docs/architecture/13-error-handling-standards.md. */
export function createErrorHandler(logger: Logger) {
  return (error: FastifyError | Error, request: FastifyRequest, reply: FastifyReply): void => {
    if (error instanceof AppError) {
      if (!error.isOperational) {
        logger.error('Non-operational error', { error, path: request.url });
      }
      const body: ApiResponse<never> = {
        success: false,
        error: {
          code: error.code,
          message: error.isOperational ? error.message : 'Internal error',
        },
      };
      reply.status(error.httpStatus).send(body);
      return;
    }

    logger.error('Unhandled error', { error, path: request.url });
    const body: ApiResponse<never> = {
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal error' },
    };
    reply.status(500).send(body);
  };
}
