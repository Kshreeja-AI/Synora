import type { ConversationStore, Message, SessionId } from '@synora/core';

/**
 * Per-session transcript ("working memory") kept in process memory.
 * Sessions are expected to be sticky to a gateway instance in this
 * configuration; for multi-instance deployments, implement
 * ConversationStore against Redis or Postgres instead — the port is
 * identical, so orchestration code needs no changes.
 */
export class InMemoryConversationStore implements ConversationStore {
  private readonly sessions = new Map<string, Message[]>();

  async append(sessionId: SessionId, messages: Message[]): Promise<void> {
    const existing = this.sessions.get(sessionId) ?? [];
    this.sessions.set(sessionId, [...existing, ...messages]);
  }

  async history(sessionId: SessionId, limit?: number): Promise<Message[]> {
    const messages = this.sessions.get(sessionId) ?? [];
    return limit ? messages.slice(-limit) : messages;
  }

  async clear(sessionId: SessionId): Promise<void> {
    this.sessions.delete(sessionId);
  }
}
