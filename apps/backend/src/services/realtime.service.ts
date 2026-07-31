import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HTTPServer } from 'http';
import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger';
import { secretsManager } from '../secrets';

interface PresenceEvent {
  userId: string;
  conversationId: string;
  action: 'joined' | 'left' | 'typing';
  timestamp: number;
}

interface StreamEvent {
  conversationId: string;
  messageId: string;
  type: 'token' | 'done' | 'error';
  data: string | Record<string, unknown>;
}

export class RealtimeService {
  private io: SocketIOServer | null = null;
  private presence: Map<string, PresenceEvent> = new Map();
  private subscriptions: Map<string, Set<string>> = new Map();

  initialize(httpServer: HTTPServer): SocketIOServer {
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
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
        const token = socket.handshake.auth.token;
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
        this.handleJoinConversation(socket, userId, data);
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

      socket.on('message:stream', (data) => {
        this.handleMessageStream(socket, userId, data);
      });

      socket.on('disconnect', () => {
        this.handleDisconnect(socket, userId);
      });

      socket.on('error', (error) => {
        logger.error('WebSocket error', { userId, socketId: socket.id, error });
      });
    });
  }

  private handleJoinConversation(socket: Socket, userId: string, data: { conversationId: string }): void {
    const { conversationId } = data;
    const room = `conversation:${conversationId}`;

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

  private handleMessageStream(socket: Socket, userId: string, data: StreamEvent): void {
    const room = `conversation:${data.conversationId}`;
    this.io?.to(room).emit('message:stream', data);
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
