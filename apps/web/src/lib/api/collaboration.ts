'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useCurrentUser } from '@/hooks/useCurrentUser';

export interface User {
  id: string;
  name: string;
  avatar?: string;
  email?: string;
}

export interface PresenceUser extends User {
  lastSeen: string;
  isTyping?: boolean;
}

export interface PresenceState {
  userId: string;
  conversationId: string;
  joinedAt: string;
  isTyping: boolean;
}

let wsInstance: WebSocket | null = null;
let reconnectTimeout: NodeJS.Timeout | null = null;

function getWebSocketUrl(): string {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
  return baseUrl.replace(/^http/, 'ws');
}

function ensureWebSocketConnection(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    if (wsInstance && wsInstance.readyState === WebSocket.OPEN) {
      resolve(wsInstance);
      return;
    }

    try {
      wsInstance = new WebSocket(`${getWebSocketUrl()}/api/realtime`);
      wsInstance.onopen = () => {
        resolve(wsInstance!);
      };
      wsInstance.onerror = () => reject(new Error('WebSocket connection failed'));
    } catch (error) {
      reject(error);
    }
  });
}

export function usePresence(conversationId: string) {
  const { data: currentUser } = useCurrentUser();
  const [users, setUsers] = useState<PresenceUser[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!currentUser || !conversationId) return;

    let mounted = true;

    async function connect() {
      try {
        const ws = await ensureWebSocketConnection();
        wsRef.current = ws;

        if (!mounted) return;

        ws.addEventListener('message', (event) => {
          const data = JSON.parse(event.data);

          if (data.type === 'presence') {
            if (mounted) {
              setUsers(data.users);
            }
          } else if (data.type === 'typing') {
            if (mounted) {
              setUsers((prev) =>
                prev.map((u) =>
                  u.id === data.userId ? { ...u, isTyping: data.isTyping } : u
                )
              );

              if (data.isTyping && typingTimeoutRef.current) {
                clearTimeout(typingTimeoutRef.current);
              }

              if (data.isTyping) {
                typingTimeoutRef.current = setTimeout(() => {
                  setUsers((prev) =>
                    prev.map((u) =>
                      u.id === data.userId ? { ...u, isTyping: false } : u
                    )
                  );
                }, 3000);
              }
            }
          }
        });

        ws.send(
          JSON.stringify({
            type: 'join',
            conversationId,
            userId: currentUser?.id,
            user: currentUser ? {
              id: currentUser.id,
              name: currentUser.name || 'Anonymous',
              avatar: currentUser.image || undefined,
              email: currentUser.email,
            } : undefined,
          })
        );

        if (mounted) {
          setIsConnected(true);
        }
      } catch (error) {
        console.error('Failed to connect to presence service:', error);
        if (mounted) {
          setIsConnected(false);
          // Retry after 3 seconds
          reconnectTimeout = setTimeout(() => {
            if (mounted) {
              connect();
            }
          }, 3000);
        }
      }
    }

    connect();

    return () => {
      mounted = false;
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
      if (wsRef.current && wsRef.current === wsInstance) {
        wsRef.current.send(
          JSON.stringify({
            type: 'leave',
            conversationId,
            userId: currentUser.id,
          })
        );
      }
    };
  }, [currentUser, conversationId]);

  const broadcastTyping = useCallback(
    (isTyping: boolean) => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'typing',
            conversationId,
            userId: currentUser?.id,
            isTyping,
          })
        );
      }
    },
    [conversationId, currentUser?.id]
  );

  return { users, isConnected, broadcastTyping };
}

export function useTypingIndicator(conversationId: string, isTyping: boolean) {
  const { users, broadcastTyping } = usePresence(conversationId);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    broadcastTyping(isTyping);

    if (isTyping) {
      timeoutRef.current = setTimeout(() => {
        broadcastTyping(false);
      }, 5000);
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [isTyping, broadcastTyping]);

  const typingUsers = users.filter((u) => u.isTyping);
  return { typingUsers };
}
