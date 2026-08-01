# Release 3 Frontend Architecture
## Universal AI Workspace — Conversational AI Platform

**Status:** Implementation in progress
**Date:** 2026-07-30
**Scope:** Complete production-grade frontend for Release 3 Universal AI Workspace
**Backend:** Supports streaming conversations, real-time presence, tool execution, memory system

---

## System Topology

```
Browser (Next.js 15 App Router)
├─ Auth Layer (Session + JWT validation)
├─ API Client (TanStack Query, real-time socket)
├─ Store Layer (Zustand + Immer)
├─ Component Layer (React 19 + shadcn/ui)
│  ├─ Chat Interface (Message list, Input, Streaming UI)
│  ├─ Sidebar (Conversations, Folders, Search)
│  ├─ Settings (Model, Provider, Parameters)
│  └─ Shared (Presence, Collaborators, Workspace)
└─ Hooks (useConversation, useMessage, useStream, etc.)
      ↓ HTTPS + WebSocket (real-time)
Express Backend (Release 2/3 complete)
├─ Conversation API (CRUD, streaming SSE)
├─ Message API (threading, branching, edit)
├─ Tool Execution (async, streaming results)
├─ Memory System (semantic search, retrieval)
└─ Collaboration (WebSocket presence, sync)
      ↓
PostgreSQL + Redis + Vector DB
```

---

## Page Structure

```
/app/
├─ (auth)/                          # Auth pages (login, register, reset)
│  ├─ login/page.tsx
│  ├─ register/page.tsx
│  ├─ forgot-password/page.tsx
│  └─ reset-password/[token]/page.tsx
│
├─ (dashboard)/                     # Protected dashboard
│  ├─ conversations/
│  │  ├─ page.tsx                  # Conversation list/discovery
│  │  └─ [id]/page.tsx             # Chat interface (main)
│  │
│  ├─ settings/
│  │  ├─ profile/page.tsx
│  │  ├─ account/page.tsx
│  │  ├─ workspace/page.tsx
│  │  ├─ usage/page.tsx
│  │  ├─ api-keys/page.tsx
│  │  ├─ security/page.tsx
│  │  └─ billing/page.tsx
│  │
│  ├─ library/
│  │  ├─ prompts/page.tsx
│  │  └─ templates/page.tsx
│  │
│  └─ layout.tsx                   # Dashboard shell (sidebar, topbar)
│
├─ api/                             # Backend API proxy routes
│  ├─ conversations/route.ts
│  ├─ messages/route.ts
│  └─ ...
│
└─ layout.tsx                       # Root layout + providers
```

---

## Core Component Hierarchy

### Chat Interface (Main Page)

```
ChatPage ([id]/page.tsx)
├─ ChatHeader
│  ├─ ConversationTitle
│  ├─ ModelSelector
│  ├─ ProviderSelector
│  ├─ SettingsButton
│  └─ ShareButton
│
├─ SplitPane (Resizable)
│  ├─ LeftPanel (Sidebar)
│  │  ├─ ConversationSearch
│  │  ├─ ConversationList
│  │  │  └─ ConversationItem (+ pin, archive, delete)
│  │  ├─ FolderTree
│  │  └─ QuickActions
│  │
│  └─ MainPanel
│     ├─ MessageList (Virtualized)
│     │  └─ MessageItem
│     │     ├─ Avatar
│     │     ├─ MessageContent
│     │     │  ├─ Markdown + Syntax Highlighting
│     │     │  ├─ Mermaid Diagrams
│     │     │  ├─ Tables
│     │     │  └─ Media (images, PDF, audio, video)
│     │     ├─ ToolExecution
│     │     ├─ ReasoningBlock
│     │     └─ MessageActions
│     │        ├─ Edit
│     │        ├─ Regenerate
│     │        ├─ Copy
│     │        ├─ Branch
│     │        └─ Delete
│     │
│     ├─ MessageInput
│     │  ├─ Editor (auto-expand, markdown)
│     │  ├─ FileUpload (drag-drop, paste, multi-file)
│     │  ├─ PromptLibrary (autocomplete)
│     │  └─ SendButton
│     │
│     └─ TypingIndicator

RightPanel (Optional - Collaboration/Info)
├─ ConversationInfo
├─ CollaboratorsPresence
├─ SharedWith
└─ RecentFiles
```

