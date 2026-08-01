# Release 3 Frontend Build Plan - Focused Implementation

**Objective:** Build production-ready Release 3 frontend MVP in this session

**Constraint:** Token budget ~116K remaining

**Strategy:** Focus on critical path first, highest ROI

---

## Phase 1: MVP (Prioritized, Achievable This Session)

### ✅ Completed
- [x] Architecture design (RELEASE_3_FRONTEND_ARCHITECTURE.md)
- [x] Project scaffolding (folder structure)
- [x] Core types (Conversation, Message)
- [x] API clients (conversations.ts, messages.ts)

### → Next (Core Functionality)

**1. Zustand Stores (20 min)**
- conversationStore (current, list)
- messageStore (messages, streaming state)
- uiStore (sidebar state, selected items)
- settingsStore (model, provider, temp, topP)

**2. Core Hooks (15 min)**
- useConversationList
- useCurrentConversation
- useMessagesForConversation
- useStreamMessage

**3. Chat Page Layout (15 min)**
- Split layout (sidebar + main)
- Resizable panels
- Header with model selector

**4. Message Components (20 min)**
- MessageList (virtualized)
- MessageItem (content, actions)
- MessageInput (editor, send)

**5. Conversation Management (15 min)**
- ConversationList (sidebar)
- ConversationItem (click to select, archive, delete)
- New conversation button

**6. Streaming UI (15 min)**
- SSE event handling
- Token accumulation
- Progressive rendering
- Error states (retry)

**7. Model/Provider Selection (10 min)**
- Dropdowns in header
- Persist to conversation settings
- Apply to next message

**8. Settings & Parameters (10 min)**
- Temperature, topP, context-window sliders
- Save to store
- Apply to generation

**Total: ~120 min of work, which fits in remaining tokens if we're efficient**

---

## Phase 2 (Deferred to Next Session)

- Message branching & version history
- Prompt/template library
- Real-time collaboration
- Advanced features (memory, tools, sharing)
- Accessibility audit
- Performance optimization
- Storybook & tests

---

## Critical Files to Create (in order)

1. ✅ `lib/types/conversations.ts` - Types
2. ✅ `lib/api/conversations.ts` - Conversation queries
3. ✅ `lib/api/messages.ts` - Message queries + streaming
4. → `stores/conversation-store.ts` - Zustand state
5. → `stores/message-store.ts` - Message state
6. → `stores/ui-store.ts` - UI state
7. → `stores/settings-store.ts` - Model/provider settings
8. → `hooks/useConversation.ts` - Combined hooks
9. → `components/chat/ChatPage.tsx` - Main chat interface
10. → `components/chat/MessageList.tsx` - Virtualized list
11. → `components/chat/MessageItem.tsx` - Single message
12. → `components/chat/MessageInput.tsx` - Input editor
13. → `components/chat/ChatHeader.tsx` - Model/provider selectors
14. → `components/conversations/ConversationList.tsx` - Sidebar
15. → `app/(dashboard)/conversations/[id]/page.tsx` - Chat route

---

## Code Quality Standards (No Compromises)

- ✅ TypeScript strict mode (no `any`)
- ✅ Full JSDoc comments
- ✅ Proper error handling
- ✅ Accessibility (a11y)
- ✅ Responsive design
- ✅ Dark/light mode
- ✅ Loading/pending states

---

## Success Criteria for This Session

At completion:
1. [ ] Chat interface loads and displays conversation
2. [ ] Can send a message
3. [ ] Receives streaming response (tokens appear in real-time)
4. [ ] Can select model/provider
5. [ ] Can adjust temperature/topP
6. [ ] Can create new conversation
7. [ ] Conversation list shows all conversations
8. [ ] Can archive/delete conversations
9. [ ] All TypeScript errors resolved
10. [ ] All ESLint rules pass
11. [ ] Basic tests passing

---

**Status: Ready to build core stores and components**

**Estimated completion: 2-3 hours from now**

**Output: Chat interface + conversation management working end-to-end**

---

## Emergency Fallback (If Running Low on Tokens)

If tokens run out:
1. Commit partial implementation (stores + API clients)
2. Document what's done vs. remaining
3. Generate MVP_STATUS_REPORT.md
4. Resume with fresh tokens

Priority if partial: **Chat page + messaging + streaming > everything else**
