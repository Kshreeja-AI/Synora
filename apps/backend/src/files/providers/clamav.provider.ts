import { connect, type Socket } from 'node:net';
import { getConfig } from '../../config';
import { logger } from '../../utils/logger';
import type { ScanOutcome, VirusScanProvider, VirusScanProviderDescriptor } from '../types';

/**
 * ClamAV scanner over the clamd network protocol.
 *
 * Uses the `zINSTREAM` command: the file bytes are streamed to clamd in
 * length-prefixed chunks and clamd replies with either `stream: OK` or
 * `stream: <signature> FOUND`. This is the standard, production way to
 * scan without giving clamd filesystem access to the upload — it works
 * identically against a local clamd, a sidecar container, or a managed
 * clamd service, selected entirely by host/port config.
 *
 * clamd has no authentication of its own (it is expected to sit on a
 * private network), so there is no secret here — only a reachable host.
 */

const CHUNK_SIZE = 64 * 1024;

export class ClamAVScanProvider implements VirusScanProvider {
  readonly id = 'clamav';

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly timeoutMs: number,
    private readonly maxScanBytes: number
  ) {}

  async scan(buffer: Buffer, fileName: string): Promise<ScanOutcome> {
    if (buffer.length > this.maxScanBytes) {
      // Never silently pass an unscanned oversized file as clean.
      return {
        status: 'error',
        error: `File exceeds the ${this.maxScanBytes}-byte scan limit and was not scanned`,
      };
    }

    try {
      const reply = await this.streamToClamd(buffer);
      return this.interpret(reply, fileName);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[VirusScan] clamd scan failed', { fileName, error: message });
      return { status: 'error', error: `Virus scan failed: ${message}` };
    }
  }

  private interpret(reply: string, fileName: string): ScanOutcome {
    const trimmed = reply.trim();
    if (trimmed.endsWith('OK')) {
      return { status: 'clean' };
    }
    const found = trimmed.match(/stream:\s+(.+)\s+FOUND$/);
    if (found) {
      logger.warn('[VirusScan] Malware signature detected', { fileName, signature: found[1] });
      return { status: 'infected', signature: found[1] };
    }
    // Any other reply (e.g. an ERROR line) is treated as an inconclusive
    // scan, never as clean.
    return { status: 'error', error: `Unexpected clamd reply: ${trimmed}` };
  }

  private streamToClamd(buffer: Buffer): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const socket: Socket = connect({ host: this.host, port: this.port });
      const chunks: Buffer[] = [];
      let settled = false;

      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        fn();
      };

      const timer = setTimeout(
        () => finish(() => reject(new Error(`clamd did not respond within ${this.timeoutMs}ms`))),
        this.timeoutMs
      );

      socket.on('connect', () => {
        socket.write('zINSTREAM\0');
        for (let offset = 0; offset < buffer.length; offset += CHUNK_SIZE) {
          const slice = buffer.subarray(offset, offset + CHUNK_SIZE);
          const size = Buffer.alloc(4);
          size.writeUInt32BE(slice.length, 0);
          socket.write(size);
          socket.write(slice);
        }
        // Zero-length chunk terminates the stream.
        socket.write(Buffer.from([0, 0, 0, 0]));
      });

      socket.on('data', (data: Buffer) => chunks.push(data));
      socket.on('end', () =>
        finish(() => resolve(Buffer.concat(chunks).toString('utf8').replace(/\0/g, '')))
      );
      socket.on('error', (error) => finish(() => reject(error)));
    });
  }
}

export const clamavScanDescriptor: VirusScanProviderDescriptor = {
  id: 'clamav',
  displayName: 'ClamAV (clamd)',
  async isConfigured() {
    const cfg = getConfig().virusScan;
    return cfg.provider === 'clamav' && typeof cfg.clamavHost === 'string' && cfg.clamavHost.length > 0;
  },
  async create() {
    const cfg = getConfig().virusScan;
    if (!cfg.clamavHost) {
      throw new Error('ClamAV provider selected but VIRUS_SCAN_CLAMAV_HOST is not set');
    }
    return new ClamAVScanProvider(cfg.clamavHost, cfg.clamavPort, cfg.clamavTimeoutMs, cfg.maxScanBytes);
  },
};
