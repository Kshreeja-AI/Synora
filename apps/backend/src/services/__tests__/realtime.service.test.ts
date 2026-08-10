import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, Server as HTTPServer } from 'http';
import { RealtimeService } from '../realtime.service';

describe('RealtimeService', () => {
  let realtimeService: RealtimeService;
  let httpServer: HTTPServer;

  beforeEach(() => {
    // Origins injected explicitly: these tests exercise presence and lifecycle,
    // not CORS, and should not depend on global config being initialised.
    realtimeService = new RealtimeService(() => ['http://localhost:3000']);
    httpServer = createServer();
  });

  afterEach(() => {
    const io = realtimeService.getIO();
    if (io) io.close();
    httpServer.close();
  });

  describe('initialize', () => {
    it('should initialize socket.io server', () => {
      const io = realtimeService.initialize(httpServer);
      expect(io).toBeDefined();
      expect(realtimeService.getIO()).toBe(io);
    });
  });

  describe('presence tracking', () => {
    it('should return empty presence for new conversation before initialization', () => {
      const presence = realtimeService.getPresence('test-conv-1');
      expect(presence).toEqual([]);
    });

    it('should return empty presence for new conversation after initialization', () => {
      realtimeService.initialize(httpServer);
      const presence = realtimeService.getPresence('unseen-conv');
      expect(presence).toEqual([]);
    });
  });

  describe('broadcast methods', () => {
    it('broadcastPresence resolves without throwing', async () => {
      realtimeService.initialize(httpServer);
      await expect(realtimeService.broadcastPresence('conv-1')).resolves.toBeUndefined();
    });

    it('broadcastMessage resolves without throwing', async () => {
      realtimeService.initialize(httpServer);
      await expect(
        realtimeService.broadcastMessage('conv-1', { id: 'm1', content: 'hi', role: 'USER' })
      ).resolves.toBeUndefined();
    });

    it('broadcastTyping resolves without throwing', async () => {
      realtimeService.initialize(httpServer);
      await expect(realtimeService.broadcastTyping('conv-1', 'user-1', true)).resolves.toBeUndefined();
      await expect(realtimeService.broadcastTyping('conv-1', 'user-1', false)).resolves.toBeUndefined();
    });

    it('broadcast helpers are no-ops before initialization', async () => {
      await expect(realtimeService.broadcastPresence('conv-x')).resolves.toBeUndefined();
      await expect(realtimeService.broadcastMessage('conv-x', {})).resolves.toBeUndefined();
      await expect(realtimeService.broadcastTyping('conv-x', 'u', true)).resolves.toBeUndefined();
    });
  });
});