### Conversation Management

```
ConversationListPage (page.tsx)
├─ SearchBar (global search across conversations + messages)
├─ SortMenu (recent, title, oldest)
├─ ViewToggle (list/grid/timeline)
└─ ConversationGrid
   ├─ PinnedConversations
   └─ AllConversations (paginated, infinite scroll)
      └─ ConversationCard
         ├─ Title
         ├─ Preview (last message snippet)
         ├─ LastUpdated
         ├─ Status badges
         └─ Quick actions
```

---

## Store Architecture (Zustand)

### conversationStore
- `conversations: Conversation[]`
- `currentConversation: Conversation | null`
- `loading: boolean`
- `error: string | null`
- `actions: { load, create, update, delete, archive, restore }`

### messageStore
- `messages: Map<conversationId, Message[]>`
- `isStreaming: boolean`
- `streamingMessageId: string | null`
- `actions: { addMessage, updateMessage, deleteMessage, startStream, addToken }`

### uiStore
- `sidebarOpen: boolean`
- `sidebarWidth: number`
- `selectedConversation: string | null`
- `selectedMessage: string | null`
- `showSettings: boolean`
- `actions: { setSidebarWidth, toggleSidebar, selectConversation }`

### settingsStore
- `model: string`
- `provider: string`
- `temperature: number`
- `topP: number`
- `contextWindow: number`
- `actions: { setModel, setProvider, setTemperature, etc. }`

### presenceStore
- `activeUsers: Map<userId, UserPresence>`
- `typingUsers: Set<userId>`
- `actions: { addUser, removeUser, setTyping, unsetTyping }`

---

## API Client Architecture (TanStack Query + Socket)

### conversationClient.ts
- `useConversations(workspaceId)` → infinite query
- `useConversation(id)` → query with streaming support
- `useCreateConversation()` → mutation
- `useUpdateConversation(id)` → mutation
- `useDeleteConversation(id)` → mutation
- `useArchiveConversation(id)` → mutation

### messageClient.ts
- `useMessages(conversationId)` → infinite query (scroll up = older)
- `useCreateMessage(conversationId)` → mutation + SSE streaming
- `useUpdateMessage(id)` → mutation
- `useDeleteMessage(id)` → mutation
- `useRegenerate(messageId)` → mutation + streaming
- `useContinue(messageId)` → mutation + streaming

### searchClient.ts
- `useSearchConversations(query)` → query
- `useSemanticSearch(query)` → query (vector DB)
- `useSearchMessages(query, conversationId)` → query

### collaborationClient.ts
- WebSocket subscription to presence/typing
- Real-time sync of message edits
- Conflict resolution (CRDT or last-write-wins)

---

## Hook Library

### useConversation(id)
- Fetches conversation, message list, updates in real-time
- Returns: { conversation, messages, isLoading, error }

### useMessage(conversationId, messageId)
- Fetches single message with full context
- Returns: { message, isLoading, error }

### useStream(conversationId)
- Manages SSE streaming, token accumulation, error handling
- Returns: { isStreaming, streamContent, error, cancel, retry }

### useMessageActions(messageId)
- Wraps edit, delete, regenerate, branch operations
- Returns: { edit, delete, regenerate, branch, isLoading, error }

### useConversationActions(conversationId)
- Wraps archive, restore, pin, delete operations
- Returns: { archive, restore, pin, unpin, delete, isLoading, error }

### useSearch(query)
- Full-text + semantic search across conversations/messages
- Debounced, returns results as user types
- Returns: { results, isLoading, error }

