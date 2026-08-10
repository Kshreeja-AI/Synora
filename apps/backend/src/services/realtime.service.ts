import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HTTPServer } from 'http';
import jwt from 'jsonwebtoken';
import { prisma } from '@synora/database';
import { logger } from '../utils/logger';
import { secretsManager } from '../secrets';
import { getConfig } from '../config';

interface PresenceEvent {
  userId: string;
  conversationId: string;
  action: 'joined' | 'left' | 'typing';
  timestamp: number;
}

/**
 * Minimal single-key cookie extraction for the handshake. Browser
 * clients cannot read the httpOnly accessToken cookie to place it in
 * `auth.token` (P0-002) — the browser attaches it to the handshake
 * request itself, so we read it from the Cookie header. Not a general
 * cookie parser on purpose: one key, no decoding surprises beyond
 * standard percent-encoding.
 */
function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

export class RealtimeService {
  private io: SocketIOServer | null = null;
  private presence: Map<string, PresenceEvent> = new Map();
  private subscriptions: Map<string, Set<string>> = new Map();

  /**
   * Realtime reads the SAME validated origin list as the HTTP layer
   * (`config.server.corsOrigins`, sourced from CORS_ORIGINS).
   *
   * It previously read `process.env.CORS_ORIGIN` — a singular name nothing in
   * the project ever sets. That did not merely disagree with the HTTP config;
   * it meant the `||` fallback ALWAYS won, pinning WebSocket origins to
   * http://localhost:3000 in every environment. In production the browser
   * origin is https://trysynora.com, so every realtime handshake would have
   * been rejected while HTTP requests succeeded — the kind of split-brain that
   * looks like a broken socket server rather than a config typo.
   *
   * The resolver is injected so tests can state an origin list explicitly.
   * The default deliberately calls getConfig(), which THROWS when config has
   * not been initialised: a realtime server that cannot learn its allowed
   * origins must fail loudly at boot, never quietly serve a guessed default.
   */
  constructor(
    private readonly resolveCorsOrigins: () => string[] = () => getConfig().server.corsOrigins
  ) {}

