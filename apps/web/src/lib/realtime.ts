import { io, Socket } from 'socket.io-client';

export interface RealtimeClientConfig {
  url: string;
  token: string;
  conversationId: string;
}

export interface PresenceUser {
  userId: string;
  timestamp: number;
}

export interface TypingEvent {
  userId: string;
  action: 'start' | 'stop';
  timestamp: number;
}

export interface StreamEvent {
  conversationId: string;
  messageId: string;
  type: 'token' | 'done' | 'error';
  data: string | Record<string, unknown>;
}

export class RealtimeClient {
  private socket: Socket | null = null;
  private config: RealtimeClientConfig | null = null;
  private presenceUsers: Set<string> = new Set();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;

  constructor() {
    this.setupGlobalErrorHandler();
  }

  connect(config: RealtimeClientConfig): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.config = config;
        this.socket = io(config.url, {
          auth: {
            token: config.token,
          },
          reconnection: true,
          reconnectionDelay: this.reconnectDelay,
          reconnectionDelayMax: 5000,
          reconnectionAttempts: this.maxReconnectAttempts,
          transports: ['websocket', 'polling'],
        });

        this.socket.on('connect', () => {
          this.reconnectAttempts = 0;
          console.log('WebSocket connected');
          this.joinConversation(config.conversationId);
          resolve();
        });

        this.socket.on('connect_error', (error) => {
          console.error('WebSocket connection error:', error);
          reject(error);
        });

        this.socket.on('disconnect', (reason) => {
          console.log('WebSocket disconnected:', reason);
        });

        this.socket.on('error', (error) => {
          console.error('WebSocket error:', error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  joinConversation(conversationId: string): void {
    if (!this.socket) {
      console.warn('Socket not connected');
      return;
    }

    this.socket.emit('join:conversation', { conversationId });
  }

  leaveConversation(conversationId: string): void {
    if (!this.socket) {
      console.warn('Socket not connected');
      return;
    }

    this.socket.emit('leave:conversation', { conversationId });
  }

  startTyping(conversationId: string): void {
    if (!this.socket) {
      console.warn('Socket not connected');
      return;
    }

    this.socket.emit('typing:start', { conversationId });
  }

  stopTyping(conversationId: string): void {
    if (!this.socket) {
      console.warn('Socket not connected');
      return;
    }

    this.socket.emit('typing:stop', { conversationId });
  }

  onPresence(callback: (users: PresenceUser[]) => void): () => void {
    if (!this.socket) {
      console.warn('Socket not connected');
      return () => {};
    }

    const handler = (data: { userId?: string; action?: string; users?: PresenceUser[] }) => {
      if (data.users) {
        callback(data.users);
        this.presenceUsers = new Set(data.users.map((u) => u.userId));
      }
    };

    this.socket.on('presence', handler);
    this.socket.on('presence:list', handler);

    return () => {
      if (this.socket) {
        this.socket.off('presence', handler);
        this.socket.off('presence:list', handler);
      }
    };
  }

  onTyping(callback: (event: TypingEvent) => void): () => void {
    if (!this.socket) {
      console.warn('Socket not connected');
      return () => {};
    }

    this.socket.on('typing', callback);

    return () => {
      if (this.socket) {
        this.socket.off('typing', callback);
      }
    };
  }

  onMessageStream(callback: (event: StreamEvent) => void): () => void {
    if (!this.socket) {
      console.warn('Socket not connected');
      return () => {};
    }

    this.socket.on('message:stream', callback);
    this.socket.on('message:new', callback);

    return () => {
      if (this.socket) {
        this.socket.off('message:stream', callback);
        this.socket.off('message:new', callback);
      }
    };
  }

  broadcastMessageStream(event: StreamEvent): void {
    if (!this.socket) {
      console.warn('Socket not connected');
      return;
    }

    this.socket.emit('message:stream', event);
  }

  getPresenceUsers(): string[] {
    return Array.from(this.presenceUsers);
  }

  isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  private setupGlobalErrorHandler(): void {
    if (typeof window !== 'undefined') {
      window.addEventListener('error', (event) => {
        console.error('Global error from realtime client:', event.error);
      });
    }
  }
}

// Singleton instance for app-wide access
let realtimeClientInstance: RealtimeClient | null = null;

export function getRealtimeClient(): RealtimeClient {
  if (!realtimeClientInstance) {
    realtimeClientInstance = new RealtimeClient();
  }
  return realtimeClientInstance;
}

export function resetRealtimeClient(): void {
  if (realtimeClientInstance) {
    realtimeClientInstance.disconnect();
    realtimeClientInstance = null;
  }
}