### usePresence()
- Subscribe to active users, typing indicators
- Returns: { activeUsers, typingUsers, setTyping }

### useKeyboardShortcuts()
- Global keyboard handlers: cmd+K (search), cmd+N (new), etc.
- Returns: { registerShortcut, unregister }

### useOfflineSync()
- Queue mutations when offline, replay when online
- Optimistic updates
- Returns: { syncQueue, isSyncing, error }

---

## Streaming Architecture

### Server-Sent Events (SSE)

**Endpoint:** `POST /api/conversations/:id/messages`

Request:
```json
{
  "content": "What is...",
  "parentId": "msg_123",
  "model": "claude-opus",
  "temperature": 0.7
}
```

Response (SSE stream):
```
event: message_created
data: {"id": "msg_456", "status": "streaming"}

event: token
data: "Hello"

event: token
data: " there"

event: done
data: {
  "id": "msg_456",
  "status": "complete",
  "inputTokens": 150,
  "outputTokens": 42,
  "duration": 1250
}
```

**Client handling:**
1. Create message (status=PENDING)
2. Open SSE connection
3. Accumulate tokens in real-time (UI updates per token)
4. On `done`, mark message COMPLETE
5. Handle errors gracefully (retry button)

---

## State Management Flow

### Message Creation & Streaming
```
1. User types message + clicks Send
2. Optimistic add to messageStore (role=USER, status=PENDING)
3. POST to backend, store returns messageId
4. Open SSE to stream endpoint
5. Each token: updateMessage in store
6. On done: mark COMPLETE, update usage
7. On error: mark FAILED, show retry
```

### Conversation Updates
```
1. User renames conversation
2. Optimistic update in conversationStore
3. PATCH to backend
4. If error: revert to previous state
5. If success: celebrate (no UI change needed)
```

### Real-Time Collaboration
```
1. WebSocket connection on chat page load
2. Subscribe to conversation room
3. Receive: { type: 'message_added' | 'message_edited' | 'user_typing' | etc. }
4. Apply to stores
5. Resolve conflicts (if offline wrote over online change)
```

---

## Feature Phases

### Phase 1: MVP (Core Chat)
✅ **Conversation CRUD**
- Create, read, update, delete conversations
- List with search, folders, pinning
- Archive/restore/delete permanently
- Soft delete UI (trash bin)

✅ **Messages & Streaming**
- Send message
- Receive streamed tokens in real-time
- Display markdown + syntax highlighting
- Message actions (edit, delete, copy, regenerate)
- Continue generation (append more tokens)

✅ **Model & Provider Selection**
- Dropdown selectors for model/provider
- Temperature, top-p, context-window sliders
- Save to conversation settings
- Per-message override

✅ **Core Sidebar**
- Conversation list with scroll/infinity
- Create new conversation button
- Search conversations
- Pin/unpin
- Archive button

### Phase 2: Templates & Prompts
- Prompt library (CRUD, star, search)
- Templates (create conversation from template)
- Quick-insert prompt snippets in editor

### Phase 3: Branching & History
- Message branching (alternative generations)
- Version history (rewind to previous state)
- Diff viewer
- Branch switcher (switch between alternatives)

