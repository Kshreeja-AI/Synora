/**
 * MessageBubble tests.
 *
 * The bubble itself is trivial layout — what matters is the *gating*
 * of the branch controls (ForkNavigator + CreateBranchButton). Those
 * were the very things that were built-but-never-mounted before this
 * subsystem rebuild; a regression means the branching UX silently
 * disappears again.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MessageBubble } from '../MessageBubble';
import type { ConversationMessage } from '@/lib/api/messages';

// The two branch controls have their own tests — stub them out here so
// we can assert *on their presence* without pulling in their internal
// data-fetching contracts.
vi.mock('@/components/branching/ForkNavigator', () => ({
  ForkNavigator: () => <div data-testid="fork-navigator" />,
}));
vi.mock('@/components/branching/CreateBranchButton', () => ({
  CreateBranchButton: () => <button data-testid="branch-button">Branch</button>,
}));

function renderBubble(props: Partial<Parameters<typeof MessageBubble>[0]> & {
  message: ConversationMessage;
}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MessageBubble {...props} message={props.message} />
    </QueryClientProvider>
  );
}

const baseAssistant: ConversationMessage = {
  id: 'a1',
  role: 'ASSISTANT',
  content: 'Hello!',
  createdAt: '2026-01-01T00:00:00Z',
  parentId: 'u1',
  siblingCount: 1,
  siblingIndex: 0,
};

describe('MessageBubble branch controls', () => {
  it('does not render branch controls when workspace/conversation context is missing', () => {
    renderBubble({ message: { ...baseAssistant, siblingCount: 3, siblingIndex: 1 } });
    expect(screen.queryByTestId('fork-navigator')).toBeNull();
    expect(screen.queryByTestId('branch-button')).toBeNull();
  });

  it('renders the branch button on assistant messages with a parent', () => {
    renderBubble({
      message: baseAssistant,
      workspaceId: 'ws',
      conversationId: 'c',
    });
    expect(screen.getByTestId('branch-button')).toBeInTheDocument();
  });

  it('hides the branch button on user messages', () => {
    renderBubble({
      message: {
        ...baseAssistant,
        id: 'u1',
        role: 'USER',
        content: 'Hi',
        parentId: null,
      },
      workspaceId: 'ws',
      conversationId: 'c',
    });
    expect(screen.queryByTestId('branch-button')).toBeNull();
  });

  it('hides the branch button on the root assistant message (no parent)', () => {
    renderBubble({
      message: { ...baseAssistant, parentId: null },
      workspaceId: 'ws',
      conversationId: 'c',
    });
    expect(screen.queryByTestId('branch-button')).toBeNull();
  });

  it('hides the branch button while the message is streaming', () => {
    renderBubble({
      message: baseAssistant,
      workspaceId: 'ws',
      conversationId: 'c',
      isStreaming: true,
    });
    expect(screen.queryByTestId('branch-button')).toBeNull();
  });

  it('renders the fork navigator when the message has siblings', () => {
    renderBubble({
      message: { ...baseAssistant, siblingCount: 3, siblingIndex: 1 },
      workspaceId: 'ws',
      conversationId: 'c',
    });
    expect(screen.getByTestId('fork-navigator')).toBeInTheDocument();
  });

  it('hides the fork navigator when the message is the only sibling', () => {
    renderBubble({
      message: baseAssistant,
      workspaceId: 'ws',
      conversationId: 'c',
    });
    expect(screen.queryByTestId('fork-navigator')).toBeNull();
  });
});
