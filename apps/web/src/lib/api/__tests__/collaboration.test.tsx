/**
 * Collaboration client hook tests, against a scripted fake socket.
 * Pins the event contract with the backend RealtimeService: the exact
 * event names emitted (join:conversation / leave:conversation /
 * typing:start / typing:stop) and how presence/typing payloads fold
 * into hook state.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

type Handler = (...args: unknown[]) => void;

const handlers = new Map<string, Set<Handler>>();
const emitted: Array<{ event: string; payload: unknown }> = [];

const fakeSocket = {
  connected: true,
  connect: vi.fn(),
  disconnect: vi.fn(),
  emit: vi.fn((event: string, payload: unknown) => {
    emitted.push({ event, payload });
  }),
  on: vi.fn((event: string, handler: Handler) => {
    if (!handlers.has(event)) handlers.set(event, new Set());
    handlers.get(event)!.add(handler);
  }),
  off: vi.fn((event: string, handler: Handler) => {
    handlers.get(event)?.delete(handler);
  }),
};

function fire(event: string, payload: unknown) {
  handlers.get(event)?.forEach((handler) => handler(payload));
}

vi.mock('socket.io-client', () => ({
  io: () => fakeSocket,
}));

import {
  useConversationPresence,
  useTypingBroadcast,
  resetRealtimeSocketForTests,
} from '../collaboration';

describe('useConversationPresence', () => {
  beforeEach(() => {
    handlers.clear();
    emitted.length = 0;
    fakeSocket.connected = true;
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetRealtimeSocketForTests();
  });

  it('joins the conversation room with the exact backend event name', () => {
    renderHook(() => useConversationPresence('conv-1'));
    expect(emitted).toContainEqual({
      event: 'join:conversation',
      payload: { conversationId: 'conv-1' },
    });
  });

  it('tracks joins and leaves from presence events', () => {
    const { result } = renderHook(() => useConversationPresence('conv-1'));

    act(() => fire('presence', { userId: 'u2', action: 'joined' }));
    expect(result.current.participants).toEqual([{ userId: 'u2', isTyping: false }]);

    act(() => fire('presence', { userId: 'u3', action: 'joined' }));
    act(() => fire('presence', { userId: 'u2', action: 'left' }));
    expect(result.current.participants).toEqual([{ userId: 'u3', isTyping: false }]);
  });

  it('flags typing participants and clears on stop', () => {
    const { result } = renderHook(() => useConversationPresence('conv-1'));

    act(() => fire('presence', { userId: 'u2', action: 'joined' }));
    act(() => fire('typing', { userId: 'u2', action: 'start' }));
    expect(result.current.participants).toEqual([{ userId: 'u2', isTyping: true }]);

    act(() => fire('typing', { userId: 'u2', action: 'stop' }));
    expect(result.current.participants).toEqual([{ userId: 'u2', isTyping: false }]);
  });

  it('leaves the room on unmount without tearing down the shared socket', () => {
    const { unmount } = renderHook(() => useConversationPresence('conv-1'));
    unmount();
    expect(emitted).toContainEqual({
      event: 'leave:conversation',
      payload: { conversationId: 'conv-1' },
    });
    expect(fakeSocket.disconnect).not.toHaveBeenCalled();
  });
});

describe('useTypingBroadcast', () => {
  beforeEach(() => {
    handlers.clear();
    emitted.length = 0;
    fakeSocket.connected = true;
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetRealtimeSocketForTests();
  });

  it('emits one typing:start per burst and typing:stop after idle', () => {
    const { result } = renderHook(() => useTypingBroadcast('conv-1'));

    act(() => {
      result.current.notifyTyping();
      result.current.notifyTyping();
      result.current.notifyTyping();
    });

    const starts = emitted.filter((e) => e.event === 'typing:start');
    expect(starts).toHaveLength(1);
    expect(starts[0].payload).toEqual({ conversationId: 'conv-1' });

    act(() => {
      vi.advanceTimersByTime(2500);
    });
    expect(emitted.filter((e) => e.event === 'typing:stop')).toHaveLength(1);
  });

  it('emits typing:stop on unmount if still typing', () => {
    const { result, unmount } = renderHook(() => useTypingBroadcast('conv-1'));
    act(() => result.current.notifyTyping());
    unmount();
    expect(emitted.filter((e) => e.event === 'typing:stop')).toHaveLength(1);
  });
});