### Phase 4: Collaboration
- Real-time presence (who's viewing)
- Typing indicators
- Shared conversations (invite-link based)
- Read-only vs. edit permissions
- Conflict resolution (merges)

### Phase 5: Advanced
- AI Memory viewer/search
- Tool execution visualization
- Reasoning blocks (thinking display)
- File uploads & media preview
- Conversation export/import

### Phase 6: Polish
- Accessibility audit & fixes
- Performance optimization (code splitting, virtualization)
- Bundle analysis & optimization
- Dark/light theme refinement
- Keyboard shortcuts guide
- Storybook documentation

---

## Testing Strategy

### Unit Tests (Components, Hooks, Utilities)
- vitest + React Testing Library
- Target: >80% coverage on business logic
- Fixtures for common data (mock conversations, messages)

### Integration Tests (Pages, API Client)
- Test full flows (login → create conversation → send message → stream)
- Mock API responses
- Test error states

### E2E Tests (Playwright)
- Real browser, real backend (staging)
- Test critical paths: auth, create, send, regenerate, share
- Visual regression (Playwright snapshots)

### Accessibility (a11y)
- axe-core in tests
- Manual WCAG 2.1 AA review
- Screen reader testing (NVDA/VoiceOver)

### Performance
- Lighthouse audit
- Bundle size monitoring (next/bundle-analyzer)
- Virtualization stress test (10K messages)
- Lighthouse CI in pipeline

---

## Deployment

**Targets:** Vercel (staging/prod)

**Environment Variables:**
```
NEXT_PUBLIC_API_URL=http://localhost:3001       # dev
NEXT_PUBLIC_API_URL=https://api-staging.synora.app   # staging
NEXT_PUBLIC_API_URL=https://api.synora.app      # prod
```

**Build:**
```bash
pnpm run build          # Next.js build
pnpm run lint           # ESLint
pnpm run type-check     # TypeScript
pnpm run test           # Vitest
```

**CI Checks:**
- TypeScript strict mode
- ESLint (no suppressions)
- All tests pass
- Bundle size < X MB
- Lighthouse score > 90

---

## Success Criteria (Production-Ready)

✅ **Functionality**
- [ ] Core chat interface functional (send/receive/stream)
- [ ] Conversation management (CRUD, folders, search)
- [ ] Message editing, regeneration, branching
- [ ] Model/provider/parameter selection
- [ ] Real-time presence & typing indicators
- [ ] Sharing & collaboration (invite-link)
- [ ] Prompt/template library

✅ **Quality**
- [ ] No `any` types or eslint suppressions
- [ ] >80% test coverage on business logic
- [ ] Zero TypeScript errors
- [ ] Zero ESLint errors
- [ ] All accessibility checks pass (a11y)
- [ ] Lighthouse scores: Performance >90, Accessibility >95, Best Practices >90

✅ **Performance**
- [ ] First Contentful Paint < 1.5s (with real data)
- [ ] Time to Interactive < 3s
- [ ] Largest Contentful Paint < 2.5s
- [ ] Message list virtualization (10K messages loads in <100ms)
- [ ] Streaming tokens appear within 50ms of arrival

✅ **UX**
- [ ] Responsive (mobile, tablet, desktop)
- [ ] Keyboard navigation fully functional
- [ ] Dark/light theme complete
- [ ] Smooth animations (no jank)
- [ ] Intuitive error messages
- [ ] Loading/pending states clear

✅ **Documentation**
- [ ] Component storybook with interactive examples
- [ ] API client documentation (JSDoc)
- [ ] Architecture ADRs (decisions on key patterns)
- [ ] Security considerations doc
- [ ] Deployment guide

---

## Known Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Streaming latency (tokens feel slow) | HIGH | Buffer 5 tokens before render, adaptive batching |
| Memory leak with 10K messages | HIGH | Virtualized list + pagination, message cleanup |
| Concurrent edits conflict | MEDIUM | CRDT or LWW + visual indication |
| Offline mode complexity | MEDIUM | Queue mutations, replay on reconnect, clear UX |
| SSE connection drop | MEDIUM | Auto-reconnect with backoff, show warning |
| Provider API quota exceeded | MEDIUM | Graceful fallback, quota warning in UI |

---

## Next Steps

1. ✅ Design architecture (this document)
2. → Scaffold project structure (folders, configs, dependencies)
3. → Implement API client + hooks
4. → Build core chat interface
5. → Add conversation management
6. → Implement streaming UI
7. → Add message features (edit, regenerate, branch)
8. → Implement collaboration (presence, typing)
9. → Add advanced features (templates, memory, tools)
10. → Polish & accessibility
11. → Performance optimization
12. → Documentation & storybook
13. → Final verification & launch

---

**Status: Ready to scaffold and build Phase 1 (MVP)**
