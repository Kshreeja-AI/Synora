import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveMailTransport } from './resolver';
import { MailTransportError } from './types';
import { getConfig } from '../config';

vi.mock('../config', () => ({
  getConfig: vi.fn(),
}));

describe('resolveMailTransport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves the console transport by default', async () => {
    (getConfig as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      mail: { transport: 'console' },
    });

    const transport = await resolveMailTransport();
    expect(transport.id).toBe('console');
  });

  it('throws for an unknown transport id', async () => {
    (getConfig as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      mail: { transport: 'carrier-pigeon' },
    });

    await expect(resolveMailTransport()).rejects.toThrow(/not a known transport/);
  });

  it('throws a MailTransportError when smtp is selected but unconfigured', async () => {
    (getConfig as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      mail: { transport: 'smtp', smtpHost: undefined },
    });

    await expect(resolveMailTransport()).rejects.toThrow(MailTransportError);
  });
});
