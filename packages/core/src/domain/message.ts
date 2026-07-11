import type { MessageId, ToolCallId } from './ids.js';

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; url: string; mimeType?: string }
  | {
      type: 'tool_call';
      toolCallId: ToolCallId;
      toolName: string;
      input: Record<string, unknown>;
    }
  | { type: 'tool_result'; toolCallId: ToolCallId; output: unknown; isError?: boolean };

export interface Message {
  id: MessageId;
  role: MessageRole;
  content: ContentPart[];
  name?: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export const textMessage = (
  id: MessageId,
  role: MessageRole,
  text: string,
  createdAt: string = new Date().toISOString(),
): Message => ({
  id,
  role,
  content: [{ type: 'text', text }],
  createdAt,
});

export const messageText = (message: Message): string =>
  message.content
    .filter((part): part is Extract<ContentPart, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('');
