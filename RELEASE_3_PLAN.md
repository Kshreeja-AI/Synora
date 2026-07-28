# Release 3 Plan — Universal AI Workspace

**Date:** 2026-07-28  
**Status:** In development  
**Scope:** Complete AI conversation platform (chat, streaming, history, branching, collaboration, analytics)  
**Estimated Milestones:** M1–M10 (10 focused, sequential engineering weeks)  

---

## Vision

Transform Synora from a content-generation platform into a **Universal AI Workspace** — a ChatGPT/Claude-grade conversational platform where users can:

- Have natural, streaming conversations with any AI provider
- Organize conversations by folders, tags, and search
- Branch conversations to explore alternatives
- Share conversations and collaborate in real-time
- Use prompt libraries and reusable templates
- Upload files, images, audio, and code
- Call tools and integrate external APIs
- Track usage and conversation analytics
- All while remaining completely provider-agnostic

---

## Release 3 Scope

### Core Chat Features (M1–M4)
- **Schema**: Conversation, Message, MessageBranch, ConversationFolder, ConversationTag
- **Streaming**: Server-Sent Events, real-time message display
- **UI**: Chat interface (message display, input, actions, sidebar)
- **History**: Conversation list, search, sorting, pagination

### Organization & Discovery (M5)
- Folders (nested, workspace-scoped)
- Tags (multiple per conversation)
- Search (full-text, by provider, by date range)
- Archive/restore
- Pinning favorites

### Knowledge & Templates (M6)
- Prompt library (system prompts, custom templates)
- Template library (pre-built conversations, roles)
- Favorites marking
- Quick-access shortcuts

### Advanced Features (M7–M8)
- Sharing (public links, workspace-scoped, permissions)
- Export (JSON, Markdown, PDF)
- Import (restore from export, templates)
- AI memory (persistent context, user profile)
- File uploads (PDF, code, images, audio)
- Tool calling (OpenAI-style function calling)

