import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, Server as HTTPServer } from 'http';
import type { AddressInfo } from 'net';
import jwt from 'jsonwebtoken';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { prisma } from '@synora/database';
import { RealtimeService } from '../realtime.service';
import { initConfig } from '../../config';

/**
 * Realtime handshake + room-authorization integration tests, run
 * against a real socket.io server on an ephemeral port with real
 * socket.io-client connections.
 *
 * The two security properties pinned here are the reason this file
 * exists:
 * - the handshake accepts the accessToken via Cookie header (browsers
 *   cannot read the httpOnly cookie into auth.token) and rejects
 *   invalid/missing credentials;
 * - join:conversation refuses rooms the user has no workspace
 *   membership for — without this, any authenticated user could
 *   listen to any conversation's presence/typing/message broadcasts.
 */
describe('RealtimeService integration', () => {
  let service: RealtimeService;
  let httpServer: HTTPServer;
  let baseUrl: string;
  let userId: string;
  let workspaceId: string;
  let conversationId: string;
  let foreignConversationId: string;
  let token: string;
  const clients: ClientSocket[] = [];

  const secret = process.env.JWT_SECRET || 'test-secret';

  beforeAll(async () => {
    // See realtime.service.test.ts: config is initialised before the
    // realtime layer in production, and the service now depends on it.
    await initConfig();
    service = new RealtimeService();
    httpServer = createServer();
    service.initialize(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    baseUrl = `http://localhost:${(httpServer.address() as AddressInfo).port}`;

    const user = await prisma.user.create({
      data: { email: `rt-${Date.now()}@example.com`, name: 'RT User' },
    });
    userId = user.id;

    const workspace = await prisma.workspace.create({
      data: { name: 'RT WS', slug: `rt-ws-${Date.now()}` },
    });
    workspaceId = workspace.id;
    await prisma.workspaceMember.create({ data: { userId, workspaceId, role: 'OWNER' } });

    const conversation = await prisma.conversation.create({
      data: { workspaceId, title: 'RT Chat', provider: 'anthropic', model: 'claude-sonnet-5' },
    });
    conversationId = conversation.id;

    // A conversation in a workspace the user is NOT a member of.
    const foreignWorkspace = await prisma.workspace.create({
      data: { name: 'Foreign WS', slug: `rt-foreign-${Date.now()}` },
    });
    const foreign = await prisma.conversation.create({
      data: {
        workspaceId: foreignWorkspace.id,
        title: 'Foreign Chat',
        provider: 'anthropic',
        model: 'claude-sonnet-5',
      },
    });
    foreignConversationId = foreign.id;

    token = jwt.sign({ userId }, secret, { expiresIn: '1h' });
  });

  afterAll(async () => {
    for (const client of clients) client.disconnect();
    service.getIO()?.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));

    await prisma.conversation.deleteMany({
      where: { id: { in: [conversationId, foreignConversationId] } },
    });
    await prisma.workspaceMember.deleteMany({ where: { userId } });
    await prisma.workspace.deleteMany({ where: { slug: { startsWith: 'rt-' } } });
    await prisma.user.delete({ where: { id: userId } });
  });

  const connect = (options: Parameters<typeof ioClient>[1]): Promise<ClientSocket> =>
    new Promise((resolve, reject) => {
      const client = ioClient(baseUrl, { transports: ['websocket'], ...options });
      clients.push(client);
      client.on('connect', () => resolve(client));
      client.on('connect_error', (err) => reject(err));
    });

  it('accepts a bearer token via auth.token', async () => {
    const client = await connect({ auth: { token } });
    expect(client.connected).toBe(true);
    client.disconnect();
  });

  it('accepts the accessToken cookie on the handshake request', async () => {
    const client = await connect({
      extraHeaders: { cookie: `accessToken=${token}` },
    });
    expect(client.connected).toBe(true);
    client.disconnect();
  });

  it('rejects a missing credential', async () => {
    await expect(connect({})).rejects.toThrow(/Missing authentication token/);
  });

  it('rejects an invalid token', async () => {
    await expect(connect({ auth: { token: 'not-a-jwt' } })).rejects.toThrow(/Invalid token/);
  });

  it('joins a member conversation and broadcasts presence', async () => {
    const client = await connect({ auth: { token } });

    const presence = await new Promise<{ userId: string; action: string }>((resolve) => {
      client.on('presence', resolve);
      client.emit('join:conversation', { conversationId });
    });

    expect(presence.userId).toBe(userId);
    expect(presence.action).toBe('joined');
    expect(service.getPresence(conversationId)).toContain(userId);
    client.disconnect();
  });

  it('refuses to join a conversation outside the user workspaces', async () => {
    const client = await connect({ auth: { token } });

    const rejection = await new Promise<{ conversationId: string; reason: string }>(
      (resolve) => {
        client.on('error:join', resolve);
        client.emit('join:conversation', { conversationId: foreignConversationId });
      }
    );

    expect(rejection.conversationId).toBe(foreignConversationId);
    expect(service.getPresence(foreignConversationId)).toEqual([]);
    client.disconnect();
  });

  it('gives the same rejection for a nonexistent conversation (no probing)', async () => {
    const client = await connect({ auth: { token } });

    const rejection = await new Promise<{ reason: string }>((resolve) => {
      client.on('error:join', resolve);
      client.emit('join:conversation', { conversationId: 'does-not-exist' });
    });

    expect(rejection.reason).toBe('Conversation not found');
    client.disconnect();
  });
});
