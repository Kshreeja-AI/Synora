import { describe, expect, it } from 'vitest';
import { ApplicationError } from './application-error.js';

class ExampleValidationError extends ApplicationError {
  readonly code = 'EXAMPLE_VALIDATION_ERROR';
  readonly httpStatus = 400;
  readonly isOperational = true;
}

describe('ApplicationError', () => {
  it('carries a code and http status through the AppError base', () => {
    const error = new ExampleValidationError('bad input');
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('EXAMPLE_VALIDATION_ERROR');
    expect(error.httpStatus).toBe(400);
    expect(error.message).toBe('bad input');
  });
});
