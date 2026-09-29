'use client';

/**
 * Realtime collaboration client.
 *
 * Speaks socket.io to the backend RealtimeService — the actual
 * protocol the server runs (the previous implementation opened a raw
 * WebSocket, which socket.io cannot accept, so it never connected).
 *
 * Server contract (services/realtime.service.ts):
 *   emit  join:conversation / leave:conversation  { conversationId }
 *   emit  typing:start / typing:stop              { conversationId }
 *   on    presence      { userId, action: 'joined'|'left', timestamp }
 *   on    typing        { userId, action: 'start'|'stop', timestamp }
 *   on    error:join    { conversationId, reason }
 *
 * Auth rides on the httpOnly accessToken cookie: the browser attaches
 * it to the handshake request when `withCredentials` is set — the
 * client never sees the token itself.
 *
 * The server knows only userIds. Mapping ids to names/avatars is the
 * component's job (workspace members API) — this module never invents
 * profile data.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getApiBaseUrl } from './client';

let socketInstance: Socket | null = null;

/**
 * Lazily-created shared socket. One connection per tab regardless of
 * how many conversations/hooks use it; socket.io multiplexes rooms
 * over it and auto-reconnects with backoff.
 */
export function getRealtimeSocket(): Socket {
  if (!socketInstance) {
    socketInstance = io(getApiBaseUrl(), {
      withCredentials: true,
      transports: ['websocket', 'polling'],
      autoConnect: false,
    });
  }
  return socketInstance;
}

/** Test seam: drop the shared instance so each test starts clean. */
export function resetRealtimeSocketForTests(): void {
  socketInstance?.disconnect();
  socketInstance = null;
}

export interface PresenceEntry {
  userId: string;
  isTyping: boolean;
}

interface PresenceEventPayload {
  userId: string;
  action: 'joined' | 'left';
}

interface TypingEventPayload {
  userId: string;
  action: 'start' | 'stop';
}

const TYPING_EXPIRY_MS = 4000;

/**
 * Join a conversation's realtime room and track who's present and
 * typing. Handles reconnects by re-joining on every 'connect' event,
 * and leaves the room (without tearing down the shared socket) on
 * unmount.
 */
export function useConversationPresence(conversationId: string | undefined): {
  participants: PresenceEntry[];
  isConnected: boolean;
} {
  const [present, setPresent] = useState<Map<string, { isTyping: boolean }>>(new Map());
  const [isConnected, setIsConnected] = useState(false);
  const typingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    if (!conversationId) return;

    const socket = getRealtimeSocket();

    const join = () => {
      socket.emit('join:conversation', { conversationId });
      setIsConnected(true);
    };

    const handlePresence = (event: PresenceEventPayload) => {
      setPresent((prev) => {
        const next = new Map(prev);
        if (event.action === 'joined') {
          next.set(event.userId, { isTyping: prev.get(event.userId)?.isTyping ?? false });
        } else {
          next.delete(event.userId);
        }
        return next;
      });
    };

    const handleTyping = (event: TypingEventPayload) => {
      const isTyping = event.action === 'start';
      setPresent((prev) => {
        const next = new Map(prev);
        const existing = next.get(event.userId);
        if (existing) next.set(event.userId, { ...existing, isTyping });
        return next;
      });

      // Safety expiry: if a typing:stop is lost (tab close mid-type),
      // clear the flag locally rather than showing it forever.
      const timers = typingTimers.current;
      const pending = timers.get(event.userId);
      if (pending) clearTimeout(pending);
      if (isTyping) {
        timers.set(
          event.userId,
          setTimeout(() => {
            setPresent((prev) => {
              const next = new Map(prev);
              const entry = next.get(event.userId);
              if (entry) next.set(event.userId, { ...entry, isTyping: false });
              return next;
            });
          }, TYPING_EXPIRY_MS)
        );
      }
    };

    const handleDisconnect = () => setIsConnected(false);

    socket.on('connect', join);
    socket.on('presence', handlePresence);
    socket.on('typing', handleTyping);
    socket.on('disconnect', handleDisconnect);

    if (socket.connected) {
      join();
    } else {
      socket.connect();
    }

    const timers = typingTimers.current;
    return () => {
      if (socket.connected) {
        socket.emit('leave:conversation', { conversationId });
      }
      socket.off('connect', join);
      socket.off('presence', handlePresence);
      socket.off('typing', handleTyping);
      socket.off('disconnect', handleDisconnect);
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
      setPresent(new Map());
    };
  }, [conversationId]);

  return {
    participants: Array.from(present.entries()).map(([userId, state]) => ({
      userId,
      isTyping: state.isTyping,
    })),
    isConnected,
  };
}

const TYPING_IDLE_STOP_MS = 2000;

/**
 * Broadcast the local user's typing state. Call `notifyTyping()` on
 * every keystroke — it throttles to one typing:start per burst and
 * emits typing:stop after 2s of idleness (and on unmount).
 */
export function useTypingBroadcast(conversationId: string | undefined): {
  notifyTyping: () => void;
} {
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);

  const stop = useCallback(() => {
    if (!conversationId || !isTypingRef.current) return;
    isTypingRef.current = false;
    const socket = getRealtimeSocket();
    if (socket.connected) {
      socket.emit('typing:stop', { conversationId });
    }
  }, [conversationId]);

  const notifyTyping = useCallback(() => {
    if (!conversationId) return;
    const socket = getRealtimeSocket();
    if (!socket.connected) return;

    if (!isTypingRef.current) {
      isTypingRef.current = true;
      socket.emit('typing:start', { conversationId });
    }
    if (stopTimer.current) clearTimeout(stopTimer.current);
    stopTimer.current = setTimeout(stop, TYPING_IDLE_STOP_MS);
  }, [conversationId, stop]);

  useEffect(() => {
    return () => {
      if (stopTimer.current) clearTimeout(stopTimer.current);
      stop();
    };
  }, [stop]);

  return { notifyTyping };
}
