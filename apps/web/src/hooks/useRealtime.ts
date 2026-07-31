import { useEffect, useCallback, useState } from 'react';
import { getRealtimeClient, PresenceUser, TypingEvent, StreamEvent } from '@/lib/realtime';

export interface UseRealtimeOptions {
  conversationId: string;
  enabled?: boolean;
}

export function useRealtime({ conversationId, enabled = true }: UseRealtimeOptions) {
  const [isConnected, setIsConnected] = useState(false);
  const [presenceUsers, setPresenceUsers] = useState<PresenceUser[]>([]);
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const [error, setError] = useState<Error | null>(null);

  const client = getRealtimeClient();

  useEffect(() => {
    if (!enabled) return;

    const initializeConnection = async () => {
      try {
        const token = localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token');
        if (!token) {
          setError(new Error('No authentication token found'));
          return;
        }

        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
        const wsUrl = apiUrl.replace(/^http/, 'ws');

        await client.connect({
          url: wsUrl,
          token,
          conversationId,
        });

        setIsConnected(true);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Connection failed'));
        setIsConnected(false);
      }
    };

    if (!client.isConnected()) {
      void initializeConnection();
    } else {
      client.joinConversation(conversationId);
      setIsConnected(true);
    }

    return () => {
      client.leaveConversation(conversationId);
    };
  }, [enabled, conversationId, client]);

  // Subscribe to presence updates
  useEffect(() => {
    if (!isConnected) return;

    const unsubscribe = client.onPresence((users) => {
      setPresenceUsers(users);
    });

    return () => unsubscribe();
  }, [isConnected, client]);

  // Subscribe to typing indicators
  useEffect(() => {
    if (!isConnected) return;

    const unsubscribe = client.onTyping((event: TypingEvent) => {
      setTypingUsers((prev) => {
        const next = new Set(prev);
        if (event.action === 'start') {
          next.add(event.userId);
        } else {
          next.delete(event.userId);
        }
        return next;
      });
    });

    return () => unsubscribe();
  }, [isConnected, client]);

  const startTyping = useCallback(() => {
    client.startTyping(conversationId);
  }, [conversationId, client]);

  const stopTyping = useCallback(() => {
    client.stopTyping(conversationId);
  }, [conversationId, client]);

  const onMessageStream = useCallback((callback: (event: StreamEvent) => void) => {
    return client.onMessageStream(callback);
  }, [client]);

  const broadcastMessageStream = useCallback((event: StreamEvent) => {
    client.broadcastMessageStream(event);
  }, [client]);

  return {
    isConnected,
    presenceUsers,
    typingUsers,
    error,
    startTyping,
    stopTyping,
    onMessageStream,
    broadcastMessageStream,
  };
}
