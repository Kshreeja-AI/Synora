import { describe, it, expect } from 'vitest';
import { createApiResponse, createApiError, slugify, isValidEmail, generateId } from '@synora/shared';

describe('Shared Utilities', () => {
  describe('createApiResponse', () => {
    it('should create a success response', () => {
      const data = { id: '123', name: 'Test' };
      const response = createApiResponse(data);

      expect(response.success).toBe(true);
      expect(response.data).toEqual(data);
      expect(response.meta).toBeDefined();
      expect(response.meta.timestamp).toBeDefined();
    });
  });

  describe('createApiError', () => {
    it('should create an error response', () => {
      const error = createApiError('TEST_ERROR', 'Test error message');

      expect(error.success).toBe(false);
      expect(error.error.code).toBe('TEST_ERROR');
      expect(error.error.message).toBe('Test error message');
    });
  });

  describe('slugify', () => {
    it('should convert text to slug format', () => {
      expect(slugify('Hello World')).toBe('hello-world');
      expect(slugify('  Spaces  ')).toBe('spaces');
      expect(slugify('Special!@#$Characters')).toBe('specialcharacters');
    });
  });

  describe('isValidEmail', () => {
    it('should validate email format', () => {
      expect(isValidEmail('user@example.com')).toBe(true);
      expect(isValidEmail('invalid.email')).toBe(false);
      expect(isValidEmail('test@domain.co.uk')).toBe(true);
    });
  });

  describe('generateId', () => {
    it('should generate unique IDs', () => {
      const id1 = generateId();
      const id2 = generateId();

      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
      expect(id1).not.toBe(id2);
    });
  });
});
