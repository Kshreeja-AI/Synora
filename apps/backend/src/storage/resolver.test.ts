import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveStorageProvider } from './resolver';
import { getConfig } from '../config';

vi.mock('../config', () => ({ getConfig: vi.fn() }));

describe('resolveStorageProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves the local provider by default', async () => {
    (getConfig as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ storage: { provider: 'local' } });
    const provider = await resolveStorageProvider();
    expect(provider.id).toBe('local');
  });

  it('throws for an unknown provider id', async () => {
    (getConfig as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ storage: { provider: 'orbital-cache' } });
    await expect(resolveStorageProvider()).rejects.toThrow(/not a known provider/);
  });
});
