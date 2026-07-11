import { asMessageId, asSessionId, textMessage } from '@synora/core';
import { describe, expect, it } from 'vitest';
import { InMemoryConversationStore } from './in-memory-conversation-store.js';

describe('InMemoryConversationStore', () => {
  it('appends and returns history in order', async () => {
    const store = new InMemoryConversationStore();
    const sessionId = asSessionId('s1');

    await store.append(sessionId, [textMessage(asMessageId('m1'), 'user', 'hi')]);
    await store.append(sessionId, [textMessage(asMessageId('m2'), 'assistant', 'hello')]);

    const history = await store.history(sessionId);
    expect(history.map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  it('respects the limit parameter', async () => {
    const store = new InMemoryConversationStore();
    const sessionId = asSessionId('s1');
    for (let i = 0; i < 5; i++) {
      await store.append(sessionId, [textMessage(asMessageId(`m${i}`), 'user', `msg ${i}`)]);
    }
    const history = await store.history(sessionId, 2);
    expect(history.map((m) => m.id)).toEqual(['m3', 'm4']);
  });

  it('clears a session', async () => {
    const store = new InMemoryConversationStore();
    const sessionId = asSessionId('s1');
    await store.append(sessionId, [textMessage(asMessageId('m1'), 'user', 'hi')]);
    await store.clear(sessionId);
    expect(await store.history(sessionId)).toEqual([]);
  });
});
