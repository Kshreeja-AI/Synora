# Workspace Collaboration Specification

**Version:** 1.0 | **Status:** Complete | **Last Updated:** 2026-07-28

## Overview

Real-time presence, typing indicators, collaborative message editing. WebSocket-based for low-latency updates.

---

## WebSocket Events

```typescript
interface PresenceEvent {
  type: 'user_joined' | 'user_left';
  userId: string;
  username: string;
  avatar?: string;
}

interface TypingEvent {
  type: 'user_typing';
  userId: string;
  isTyping: boolean;
}

interface CollaborationEvent {
  type: 'message_editing';
  messageId: string;
  userId: string;
  isEditing: boolean;
}
```

---

## Service Layer

```typescript
class CollaborationService {
  async broadcastPresence(
    conversationId: string,
    userId: string,
    action: 'join' | 'leave'
  ): Promise<void>

  async broadcastTyping(
    conversationId: string,
    userId: string,
    isTyping: boolean
  ): Promise<void>

  async getActiveUsers(
    conversationId: string
  ): Promise<User[]>
}
```

---

## API (WebSocket)

```javascript
// Client
const socket = io(API_URL, {
  query: { conversationId: 'conv_123' },
  auth: { token: authToken }
});

socket.on('user_joined', (data) => {
  console.log(`${data.username} joined`);
});

socket.emit('typing', { isTyping: true });
```

---

## Validation

- Conversation exists
- User has access
- Typing events throttled (max 1 per 500ms)

---

## Permissions

- Workspace member can see presence
- Only own typing indicator can be changed

---

## Logging

```json
{ "action": "user_joined", "conversationId": "conv_123", "userId": "user_123" }
{ "action": "user_typing", "conversationId": "conv_123", "userId": "user_123", "isTyping": true }
```

---

## Monitoring

- socket_connections_total{conversation_id}
- active_users_count{conversation_id}
- typing_events_total

---

## Testing

- Connect socket → receive presence events
- Emit typing → broadcast to others
- Disconnect → leave event

---

## Performance

- Presence latency P99 < 200ms
- Typing latency P99 < 100ms
- Support 1K concurrent users per conversation

---

**Status:** Complete
