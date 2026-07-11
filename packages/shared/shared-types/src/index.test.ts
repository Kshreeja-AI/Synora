import { describe, expect, it } from 'vitest';
import type { ApiResponse } from './api-response.js';

describe('ApiResponse', () => {
  it('discriminates on success', () => {
    const response: ApiResponse<{ id: string }> = { success: true, data: { id: '1' } };
    expect(response.success).toBe(true);
    if (response.success) {
      expect(response.data.id).toBe('1');
    }
  });
});
