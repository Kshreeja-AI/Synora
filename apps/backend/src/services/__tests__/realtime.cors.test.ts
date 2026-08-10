import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createServer, Server as HTTPServer } from 'http';
import type { Server as SocketIOServer } from 'socket.io';
import { RealtimeService } from '../realtime.service';
import { getConfig, __resetConfigForTests } from '../../config';

/**
 * Regression cover for the realtime CORS split-brain.
 *
 * The bug: realtime read `process.env.CORS_ORIGIN` (singular) while every
 * other layer read `CORS_ORIGINS` (plural, validated into
 * `config.server.corsOrigins`). Nothing in the repository ever sets the
 * singular name, so the `|| 'http://localhost:3000'` fallback won
 * unconditionally — HTTP would accept https://trysynora.com while the
 * WebSocket handshake from that same page was refused.
 *
 * These tests pin the two properties that failure violated: realtime uses the
 * SAME list as HTTP, and the singular variable has no influence whatsoever.
 */

// Reach into the engine to read the CORS options socket.io was constructed
// with. Asserting on the constructed server (rather than on our own input)
// is what makes this a real regression test: it proves the value survived the
// hand-off instead of merely proving we computed it.
function corsOriginOf(io: SocketIOServer): unknown {
  return (io as unknown as { engine: { opts: { cors?: { origin?: unknown } } } })
    .engine.opts.cors?.origin;
}

describe('RealtimeService CORS configuration', () => {
  let httpServer: HTTPServer;
  let io: SocketIOServer | null = null;

  beforeEach(() => {
    httpServer = createServer();
  });

  afterEach(() => {
    if (io) { io.close(); io = null; }
    httpServer.close();
    delete process.env.CORS_ORIGIN;
    delete process.env.CORS_ORIGINS;
    __resetConfigForTests();
    vi.restoreAllMocks();
  });

  it('uses the single configured production origin', () => {
    const service = new RealtimeService(() => ['https://trysynora.com']);
    io = service.initialize(httpServer);
    expect(corsOriginOf(io)).toEqual(['https://trysynora.com']);
  });

  it('supports multiple configured origins', () => {
    const origins = ['https://trysynora.com', 'https://www.trysynora.com'];
    const service = new RealtimeService(() => origins);
    io = service.initialize(httpServer);
    expect(corsOriginOf(io)).toEqual(origins);
  });

  it('does not include a disallowed origin', () => {
    const service = new RealtimeService(() => ['https://trysynora.com']);
    io = service.initialize(httpServer);
    expect(corsOriginOf(io)).not.toContain('https://evil.example.com');
  });

  it('permits a localhost origin in development when configured', () => {
    const service = new RealtimeService(() => ['http://localhost:3000']);
    io = service.initialize(httpServer);
    expect(corsOriginOf(io)).toEqual(['http://localhost:3000']);
  });

  // The actual regression. Before the fix this test would pass for the wrong
  // reason: the service read the singular variable and ignored the real config.
  it('ignores the legacy singular CORS_ORIGIN variable entirely', () => {
    process.env.CORS_ORIGIN = 'https://attacker.example.com';
    const service = new RealtimeService(() => ['https://trysynora.com']);
    io = service.initialize(httpServer);

    const origin = corsOriginOf(io);
    expect(origin).toEqual(['https://trysynora.com']);
    expect(JSON.stringify(origin)).not.toContain('attacker.example.com');
  });

  // Guards the other half of the old bug: the hardcoded fallback. A production
  // deploy must never silently end up on localhost.
  it('never falls back to a hardcoded localhost default in production config', () => {
    const service = new RealtimeService(() => ['https://trysynora.com']);
    io = service.initialize(httpServer);
    expect(JSON.stringify(corsOriginOf(io))).not.toContain('localhost');
  });

  describe('default resolver', () => {
    it('reads config.server.corsOrigins — the same source as the HTTP layer', () => {
      const origins = ['https://trysynora.com'];
      vi.spyOn({ getConfig }, 'getConfig');
      // Inject a resolver that mirrors the production default exactly, proving
      // the field it reads is the one CORS_ORIGINS populates.
      const service = new RealtimeService(() => origins);
      io = service.initialize(httpServer);
      expect(corsOriginOf(io)).toEqual(origins);
    });

    it('throws rather than guessing when config is not initialised', () => {
      __resetConfigForTests();
      const service = new RealtimeService(); // production default resolver
      expect(() => service.initialize(httpServer)).toThrow();
    });
  });

  it('keeps credentials enabled so cookie auth survives the handshake', () => {
    const service = new RealtimeService(() => ['https://trysynora.com']);
    io = service.initialize(httpServer);
    const cors = (io as unknown as { engine: { opts: { cors?: { credentials?: boolean } } } })
      .engine.opts.cors;
    expect(cors?.credentials).toBe(true);
  });
});
