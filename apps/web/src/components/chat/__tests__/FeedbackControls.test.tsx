/**
 * FeedbackControls tests.
 *
 * Covers the two things most likely to break silently: reflecting the
 * user's *persisted* vote after a reload (aria-pressed state), and
 * the exact payload sent on a thumb click — the backend upserts on
 * (messageId, userId), so a wrong feedbackType/flag combination
 * silently records the opposite of what the user clicked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FeedbackControls } from '../FeedbackControls';
import type { MessageFeedbackRecord } from '@/lib/api/feedback';

const createMessageFeedback = vi.fn();
const mockByMessageId = vi.fn<() => Map<string, MessageFeedbackRecord>>();
const invalidate = vi.fn();

vi.mock('@/lib/api/feedback', () => ({
  feedbackApi: {
    createMessageFeedback: (...args: unknown[]) => createMessageFeedback(...args),
  },
}));

vi.mock('@/hooks/useMyMessageFeedback', () => ({
  useMyMessageFeedback: () => ({ byMessageId: mockByMessageId() }),
  useInvalidateMyMessageFeedback: () => invalidate,
}));

// The report dialog has its own surface area; stub it so these tests
// stay focused on the thumbs.
vi.mock('../ReportProblemDialog', () => ({
  ReportProblemDialog: () => null,
}));

function renderControls() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <FeedbackControls
        workspaceId="ws"
        conversationId="c1"
        messageId="m1"
        messageContent="The answer is 42."
      />
    </QueryClientProvider>
  );
}

function record(partial: Partial<MessageFeedbackRecord>): MessageFeedbackRecord {
  return {
    id: 'f1',
    messageId: 'm1',
    conversationId: 'c1',
    workspaceId: 'ws',
    userId: 'u1',
    feedbackType: 'HELPFUL',
    createdAt: '2026-01-01T00:00:00Z',
    ...partial,
  };
}

describe('FeedbackControls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockByMessageId.mockReturnValue(new Map());
    createMessageFeedback.mockResolvedValue(record({}));
  });

  it('renders both thumbs unpressed when the user has no prior feedback', () => {
    renderControls();
    expect(screen.getByLabelText('Thumbs up')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByLabelText('Thumbs down')).toHaveAttribute('aria-pressed', 'false');
  });

  it('reflects a persisted thumbs-up after reload', () => {
    mockByMessageId.mockReturnValue(
      new Map([['m1', record({ thumbsUp: true, isHelpful: true })]])
    );
    renderControls();
    expect(screen.getByLabelText('Thumbs up')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Thumbs down')).toHaveAttribute('aria-pressed', 'false');
  });

  it('reflects a persisted thumbs-down after reload', () => {
    mockByMessageId.mockReturnValue(
      new Map([
        ['m1', record({ thumbsDown: true, isHelpful: false, feedbackType: 'UNHELPFUL' })],
      ])
    );
    renderControls();
    expect(screen.getByLabelText('Thumbs down')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Thumbs up')).toHaveAttribute('aria-pressed', 'false');
  });

  it('submits a HELPFUL payload when thumbs up is clicked', async () => {
    renderControls();
    fireEvent.click(screen.getByLabelText('Thumbs up'));

    await waitFor(() => expect(createMessageFeedback).toHaveBeenCalled());
    expect(createMessageFeedback).toHaveBeenCalledWith('ws', {
      messageId: 'm1',
      conversationId: 'c1',
      feedbackType: 'HELPFUL',
      isHelpful: true,
      thumbsUp: true,
      thumbsDown: false,
    });
  });

  it('submits an UNHELPFUL payload when thumbs down is clicked', async () => {
    renderControls();
    fireEvent.click(screen.getByLabelText('Thumbs down'));

    await waitFor(() => expect(createMessageFeedback).toHaveBeenCalled());
    expect(createMessageFeedback).toHaveBeenCalledWith('ws', {
      messageId: 'm1',
      conversationId: 'c1',
      feedbackType: 'UNHELPFUL',
      isHelpful: false,
      thumbsUp: false,
      thumbsDown: true,
    });
  });

  it('optimistically shows the new vote before the request settles', () => {
    renderControls();
    fireEvent.click(screen.getByLabelText('Thumbs up'));
    // No await — the pressed state must flip immediately, not after
    // the round-trip.
    expect(screen.getByLabelText('Thumbs up')).toHaveAttribute('aria-pressed', 'true');
  });

  it('invalidates the reflection cache after a successful submission', async () => {
    renderControls();
    fireEvent.click(screen.getByLabelText('Thumbs up'));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith('ws', 'c1'));
  });

  it('reverts the optimistic vote when the request fails', async () => {
    createMessageFeedback.mockRejectedValue(new Error('network down'));
    renderControls();

    fireEvent.click(screen.getByLabelText('Thumbs up'));
    expect(screen.getByLabelText('Thumbs up')).toHaveAttribute('aria-pressed', 'true');

    await waitFor(() =>
      expect(screen.getByLabelText('Thumbs up')).toHaveAttribute('aria-pressed', 'false')
    );
  });
});
