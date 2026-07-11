import { describe, expect, it } from 'vitest';
import { NotFoundError, ValidationError } from './common-errors.js';

describe('common errors', () => {
  it('ValidationError carries details and a 400 status', () => {
    const error = new ValidationError('invalid email', { field: 'email' });
    expect(error.httpStatus).toBe(400);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.details).toEqual({ field: 'email' });
  });

  it('NotFoundError maps to a 404 status', () => {
    const error = new NotFoundError('task not found');
    expect(error.httpStatus).toBe(404);
    expect(error.isOperational).toBe(true);
  });
});
