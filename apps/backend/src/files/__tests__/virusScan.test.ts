import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createServer, type Server, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import { ClamAVScanProvider, clamavScanDescriptor } from '../providers/clamav.provider';
import { MockVirusScanProvider } from '../virusScan';
import { resolveVirusScanProvider, VIRUS_SCAN_PROVIDER_REGISTRY } from '../virusScanRegistry';
import { getConfig } from '../../config';

/**
 * The property under test: the scanner never reports "clean" unless a real
 * scan concluded clean. The old stub returned {clean:true} unconditionally;
 * these tests pin the three honest outcomes (clean / infected / error) and
 * that "no scanner configured" resolves to null rather than a fake pass.
 */

vi.mock('../../config', () => ({ getConfig: vi.fn() }));

/**
 * Minimal fake clamd that speaks the zINSTREAM handshake: it drains the
 * length-prefixed chunks until the zero-length terminator, then replies
 * with a scripted line. Exercises the real socket protocol in the provider.
 */
function fakeClamd(reply: string): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((socket: Socket) => {
      let sawTerminator = false;
      socket.on('data', (data: Buffer) => {
        // The 4-byte zero terminator ends the stream in this simplified fake.
        if (data.length >= 4 && data.subarray(-4).equals(Buffer.from([0, 0, 0, 0]))) {
          sawTerminator = true;
        }
        if (sawTerminator) {
          socket.write(reply);
          socket.end();
        }
      });
    });
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, port: (server.address() as AddressInfo).port })
    );
  });
}

describe('ClamAVScanProvider', () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((r) => server!.close(() => r()));
      server = undefined;
    }
  });

  it('reports clean on a stream: OK reply', async () => {
    const clamd = await fakeClamd('stream: OK\0');
    server = clamd.server;
    const provider = new ClamAVScanProvider('127.0.0.1', clamd.port, 5000, 1_000_000);

    const outcome = await provider.scan(Buffer.from('harmless content'), 'notes.txt');

    expect(outcome).toEqual({ status: 'clean' });
  });

  it('reports infected with the signature on a FOUND reply', async () => {
    const clamd = await fakeClamd('stream: Eicar-Test-Signature FOUND\0');
    server = clamd.server;
    const provider = new ClamAVScanProvider('127.0.0.1', clamd.port, 5000, 1_000_000);

    const outcome = await provider.scan(Buffer.from('x5O!P%...'), 'evil.exe');

    expect(outcome).toEqual({ status: 'infected', signature: 'Eicar-Test-Signature' });
  });

  it('reports error (never clean) on an unexpected reply', async () => {
    const clamd = await fakeClamd('INSTREAM size limit exceeded ERROR\0');
    server = clamd.server;
    const provider = new ClamAVScanProvider('127.0.0.1', clamd.port, 5000, 1_000_000);

    const outcome = await provider.scan(Buffer.from('data'), 'file.bin');

    expect(outcome.status).toBe('error');
  });

  it('reports error (never clean) when clamd is unreachable', async () => {
    // Port 1 is not listening; connection is refused.
    const provider = new ClamAVScanProvider('127.0.0.1', 1, 2000, 1_000_000);

    const outcome = await provider.scan(Buffer.from('data'), 'file.bin');

    expect(outcome.status).toBe('error');
  });

  it('refuses to pass an oversized file as clean', async () => {
    const provider = new ClamAVScanProvider('127.0.0.1', 3310, 5000, 10);

    const outcome = await provider.scan(Buffer.from('this is definitely more than ten bytes'), 'big.bin');

    expect(outcome.status).toBe('error');
    if (outcome.status === 'error') {
      expect(outcome.error).toContain('scan limit');
    }
  });
});

describe('MockVirusScanProvider (test-only)', () => {
  it('flags the EICAR signature and passes everything else', async () => {
    const provider = new MockVirusScanProvider();

    expect(await provider.scan(Buffer.from('clean file'), 'a.txt')).toEqual({ status: 'clean' });
    const infected = await provider.scan(Buffer.from('contains EICAR marker'), 'b.txt');
    expect(infected.status).toBe('infected');
  });
});

describe('resolveVirusScanProvider', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null when no scanner is configured (honest "unscanned", not a fake pass)', async () => {
    vi.mocked(getConfig).mockReturnValue({
      virusScan: { provider: 'none', clamavHost: undefined, clamavPort: 3310 },
    } as never);

    expect(await resolveVirusScanProvider()).toBeNull();
  });

  it('returns null when clamav is selected but no host is set', async () => {
    vi.mocked(getConfig).mockReturnValue({
      virusScan: { provider: 'clamav', clamavHost: undefined, clamavPort: 3310 },
    } as never);

    expect(await resolveVirusScanProvider()).toBeNull();
  });

  it('resolves the ClamAV provider once a host is configured', async () => {
    vi.mocked(getConfig).mockReturnValue({
      virusScan: {
        provider: 'clamav',
        clamavHost: 'clamav.internal',
        clamavPort: 3310,
        clamavTimeoutMs: 30000,
        maxScanBytes: 1_000_000,
      },
    } as never);

    const provider = await resolveVirusScanProvider();
    expect(provider).toBeInstanceOf(ClamAVScanProvider);
  });

  it('exposes ClamAV as the only registered provider', () => {
    expect(VIRUS_SCAN_PROVIDER_REGISTRY.map((d) => d.id)).toEqual(['clamav']);
    expect(clamavScanDescriptor.id).toBe('clamav');
  });
});