### Collaboration (M9)
- Real-time presence (who's viewing)
- Shared conversations (multi-editor)
- Workspace-level sharing
- Activity logging (who changed what)
- Version history (revert to earlier states)

### Analytics & Polish (M10)
- Usage analytics (tokens, providers, cost)
- Conversation stats (message count, duration)
- Popular prompts / templates
- Performance optimization (caching, pagination)
- UI refinement (accessibility, responsiveness)

---

## Milestone Breakdown

### M1: Chat Schema & Core Infrastructure
**Duration:** 1 day

**Database Schema:**
- `Conversation`: workspace-scoped, with title, provider, model, settings
- `Message`: conversation messages with role (user/assistant/system), content, metadata
- `MessageBranch`: tracks alternative message paths (for regeneration/alternatives)
- `ConversationSettings`: streaming speed, temperature, max tokens, system prompt
- `StreamingJob`: tracks server-sent event streams for real-time updates
- Indexes on workspaceId, conversationId, createdAt for fast queries

**Backend Services:**
- `conversationService.ts`: create, read, update, delete conversations
- `messageService.ts`: append messages, handle branches, manage history
- `streamingService.ts`: SSE management, job tracking

**Routes:**
- `POST /api/workspaces/:id/conversations` - create conversation
- `GET /api/workspaces/:id/conversations` - list (paginated, search, filter)
- `GET /api/workspaces/:id/conversations/:conversationId` - get with history
- `PATCH /api/workspaces/:id/conversations/:conversationId` - update settings
- `DELETE /api/workspaces/:id/conversations/:conversationId` - archive

**Tests:** Full coverage for all services and routes

---

### M2: Chat Services & Message Flow
**Duration:** 1 day

**Services Enhanced:**
- Message creation with validation
- Branch handling (regenerate, explore alternatives)
- History retrieval with pagination
- Conversation search implementation
- Usage tracking integration (call `credit.service.recordUsage()`)

**API Routes Extended:**
- `POST /api/workspaces/:id/conversations/:conversationId/messages` - add message
- `POST /api/workspaces/:id/conversations/:conversationId/regenerate` - regenerate last message
- `POST /api/workspaces/:id/conversations/:conversationId/branch` - create alternative branch
- `GET /api/workspaces/:id/conversations/:conversationId/messages` - paginated history

**Tests:** Message flow, branching logic, history retrieval, error handling

---

### M3: Streaming Infrastructure
**Duration:** 1 day

**Backend:**
- Server-Sent Events (SSE) endpoint for real-time message streaming
- Job queue integration (Bull from M7, or synchronous if M7 not ready)
- Chunk-based message streaming (tokens as they arrive)
- Error handling and connection cleanup

**Frontend:**
- `useStreamingMessage.ts` hook: handle SSE connection, parse chunks
- Streaming display component: real-time token display
- Progress indicator for long-running generations
- Abort/cancel functionality

**Routes:**
- `POST /api/workspaces/:id/conversations/:conversationId/stream` - start streaming conversation

**Tests:** SSE handling, chunk parsing, error recovery, connection management

---

### M4: Chat UI - Core Interface
**Duration:** 1.5 days

**Pages:**
- `/dashboard/chat/[conversationId]` - main chat interface
- `/dashboard/chat` - conversation list / new chat

**Components:**
- `ChatMessage`: display single message (user/assistant/system), markdown, syntax highlighting
- `ChatInput`: message input with auto-resize, file attachments, send button
- `ChatSidebar`: conversation list, create new, search
- `ChatHeader`: conversation title, provider selector, model selector, settings
- `MessageActions`: regenerate, copy, edit, delete, branch
- `ProviderSelector`: dropdown to choose AI provider (provider-agnostic!)
- `ModelSelector`: dropdown to choose model within provider

**Frontend Libraries:**
- `react-markdown` for message rendering
- `react-syntax-highlighter` for code blocks
- `date-fns` for relative timestamps

**Hooks:**
- `useConversation()`: fetch conversation with history
- `useMessages()`: paginated message loading
- `useStreamingMessage()`: handle SSE updates

**Tests:** All components, hooks, state management, message rendering

---

### M5: Conversation History & Organization
**Duration:** 1 day

**Database Schema:**
- `ConversationFolder`: nested folders (like Project model)
- `ConversationTag`: tagging system
- Full-text search indexes on conversation title/description

**Services:**
- Folder creation/deletion (cascade to conversations)
- Tag management
- Search implementation (full-text, filters, sorting)
- Archive/restore logic

**Routes:**
- `POST /api/workspaces/:id/folders` - create folder
- `GET /api/workspaces/:id/folders` - list folders
- `PATCH /api/workspaces/:id/conversations/:id` - add to folder/tag
- `GET /api/workspaces/:id/conversations/search` - search conversations
- `POST /api/workspaces/:id/conversations/:id/archive` - archive
- `POST /api/workspaces/:id/conversations/:id/pin` - pin favorite

**Frontend:**
- `ConversationBrowser`: hierarchical folder view, tag filter
- `SearchConversations`: full-text search with filters
- `ConversationActions`: move to folder, tag, archive, pin

**Tests:** Folder hierarchy, search, filtering, archive/restore

---

### M6: Prompt & Template Libraries
**Duration:** 1 day

**Database Schema:**
- `PromptTemplate`: system prompts (name, content, category, tags, usage_count)
- `ConversationTemplate`: starter conversations with pre-built messages
- Relations to workspace for workspace-scoped templates
- Admin templates (shared across platform)

**Services:**
- Prompt library CRUD
- Template library CRUD
- Usage tracking for popular templates
- Favoriting logic

**Routes:**
- `GET /api/prompts/templates` - list templates (paginated, searchable)
- `POST /api/prompts/templates` - create custom template (workspace-scoped)
- `GET /api/prompts/system` - list system prompts
- `POST /api/workspaces/:id/conversations/from-template` - start conversation from template
- `GET /api/workspaces/:id/prompts` - workspace custom prompts

**Frontend:**
- `PromptLibrary`: browse system and custom prompts
- `TemplateLibrary`: browse and start from templates
- `PromptQuickAccess`: sidebar shortcuts to favorites
- `CreateFromTemplate`: modal to start conversation from template

**Tests:** Template CRUD, usage tracking, browsing

---

### M7: Sharing, Export, Import & AI Memory
**Duration:** 1.5 days

**Sharing:**
- `SharedConversation`: public share records with expiration
- Share permissions (read-only, read-write, revoke)
- Share links (public or workspace-specific)

**Export:**
- JSON export (full conversation with metadata)
- Markdown export (human-readable format)
- PDF export (styled version)

**Import:**
- Restore from JSON/Markdown
- Import as new conversation or merge

**AI Memory:**
- `AIMemory`: persistent user context (preferences, history, behavior)
- Injected into system prompts automatically
- Updated after each conversation
- Manual editing interface

**Routes:**
- `POST /api/workspaces/:id/conversations/:id/share` - create share link
- `GET /api/workspaces/:id/shares/:shareId` - access shared conversation
- `DELETE /api/workspaces/:id/shares/:shareId` - revoke share
- `POST /api/workspaces/:id/conversations/:id/export` - export conversation
- `POST /api/workspaces/:id/conversations/import` - import conversation
- `GET /api/workspaces/:id/memory` - get AI memory
- `PATCH /api/workspaces/:id/memory` - update AI memory

**Frontend:**
- `ShareDialog`: create and manage shares
- `ExportMenu`: choose export format
- `ImportDialog`: upload or paste to import
- `AIMemoryEditor`: edit persistent context

**Tests:** Sharing, exports, imports, memory management

---

### M8: File Uploads & Tool Calling
**Duration:** 1.5 days

**File Uploads:**
- Support PDF, images, audio, code, arbitrary files
- Multipart upload via existing storage abstraction
- File preview in chat (thumbnails, syntax highlighting)
- File references in messages (avoid re-uploading same file)

**Tool Calling:**
- OpenAI-style function calling support
- Tool definitions (name, description, parameters)
- Tool execution and result injection
- Provider-agnostic abstraction (some providers support it, some don't)

**Database:**
- `Tool`: tool definitions (provider-agnostic)
- `MessageAttachment`: file references in messages
- `ToolCall`: records of tool invocations

**Routes:**
- `POST /api/workspaces/:id/conversations/:id/upload` - upload file
- `GET /api/workspaces/:id/tools` - list available tools
- `POST /api/workspaces/:id/tools` - create custom tool
- `POST /api/workspaces/:id/conversations/:id/execute-tool` - call tool

**Frontend:**
- `FileUploadArea`: drag-and-drop file attachment
- `FilePreview`: display uploaded files in messages
- `ToolSelector`: choose tools to enable for conversation
- `ToolResultDisplay`: show tool execution results

**Tests:** File upload, attachment handling, tool calling, error handling

---

### M9: Workspace Collaboration
**Duration:** 1.5 days

**Real-time Presence:**
- WebSocket or Server-Sent Events for presence updates
- Show who's currently viewing/editing a conversation
- Last active timestamp
- User avatars in sidebar

**Shared Conversations:**
- Multiple users can edit same conversation simultaneously
- Optimistic updates with conflict resolution
- Activity log of edits
- Version history (revert to earlier states)

**Permissions:**
- Extend role-based permissions (VIEWER/MEMBER/EDITOR/ADMIN/OWNER)
- Apply to conversations and shared chats
- VIEWER: read-only, no edit
- MEMBER: can create own conversations
- EDITOR: can edit shared conversations
- ADMIN/OWNER: manage all

**Routes:**
- `POST /api/workspaces/:id/conversations/:id/add-collaborator` - add user
- `GET /api/workspaces/:id/conversations/:id/collaborators` - list
- `DELETE /api/workspaces/:id/conversations/:id/remove-collaborator` - remove
- `GET /api/workspaces/:id/conversations/:id/activity` - activity log
- `POST /api/workspaces/:id/conversations/:id/revert` - revert to earlier version

**Frontend:**
- `CollaboratorAvatars`: show active editors
- `ActivityLog`: timeline of changes
- `VersionHistory`: view and revert to earlier states
- `PresenceIndicator`: real-time "who's editing" display

**Tests:** Presence, collaboration, conflict resolution, versioning

---

### M10: Analytics & Polish
**Duration:** 1 day

**Analytics:**
- Usage dashboard: tokens spent, providers used, cost breakdown
- Conversation analytics: message count, duration, model performance
- Popular prompts and templates
- Trends over time (daily/weekly/monthly)

**Performance:**
- Message list pagination and virtualization
- Lazy-load old messages
- Cache conversation metadata
- Optimize search indexes
- CDN for file attachments

**UI Polish:**
- Accessibility audit (WCAG 2.1 AA)
- Mobile responsiveness (all components)
- Dark/light mode polish
- Loading states and skeletons
- Error boundaries
- Toast notifications for all actions

**Database:**
- Add query performance indexes
- Analyze slow queries
- Connection pooling tuning

**Routes:**
- `GET /api/workspaces/:id/analytics/usage` - usage stats
- `GET /api/workspaces/:id/analytics/conversations` - conversation stats

**Frontend:**
- `AnalyticsDashboard`: stats, charts, trends
- Performance monitoring
- Error logging

**Tests:** Analytics, performance, accessibility, all edge cases

---

## Non-Negotiable Principles (Inherited from SYNORA_BRAIN)

1. **Provider-agnostic everywhere** — AI, mail, storage all replaceable via config
2. **Workspace-scoped** — all operations require explicit `workspaceId`
3. **Production-grade** — no temporary code, no technical debt
4. **Tested** — every service/route has test coverage
5. **Secure** — permissions enforced at middleware, secrets never logged
6. **Scalable** — all models support millions of users with proper indexes

---

## Architecture Decisions (New to Release 3)

### Streaming Strategy
Use Server-Sent Events (SSE) over WebSockets initially (simpler, unidirectional works for now). WebSocket upgrade deferred to Release 4 if real-time co-editing becomes a bottleneck.

### Branching Model
Messages form a tree structure: each message can have siblings (alternatives from regeneration/branching). The `MessageBranch` model tracks which branch a message belongs to. This allows exploring alternatives without losing the main conversation thread.

### Search Implementation
Full-text search on PostgreSQL using `tsvector` and `tsquery` — no external search engine needed for MVP. If search becomes slow at scale, can migrate to Elasticsearch in Release 4.

### File Storage
Use existing storage abstraction (local FS for dev, S3-compatible in prod). Files attached to messages reference storage URLs, never embed content directly.

### Tool Calling
Support OpenAI-style function calling for providers that offer it (OpenAI, Anthropic via Claude 3.5). Gracefully degrade for providers that don't: let user provide feedback manually.

### AI Memory
Store as JSON in `AIMemory.context` — simple, queryable, fits in Postgres. Injected into system prompts at conversation start. Evolved over time as conversation patterns are learned.

---

## Definition of Done

For **each milestone**:
- ✅ Database schema migrated (if applicable)
- ✅ Backend services written and tested
- ✅ Routes implemented with permission checks
- ✅ Frontend components built and tested
- ✅ All tests passing (lint, typecheck, test, build)
- ✅ No regressions in existing features
- ✅ Documentation updated

For **Release 3 complete**:
- ✅ All M1–M10 implemented
- ✅ 100+ new tests passing (backend + frontend)
- ✅ CI gates green (lint, typecheck, test, docker, security)
- ✅ Deployment-ready Docker image
- ✅ Production-grade performance benchmarks
- ✅ Security audit complete (no new vulnerabilities)
- ✅ Full documentation (architecture.md, api.md, database.md updated)
- ✅ Commit and push to release branch

---

## Risks & Mitigation

1. **Streaming complexity** — SSE can be tricky; start with simple polling fallback
2. **Real-time conflicts** — Shared editing needs careful conflict resolution; use operational transformation or CRDTs if needed
3. **Search performance** — Full-text search might slow down with millions of conversations; add pagination and caching
4. **Storage quota** — Large file uploads can fill disk; implement per-workspace quotas
5. **AI provider rate limits** — Multiple concurrent users hitting same provider; add backpressure and queue if needed

---

## Next Steps

1. Create database migration for M1 schema
2. Implement M1 services and routes
3. Build M1 tests
4. Continue sequentially through M10
5. Final verification and documentation
6. Commit and push Release 3 to designated branch

---

**Estimated Start:** Now (2026-07-28)  
**Estimated Completion:** 2026-08-07 (10 days of focused work)  
**Estimated Commits:** 30-40 (1 per feature/fix, aggregated per milestone)

