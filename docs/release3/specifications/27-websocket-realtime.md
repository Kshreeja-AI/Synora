# WebSocket Real-Time Specification

**Version:** 1.0 | **Status:** Complete | **Last Updated:** 2026-07-28

## Overview

Real-time collaboration using WebSocket (Socket.io). Enables presence, typing indicators, collaborative message editing, and live updates without polling.

---

## Configuration

```typescript
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';

const io = new Server(httpServer, {
  cors: {
    origin: ['https://synora.ai', 'https://app.synora.ai'],
    methods: ['GET', 'POST'],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
  maxHttpBufferSize: 1e6,  // 1MB max message
  pingInterval: 25000,     // 25s (detect dead connections)
  pingTimeout: 60000,      // 60s (wait for pong)
  serializerLike: {
    stringify: JSON.stringify,
    parse: JSON.parse,
  },
});

// Redis adapter for multi-server setup
const pubClient = redis.duplicate();
const subClient = redis.duplicate();
await Promise.all([pubClient.connect(), subClient.connect()]);
io.adapter(createAdapter(pubClient, subClient));
```

---

## Events

**Connection:**

```typescript
io.on('connection', (socket) => {
  const userId = socket.data.userId;      // from auth middleware
  const conversationId = socket.handshake.query.conversationId;
  
  // Join conversation room
  socket.join(`conversation:${conversationId}`);
  socket.join(`user:${userId}`);           // personal room
  
  // Notify others
  socket.broadcast.to(`conversation:${conversationId}`).emit('user_joined', {
    userId,
    username: socket.data.username,
    avatar: socket.data.avatar,
    timestamp: new Date(),
  });
});
```

**Presence:**

```typescript
socket.on('presence', (data) => {
  const { action, userId, conversationId } = data;
  
  if (action === 'online') {
    // Add to Redis set
    await redis.sadd(`presence:${conversationId}`, userId);
    await redis.expire(`presence:${conversationId}`, 300);  // 5 min TTL
    
    // Broadcast to conversation
    socket.broadcast.to(`conversation:${conversationId}`).emit('user_online', {
      userId,
      timestamp: Date.now(),
    });
  }
});

// Fetch active users
socket.on('get_active_users', async (callback) => {
  const userIds = await redis.smembers(`presence:${conversationId}`);
  const users = await fetchUserDetails(userIds);
  callback(users);
});
```

**Typing Indicator:**

```typescript
let typingTimeout;

socket.on('typing', ({ conversationId, isTyping }) => {
  // Throttle: max 1 event per 500ms
  clearTimeout(typingTimeout);
  
  socket.broadcast.to(`conversation:${conversationId}`).emit('user_typing', {
    userId: socket.data.userId,
    username: socket.data.username,
    isTyping,
  });
  
  // Auto-clear after 5s of inactivity
  if (isTyping) {
    typingTimeout = setTimeout(() => {
      socket.emit('typing', { conversationId, isTyping: false });
    }, 5000);
  }
});
```

**Collaborative Editing:**

```typescript
socket.on('edit_message', ({ messageId, content, version }) => {
  // Lock check: prevent concurrent edits
  const lock = `msg_lock:${messageId}`;
  const existingLock = await redis.get(lock);
  
  if (existingLock && existingLock !== socket.data.userId) {
    socket.emit('edit_error', {
      error: 'Message being edited by another user',
      editedBy: existingLock,
    });
    return;
  }
  
  // Acquire lock
  await redis.setex(lock, 30, socket.data.userId);  // 30s lock
  
  // Broadcast edit
  socket.broadcast.to(`conversation:${conversationId}`).emit('message_edited', {
    messageId,
    content,
    editedBy: socket.data.userId,
    version,
    timestamp: Date.now(),
  });
});

socket.on('release_edit_lock', ({ messageId }) => {
  const lock = `msg_lock:${messageId}`;
  redis.del(lock);
});
```

**Disconnection:**

```typescript
socket.on('disconnect', async () => {
  const conversationId = socket.handshake.query.conversationId;
  
  // Remove from presence
  await redis.srem(`presence:${conversationId}`, socket.data.userId);
  
  // Release locks
  const locks = await redis.keys(`msg_lock:*`);
  for (const lock of locks) {
    const ownerId = await redis.get(lock);
    if (ownerId === socket.data.userId) {
      await redis.del(lock);
    }
  }
  
  // Broadcast leave
  socket.broadcast.to(`conversation:${conversationId}`).emit('user_left', {
    userId: socket.data.userId,
    timestamp: Date.now(),
  });
});
```

