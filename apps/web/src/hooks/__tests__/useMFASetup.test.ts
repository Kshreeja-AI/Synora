import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useMFASetup } from '../useMFASetup';

describe('useMFASetup', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('should initialize with idle state', () => {
      const { result } = renderHook(() => useMFASetup());

      expect(result.current.step).toBe('idle');
      expect(result.current.setupToken).toBeNull();
      expect(result.current.secret).toBeNull();
      expect(result.current.qrCode).toBeNull();
      expect(result.current.recoveryCodes).toBeNull();
      expect(result.current.expiresAt).toBeNull();
      expect(result.current.error).toBeNull();
      expect(result.current.isLoading).toBe(false);
    });
  });

  describe('initiate', () => {
    it('should fetch setup token from API', async () => {
      const mockData = {
        data: {
          setupToken: 'token123',
          secret: 'secret123',
          qrCode: 'qrcode_data',
          expiresAt: new Date().toISOString(),
        },
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockData,
      });

      const { result } = renderHook(() => useMFASetup());

      await act(async () => {
        await result.current.initiate();
      });

      expect(result.current.step).toBe('qr-ready');
      expect(result.current.setupToken).toBe('token123');
      expect(result.current.secret).toBe('secret123');
      expect(result.current.qrCode).toBe('qrcode_data');
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('should set loading state during request', async () => {
      (global.fetch as any).mockImplementationOnce(() => new Promise(() => {})); // Never resolves

      const { result } = renderHook(() => useMFASetup());

      act(() => {
        result.current.initiate();
      });

      expect(result.current.isLoading).toBe(true);
    });

    it('should handle API errors', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        statusText: 'Unauthorized',
      });

      const { result } = renderHook(() => useMFASetup());

      await act(async () => {
        await result.current.initiate();
      });

      expect(result.current.step).toBe('error');
      expect(result.current.error).toBeDefined();
      expect(result.current.isLoading).toBe(false);
    });

    it('should handle network errors', async () => {
      (global.fetch as any).mockRejectedValueOnce(new Error('Network failed'));

      const { result } = renderHook(() => useMFASetup());

      await act(async () => {
        await result.current.initiate();
      });

      expect(result.current.step).toBe('error');
      expect(result.current.error).toBe('Network failed');
    });

    it('should set step to initiating', async () => {
      (global.fetch as any).mockImplementationOnce(() => new Promise(() => {}));

      const { result } = renderHook(() => useMFASetup());

      const promise = act(async () => {
        await result.current.initiate();
      });

      expect(result.current.step).toBe('initiating');

      vi.clearAllMocks();
      await promise;
    });

    it('should include credentials in request', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            setupToken: 'token',
            secret: 'secret',
            qrCode: 'qr',
            expiresAt: new Date().toISOString(),
          },
        }),
      });

      const { result } = renderHook(() => useMFASetup());

      await act(async () => {
        await result.current.initiate();
      });

      expect((global.fetch as any).mock.calls[0][1].credentials).toBe('include');
    });
  });

  describe('verifyCode', () => {
    beforeEach(async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            setupToken: 'token123',
            secret: 'secret123',
            qrCode: 'qrcode_data',
            expiresAt: new Date().toISOString(),
          },
        }),
      });

      const { result } = renderHook(() => useMFASetup());

      await act(async () => {
        await result.current.initiate();
      });
    });

    it('should verify code and get recovery codes', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            recoveryCodes: ['AAAA-1111', 'BBBB-2222'],
            setupToken: 'token123',
          },
        }),
      });

      const { result } = renderHook(() => useMFASetup());

      await act(async () => {
        await result.current.initiate();
      });

      await act(async () => {
        await result.current.verifyCode('123456');
      });

      expect(result.current.step).toBe('confirming');
      expect(result.current.recoveryCodes).toEqual(['AAAA-1111', 'BBBB-2222']);
      expect(result.current.error).toBeNull();
    });

    it('should handle invalid code', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: { message: 'Invalid code' } }),
      });

      const { result } = renderHook(() => useMFASetup());

      await act(async () => {
        await result.current.initiate();
      });

      await act(async () => {
        await result.current.verifyCode('000000');
      });

      expect(result.current.step).toBe('qr-ready'); // Back to previous step
      expect(result.current.error).toBeDefined();
    });

    it('should reject if no setup token', async () => {
      const { result } = renderHook(() => useMFASetup());

      await act(async () => {
        await result.current.verifyCode('123456');
      });

      expect(result.current.error).toBe('Setup token missing');
    });

    it('should set step to verifying', async () => {
      (global.fetch as any).mockImplementationOnce(() => new Promise(() => {}));

      const { result } = renderHook(() => useMFASetup());

      await act(async () => {
        await result.current.initiate();
      });

      const promise = act(async () => {
        await result.current.verifyCode('123456');
      });

      expect(result.current.step).toBe('verifying');

      vi.clearAllMocks();
      await promise;
    });
  });

  describe('confirm', () => {
    beforeEach(async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            setupToken: 'token123',
            secret: 'secret123',
            qrCode: 'qrcode_data',
            expiresAt: new Date().toISOString(),
          },
        }),
      });

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            recoveryCodes: ['AAAA-1111', 'BBBB-2222'],
            setupToken: 'token123',
          },
        }),
      });

      const { result } = renderHook(() => useMFASetup());

      await act(async () => {
        await result.current.initiate();
        await result.current.verifyCode('123456');
      });
    });

    it('should confirm MFA setup', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { message: 'MFA setup complete', mfaEnabled: true },
        }),
      });

      const { result } = renderHook(() => useMFASetup());

      await act(async () => {
        await result.current.initiate();
        await result.current.verifyCode('123456');
        await result.current.confirm();
      });

      expect(result.current.step).toBe('complete');
      expect(result.current.error).toBeNull();
    });

    it('should handle confirmation error', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        statusText: 'Server error',
      });

      const { result } = renderHook(() => useMFASetup());

      await act(async () => {
        await result.current.initiate();
        await result.current.verifyCode('123456');
        await result.current.confirm();
      });

      expect(result.current.error).toBeDefined();
    });

    it('should reject if no setup token', async () => {
      const { result } = renderHook(() => useMFASetup());

      await act(async () => {
        await result.current.confirm();
      });

      expect(result.current.error).toBe('Setup data missing');
    });

    it('should reject if no recovery codes', async () => {
      const { result } = renderHook(() => useMFASetup());

      await act(async () => {
        await result.current.initiate();
      });

      // Try to confirm without verifying code (no recovery codes)
      await act(async () => {
        await result.current.confirm();
      });

      expect(result.current.error).toBe('Setup data missing');
    });
  });

  describe('reset', () => {
    beforeEach(async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            setupToken: 'token123',
            secret: 'secret123',
            qrCode: 'qrcode_data',
            expiresAt: new Date().toISOString(),
          },
        }),
      });

      const { result } = renderHook(() => useMFASetup());

      await act(async () => {
        await result.current.initiate();
      });
    });

    it('should reset all state', () => {
      const { result } = renderHook(() => useMFASetup());

      act(() => {
        result.current.reset();
      });

      expect(result.current.step).toBe('idle');
      expect(result.current.setupToken).toBeNull();
      expect(result.current.secret).toBeNull();
      expect(result.current.qrCode).toBeNull();
      expect(result.current.recoveryCodes).toBeNull();
      expect(result.current.error).toBeNull();
      expect(result.current.isLoading).toBe(false);
    });
  });

  describe('flow integration', () => {
    it('should complete full MFA setup flow', async () => {
      // Step 1: Initiate
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            setupToken: 'token123',
            secret: 'secret123',
            qrCode: 'qrcode_data',
            expiresAt: new Date().toISOString(),
          },
        }),
      });

      // Step 2: Verify
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            recoveryCodes: ['AAAA-1111', 'BBBB-2222'],
            setupToken: 'token123',
          },
        }),
      });

      // Step 3: Confirm
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { message: 'MFA setup complete', mfaEnabled: true },
        }),
      });

      const { result } = renderHook(() => useMFASetup());

      // Initiate
      await act(async () => {
        await result.current.initiate();
      });

      expect(result.current.step).toBe('qr-ready');
      expect(result.current.setupToken).toBe('token123');

      // Verify code
      await act(async () => {
        await result.current.verifyCode('123456');
      });

      expect(result.current.step).toBe('confirming');
      expect(result.current.recoveryCodes).toHaveLength(2);

      // Confirm
      await act(async () => {
        await result.current.confirm();
      });

      expect(result.current.step).toBe('complete');
    });
  });

  describe('error handling edge cases', () => {
    it('should handle JSON parsing errors', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new Error('JSON parse error');
        },
      });

      const { result } = renderHook(() => useMFASetup());

      await act(async () => {
        await result.current.initiate();
      });

      expect(result.current.error).toBeDefined();
      expect(result.current.step).toBe('error');
    });

    it('should handle missing data field in response', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: null }),
      });

      const { result } = renderHook(() => useMFASetup());

      await act(async () => {
        await result.current.initiate();
      });

      // Should handle gracefully
      expect(result.current.isLoading).toBe(false);
    });
  });
});
