# AI Memory Specification

**Version:** 1.0 | **Status:** Complete | **Last Updated:** 2026-07-28

## Overview

Conversation summaries and context windows. Long-term memory for multi-turn conversations.

---

## Service Layer

```typescript
class MemoryService {
  async summarizeConversation(conversationId: string): Promise<string>
  // Auto-generated summary for context
  
  async getContextWindow(
    conversationId: string,
    maxTokens: number = 2000
  ): Promise<Message[]>
  // Returns windowed messages for prompt
  
  async storeMemory(
    conversationId: string,
    memoryKey: string,
    value: any
  ): Promise<void>
}
```

---

## Database

Cache in Redis: `memory:{conversationId}:{key}` (TTL: 7 days)

---

## Testing

- Context window calculation
- Summary generation
- Memory retrieval

---

**Status:** Complete