---

## Authentication

```typescript
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    const userId = verifyJWT(token);
    
    socket.data.userId = userId;
    socket.data.username = await fetchUsername(userId);
    socket.data.avatar = await fetchAvatar(userId);
    
    next();
  } catch (error) {
    next(new Error('Authentication failed'));
  }
});
```

---

## Events Reference

| Event | Direction | Payload | Throttle |
|-------|-----------|---------|----------|
| user_joined | broadcast | userId, username, avatar | - |
| user_left | broadcast | userId | - |
| user_typing | broadcast | userId, username, isTyping | 500ms |
| user_online | broadcast | userId | - |
| user_offline | broadcast | userId | - |
| message_edited | broadcast | messageId, content, editedBy, version | - |
| message_deleted | broadcast | messageId | - |
| cursor_position | broadcast | userId, line, column | 100ms |
| reaction_added | broadcast | messageId, emoji, userId | - |
| reaction_removed | broadcast | messageId, emoji, userId | - |

---

## Performance Optimization

**Connection Pooling:**
- Max 1000 concurrent connections per server
- Auto-scale: add server when > 800 concurrent

**Message Batching:**
- Buffer small events (100ms window)
- Send in batch to reduce overhead

**Compression:**
- Enable Socket.io compression for large messages (>1KB)
- GZip on large payloads

**Broadcasting Optimization:**
```typescript
// Broadcast to room (efficient)
io.to(`conversation:${conversationId}`).emit('event', data);

// Send to specific users (direct)
socket.to(`user:${userId}`).emit('private_event', data);

// Exclude sender
socket.broadcast.to(room).emit('event', data);
```

---

## Error Handling

| Scenario | Action |
|----------|--------|
| Auth failed | 401, disconnect |
| Message too large | 413, reject |
| Room full | 429, queue |
| Duplicate connection | 409, close previous |
| Timeout (no pong) | auto-disconnect |

---

## Monitoring

- socket_connections_active{conversation_id}
- socket_connections_created_total
- socket_messages_sent_total{event_type}
- socket_latency_ms{event_type}
- socket_errors_total{error_type}

---

## Scaling (Horizontal)

**Multi-Server Setup:**
```
Server 1: [Socket1, Socket2, Socket3]
Server 2: [Socket4, Socket5, Socket6]
(all connected via Redis adapter)

Client connects to any server
→ Redis Pub/Sub broadcasts to all servers
→ Event delivered to recipient
```

**Redis Adapter:**
- Pub channel: `socket.io#{room}#`
- Sub channel: all messages
- Scales to 100K+ concurrent connections

---

## Graceful Shutdown

```typescript
async function gracefulShutdown() {
  console.log('Shutting down WebSocket server...');
  
  // Stop accepting new connections
  io.close();
  
  // Wait for existing connections to close (max 30s)
  const timeout = setTimeout(() => {
    console.warn('Force closing connections');
    process.exit(0);
  }, 30000);
  
  // Notify clients (before close)
  io.emit('server_shutting_down', {
    reason: 'Server maintenance',
    reconnectAt: new Date(Date.now() + 60000),
  });
  
  clearTimeout(timeout);
  process.exit(0);
}

process.on('SIGTERM', gracefulShutdown);
```

---

## Testing

- User joins → receives presence
- User types → others see indicator (throttled)
- User edits → broadcast received
- User disconnects → others notified
- Lock prevents concurrent edits
- Auth failure → disconnect
- Message too large → rejected
- Reconnect after network blip
- Multi-server message delivery

---

## Security

- JWT required (socket.io auth)
- Conversation access check (server-side)
- Input validation on all events
- Rate limiting per user (max 100 events/sec)
- No sensitive data in logs
- Encrypted in transit (WSS)

---

## Future Enhancements

- Operational Transform (OT) for conflict-free editing
- CRDT (Conflict-free Replicated Data Types)
- Voice/video integration (WebRTC)
- Pointer/cursor sharing
- Drawing/annotation (collaborative)
- Screen sharing
- Session recording

---

**Status:** Complete
