import { describe, expect, it } from 'vitest';
import { asMessageId } from './ids.js';
import { messageText, textMessage } from './message.js';

describe('message helpers', () => {
  it('builds a text message and extracts its text', () => {
    const msg = textMessage(asMessageId('m1'), 'user', 'hello world');
    expect(msg.role).toBe('user');
    expect(messageText(msg)).toBe('hello world');
  });

  it('concatenates multiple text parts', () => {
    const msg = textMessage(asMessageId('m2'), 'assistant', 'part one');
    msg.content.push({ type: 'text', text: ' part two' });
    expect(messageText(msg)).toBe('part one part two');
  });
});
