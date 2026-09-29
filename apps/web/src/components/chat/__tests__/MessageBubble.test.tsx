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
import { render, screen, fireEvent } from '@testing-library/react';
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

/**
 * Attachments, editing, and pinning were all backend-supported and
 * client-hooked but had no mounted UI at all: attachments rendered
 * nowhere, and the edit/pin hooks had zero callers. These pin the
 * wiring, including the rule that only user turns are editable.
 */
describe('MessageBubble attachments', () => {
  it('renders image and file attachments', () => {
    renderBubble({
      message: {
        ...baseAssistant,
        attachments: [
          {
            id: 'att-1',
            url: 'https://cdn.example.com/pic.png',
            mimeType: 'image/png',
            name: 'pic.png',
            size: 2048,
            createdAt: '2026-01-01T00:00:00Z',
          },
          {
            id: 'att-2',
            url: 'https://cdn.example.com/report.pdf',
            mimeType: 'application/pdf',
            name: 'report.pdf',
            size: 10240,
            createdAt: '2026-01-01T00:00:00Z',
          },
        ],
      },
      workspaceId: 'ws',
      conversationId: 'c',
    });

    expect(screen.getByAltText('pic.png')).toHaveAttribute(
      'src',
      'https://cdn.example.com/pic.png'
    );
    expect(screen.getByText('report.pdf')).toBeInTheDocument();
  });

  it('renders nothing extra when there are no attachments', () => {
    renderBubble({ message: baseAssistant, workspaceId: 'ws', conversationId: 'c' });
    expect(screen.queryByRole('img')).toBeNull();
  });
});

describe('MessageBubble edit and pin controls', () => {
  const userMessage: ConversationMessage = {
    id: 'u1',
    role: 'USER',
    content: 'What is the weather?',
    createdAt: '2026-01-01T00:00:00Z',
    parentId: null,
  };

  it('offers Edit on a user turn when an onEdited handler is wired', () => {
    renderBubble({
      message: userMessage,
      workspaceId: 'ws',
      conversationId: 'c',
      onEdited: vi.fn(),
    });
    expect(screen.getByLabelText('Edit message')).toBeInTheDocument();
  });

  // Rewriting an assistant bubble in place would leave the transcript
  // claiming the model said something it never said.
  it('never offers Edit on an assistant turn', () => {
    renderBubble({
      message: baseAssistant,
      workspaceId: 'ws',
      conversationId: 'c',
      onEdited: vi.fn(),
    });
    expect(screen.queryByLabelText('Edit message')).toBeNull();
  });

  it('swaps in the editor and back out on cancel', () => {
    renderBubble({
      message: userMessage,
      workspaceId: 'ws',
      conversationId: 'c',
      onEdited: vi.fn(),
    });

    fireEvent.click(screen.getByLabelText('Edit message'));
    const textarea = screen.getByDisplayValue('What is the weather?');
    expect(textarea).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.queryByDisplayValue('What is the weather?')).toBeNull();
  });

  it('labels the pin control by current state and marks pinned messages', () => {
    const { unmount } = renderBubble({
      message: userMessage,
      workspaceId: 'ws',
      conversationId: 'c',
    });
    expect(screen.getByLabelText('Pin message')).toBeInTheDocument();
    unmount();

    renderBubble({
      message: { ...userMessage, isPinned: true },
      workspaceId: 'ws',
      conversationId: 'c',
    });
    expect(screen.getByLabelText('Unpin message')).toBeInTheDocument();
    expect(screen.getByText('Pinned')).toBeInTheDocument();
  });

  it('hides edit and pin without workspace/conversation context', () => {
    renderBubble({ message: userMessage, onEdited: vi.fn() });
    expect(screen.queryByLabelText('Edit message')).toBeNull();
    expect(screen.queryByLabelText('Pin message')).toBeNull();
  });

  it('hides pin while the message is still streaming', () => {
    renderBubble({
      message: baseAssistant,
      workspaceId: 'ws',
      conversationId: 'c',
      isStreaming: true,
    });
    expect(screen.queryByLabelText('Pin message')).toBeNull();
  });
});

/**
 * Follow-up chips — one-click transformations of the last reply.
 *
 * The contract under test is PREFILL, NEVER AUTO-SEND: a chip hands the
 * container the exact plain-language instruction the person will see in
 * the composer, and nothing else happens. Whether the chips exist at all
 * is the container's decision (it passes onFollowUp only for the last
 * assistant message), so the bubble's own job is to gate them off
 * streaming, empty, and non-assistant turns.
 */
describe('MessageBubble follow-up chips', () => {
  it('passes the exact visible instruction to onFollowUp — and only that', () => {
    const onFollowUp = vi.fn();
    renderBubble({ message: baseAssistant, onFollowUp });

    fireEvent.click(screen.getByRole('button', { name: 'Simpler' }));

    // The instruction is ordinary words the person could have typed.
    // Anything appended beyond this would be a hidden prompt layer.
    expect(onFollowUp).toHaveBeenCalledTimes(1);
    expect(onFollowUp).toHaveBeenCalledWith(
      'Make that simpler — shorter sentences, no jargon.'
    );
  });

  it('offers exactly three chips: Simpler, More detail, Shorter', () => {
    renderBubble({ message: baseAssistant, onFollowUp: vi.fn() });
    expect(screen.getByRole('button', { name: 'Simpler' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More detail' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Shorter' })).toBeInTheDocument();
  });

  it('shows no chips when the container did not pass onFollowUp', () => {
    // The container passes the callback only for the LAST assistant
    // message — so its absence is the normal state for older replies.
    renderBubble({ message: baseAssistant });
    expect(screen.queryByRole('button', { name: 'Simpler' })).toBeNull();
  });

  it('shows no chips on user turns', () => {
    renderBubble({
      message: { ...baseAssistant, id: 'u9', role: 'USER', parentId: null },
      onFollowUp: vi.fn(),
    });
    expect(screen.queryByRole('button', { name: 'Simpler' })).toBeNull();
  });

  it('shows no chips while the reply is still streaming', () => {
    // A follow-up to half a response would read as a verdict on words
    // still arriving.
    renderBubble({ message: baseAssistant, isStreaming: true, onFollowUp: vi.fn() });
    expect(screen.queryByRole('button', { name: 'Simpler' })).toBeNull();
  });

  it('shows no chips on an empty (failed) reply', () => {
    renderBubble({ message: { ...baseAssistant, content: '' }, onFollowUp: vi.fn() });
    expect(screen.queryByRole('button', { name: 'Simpler' })).toBeNull();
  });
});