  initialize(httpServer: HTTPServer): SocketIOServer {
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: this.resolveCorsOrigins(),
        methods: ['GET', 'POST'],
        credentials: true,
      },
      transports: ['websocket', 'polling'],
      pingInterval: 25000,
      pingTimeout: 20000,
    });

    this.setupMiddleware();
    this.setupEventHandlers();

    logger.info('WebSocket server initialized with socket.io');
    return this.io;
  }

  private setupMiddleware(): void {
    if (!this.io) return;

    this.io.use(async (socket, next) => {
      try {
        // Two accepted credential channels, same JWT either way:
        // - `auth.token`: programmatic clients that hold a bearer token.
        // - accessToken cookie: browsers, which cannot read the
        //   httpOnly cookie into auth.token but do attach it to the
        //   handshake request (withCredentials).
        const token =
          socket.handshake.auth.token ??
          readCookie(socket.handshake.headers.cookie, 'accessToken');
        if (!token) {
          return next(new Error('Missing authentication token'));
        }

        const userId = await this.validateToken(token);
        socket.data.userId = userId;
        next();
      } catch (error) {
        next(error instanceof Error ? error : new Error('Authentication failed'));
      }
    });
  }

  private setupEventHandlers(): void {
    if (!this.io) return;

    this.io.on('connection', (socket: Socket) => {
      const userId = socket.data.userId as string;
      logger.info('WebSocket client connected', { userId, socketId: socket.id });

      socket.on('join:conversation', (data) => {
        void this.handleJoinConversation(socket, userId, data);
      });

      socket.on('leave:conversation', (data) => {
        this.handleLeaveConversation(socket, userId, data);
      });

      socket.on('typing:start', (data) => {
        this.handleTypingStart(socket, userId, data);
      });

      socket.on('typing:stop', (data) => {
        this.handleTypingStop(socket, userId, data);
      });

      // Deliberately NO client-emitted stream relay: message streams
      // originate exclusively from server-side generation (SSE +
      // broadcastMessage below). A client-triggered relay would let
      // any room member broadcast fabricated model output to everyone.

      socket.on('disconnect', () => {
        this.handleDisconnect(socket, userId);
      });

      socket.on('error', (error) => {
        logger.error('WebSocket error', { userId, socketId: socket.id, error });
      });
    });
  }

  private async handleJoinConversation(
    socket: Socket,
    userId: string,
    data: { conversationId: string }
  ): Promise<void> {
    const { conversationId } = data;
    if (typeof conversationId !== 'string' || conversationId.length === 0) {
      socket.emit('error:join', { conversationId, reason: 'Invalid conversation id' });
      return;
    }
    const room = `conversation:${conversationId}`;

    // Authorization gate: a room carries presence, typing, and message
    // broadcasts — joining must require the same workspace membership
    // as reading the conversation over HTTP. Unauthorized and
    // nonexistent conversations get the same response so a socket
    // can't be used to probe for conversation ids.
    try {
      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { workspaceId: true },
      });
      const membership = conversation
        ? await prisma.workspaceMember.findUnique({
            where: { userId_workspaceId: { userId, workspaceId: conversation.workspaceId } },
            select: { id: true },
          })
        : null;

      if (!membership) {
        logger.warn('Rejected conversation join', { userId, conversationId });
        socket.emit('error:join', { conversationId, reason: 'Conversation not found' });
        return;
      }
    } catch (error) {
      logger.error('Conversation join check failed', {
        userId,
        conversationId,
        error: error instanceof Error ? error.message : String(error),
      });
      socket.emit('error:join', { conversationId, reason: 'Join failed' });
      return;
    }

    socket.join(room);

    const presenceKey = `${conversationId}:${userId}`;
    this.presence.set(presenceKey, {
      userId,
      conversationId,
      action: 'joined',
      timestamp: Date.now(),
    });

    if (!this.subscriptions.has(conversationId)) {
      this.subscriptions.set(conversationId, new Set());
    }
    this.subscriptions.get(conversationId)!.add(userId);

    this.io?.to(room).emit('presence', {
      userId,
      action: 'joined',
      timestamp: Date.now(),
    });

    logger.info('User joined conversation', { userId, conversationId });
  }

  private handleLeaveConversation(socket: Socket, userId: string, data: { conversationId: string }): void {
    const { conversationId } = data;
    const room = `conversation:${conversationId}`;

    socket.leave(room);

    const presenceKey = `${conversationId}:${userId}`;
    this.presence.delete(presenceKey);

    const subscribers = this.subscriptions.get(conversationId);
    if (subscribers) {
      subscribers.delete(userId);
    }

    this.io?.to(room).emit('presence', {
      userId,
      action: 'left',
      timestamp: Date.now(),
    });

    logger.info('User left conversation', { userId, conversationId });
  }

  private handleTypingStart(socket: Socket, userId: string, data: { conversationId: string }): void {
    const { conversationId } = data;
    const room = `conversation:${conversationId}`;

    this.io?.to(room).emit('typing', {
      userId,
      action: 'start',
      timestamp: Date.now(),
    });
  }

  private handleTypingStop(socket: Socket, userId: string, data: { conversationId: string }): void {
    const { conversationId } = data;
    const room = `conversation:${conversationId}`;

    this.io?.to(room).emit('typing', {
      userId,
      action: 'stop',
      timestamp: Date.now(),
    });
  }

  private handleDisconnect(socket: Socket, userId: string): void {
    this.presence.forEach((event, key) => {
      if (event.userId === userId) {
        const conversationId = key.split(':')[0];
        const room = `conversation:${conversationId}`;

        this.io?.to(room).emit('presence', {
          userId,
          action: 'left',
          timestamp: Date.now(),
        });

        this.presence.delete(key);

        const subscribers = this.subscriptions.get(conversationId);
        if (subscribers) {
          subscribers.delete(userId);
        }
      }
    });

    logger.info('WebSocket client disconnected', { userId, socketId: socket.id });
  }

  async broadcastPresence(conversationId: string): Promise<void> {
    const room = `conversation:${conversationId}`;
    const subscribers = this.subscriptions.get(conversationId) || new Set();
    const presenceList = Array.from(subscribers).map((userId) => ({
      userId,
      timestamp: Date.now(),
    }));

    this.io?.to(room).emit('presence:list', { users: presenceList });
  }

  async broadcastMessage(conversationId: string, message: unknown): Promise<void> {
    const room = `conversation:${conversationId}`;
    this.io?.to(room).emit('message:new', message);
  }

  async broadcastTyping(conversationId: string, userId: string, isTyping: boolean): Promise<void> {
    const room = `conversation:${conversationId}`;
    this.io?.to(room).emit('typing', {
      userId,
      action: isTyping ? 'start' : 'stop',
      timestamp: Date.now(),
    });
  }

  private async validateToken(token: string): Promise<string> {
    try {
      const jwtSecret = await secretsManager.get('JWT_SECRET', 'backend:realtime-service');
      const decoded = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] }) as {
        userId?: string;
        sub?: string;
      };
      const userId = decoded.userId || decoded.sub;
      if (!userId) {
        throw new Error('Token missing userId claim');
      }
      return userId;
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError) {
        throw new Error(`Invalid token: ${error.message}`);
      }
      throw error instanceof Error ? error : new Error('Failed to validate token');
    }
  }

  getIO(): SocketIOServer | null {
    return this.io;
  }

  getPresence(conversationId: string): string[] {
    return Array.from(this.subscriptions.get(conversationId) || new Set());
  }
}

export const realtimeService = new RealtimeService();
