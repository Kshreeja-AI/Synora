/**
 * The realtime layer's CORS origins must be the SAME list as HTTP's.
 *
 * This pins a bug that only ever appeared in production, only for
 * browsers, and only after everything else looked healthy — the worst
 * shape a configuration bug can take.
 *
 * `realtime.service.ts` read `process.env.CORS_ORIGIN` (singular), a name
 * the config layer never defines. Production therefore always fell through
 * to the `http://localhost:3000` default, so WebSocket handshakes from the
 * real domain were rejected while ordinary HTTP requests — which use the
 * canonical `CORS_ORIGINS` list — succeeded. Presence and collaboration
 * would simply never connect, with no error anywhere in the API logs.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { createServer } from 'http';
import { RealtimeService } from '../realtime.service';
import { initConfig, __resetConfigForTests } from '../../config';

/**
 * The origins socket.io ACTUALLY received — read back off the live server
 * rather than recomputed from config.
 *
 * The first version of these tests asserted `getConfig().server.corsOrigins`
 * and would have passed with the bug still present, because it never touched
 * the service. Reading `engine.opts.cors` is what makes them behavioural.
 */
function originsGivenToSocketIO(): unknown {
  const service = new RealtimeService();
  const io = service.initialize(createServer());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cors = (io as any).engine?.opts?.cors;
  io.close();
  return cors?.origin;
}

const PROD_ORIGINS = 'https://trysynora.com,https://www.trysynora.com';

async function loadConfigWith(env: Record<string, string | undefined>): Promise<void> {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  __resetConfigForTests();
  await initConfig();
}

describe('realtime CORS uses the canonical origin list', () => {
  afterEach(async () => {
    delete process.env.CORS_ORIGINS;
    delete process.env.CORS_ORIGIN;
    __resetConfigForTests();
    await initConfig();
    vi.restoreAllMocks();
  });

  it('serves the production origins to socket.io, not a localhost default', async () => {
    await loadConfigWith({ CORS_ORIGINS: PROD_ORIGINS, CORS_ORIGIN: undefined });

    expect(originsGivenToSocketIO()).toEqual([
      'https://trysynora.com',
      'https://www.trysynora.com',
    ]);
  });

  it('ignores the legacy singular CORS_ORIGIN entirely', async () => {
    // The old name must not quietly keep working: two competing config
    // names is exactly how the two layers drifted apart in the first
    // place, and a fallback would let the drift return unnoticed.
    await loadConfigWith({
      CORS_ORIGINS: PROD_ORIGINS,
      CORS_ORIGIN: 'https://an-attacker-controlled-host.example',
    });

    const origins = originsGivenToSocketIO();
    expect(JSON.stringify(origins)).not.toMatch(/attacker-controlled/);
    expect(origins).toEqual(['https://trysynora.com', 'https://www.trysynora.com']);
  });

  it('does not read the realtime origin from process.env directly', async () => {
    // Structural guard. A future edit that reaches for process.env again
    // would reintroduce a second source of truth, and no behavioural test
    // would necessarily catch it before production.
    const { readFileSync } = await import('node:fs');
    const { resolve, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const src = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../realtime.service.ts'),
      'utf8',
    );
    const corsBlock = src.slice(src.indexOf('cors: {'), src.indexOf('transports:'));
    // Comments are stripped first: the block deliberately DOCUMENTS the old
    // `process.env` bug, and a test that banned the explanation along with
    // the code would push the next person to delete the warning instead of
    // heeding it. Only executable lines are checked.
    const code = corsBlock
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
    expect(code).toContain('getConfig()');
    expect(code).not.toMatch(/process\.env/);
  });
});
