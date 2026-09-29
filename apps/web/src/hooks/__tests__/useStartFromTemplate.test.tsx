/**
 * useStartFromTemplate pins the "Use Template" contract: create the
 * conversation, seed the template's system prompt as a SYSTEM message,
 * then navigate to the chat. The template's initialUserMessage must NOT
 * be posted — that would start a generation whose stream nobody is
 * subscribed to once this page navigates away.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useStartFromTemplate } from '../useStartFromTemplate';
import type { Template } from '@/lib/api/templates';

const mockPost = vi.fn();
const mockPush = vi.fn();
const mockInvalidate = vi.fn();

vi.mock('@/lib/api/client', () => ({
  api: { post: (...args: unknown[]) => mockPost(...args) },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidate }),
}));

const template: Template = {
  id: 'tpl-1',
  workspaceId: 'ws-1',
  title: 'Design review',
  description: 'Review a design doc',
  category: 'analysis',
  systemPrompt: 'You are a staff engineer.',
  initialUserMessage: 'Here is my doc',
  suggestedFollowUps: ['What are the failure modes?'],
  isPublic: false,
  createdBy: 'u-1',
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
} as Template;

describe('useStartFromTemplate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvalidate.mockResolvedValue(undefined);
  });

  it('creates the conversation, seeds the system prompt, and navigates', async () => {
    mockPost
      .mockResolvedValueOnce({ id: 'conv-1', title: 'Design review' })
      .mockResolvedValueOnce({});

    const { result } = renderHook(() => useStartFromTemplate('ws-1'));
    await act(async () => {
      await result.current.start(template);
    });

    expect(mockPost).toHaveBeenNthCalledWith(1, '/api/workspaces/ws-1/conversations', {
      title: 'Design review',
      description: 'Review a design doc',
      provider: 'anthropic',
      model: 'claude-sonnet-5',
    });
    expect(mockPost).toHaveBeenNthCalledWith(
      2,
      '/api/workspaces/ws-1/conversations/conv-1/messages',
      { content: 'You are a staff engineer.', role: 'SYSTEM' }
    );
    expect(mockPost).toHaveBeenCalledTimes(2);
    expect(mockPush).toHaveBeenCalledWith('/conversations/conv-1');
  });

  it('never posts the template initialUserMessage as a USER message', async () => {
    mockPost.mockResolvedValueOnce({ id: 'conv-1' }).mockResolvedValueOnce({});

    const { result } = renderHook(() => useStartFromTemplate('ws-1'));
    await act(async () => {
      await result.current.start(template);
    });

    const userPosts = mockPost.mock.calls.filter(
      (call) => (call[1] as { role?: string })?.role === 'USER'
    );
    expect(userPosts).toHaveLength(0);
  });

  it('skips the seed message when the template has no system prompt', async () => {
    mockPost.mockResolvedValueOnce({ id: 'conv-2' });

    const { result } = renderHook(() => useStartFromTemplate('ws-1'));
    await act(async () => {
      await result.current.start({ ...template, systemPrompt: '' } as Template);
    });

    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/conversations/conv-2');
  });

  it('surfaces a failure and does not navigate', async () => {
    mockPost.mockRejectedValueOnce(new Error('Workspace not found'));

    const { result } = renderHook(() => useStartFromTemplate('ws-1'));
    await act(async () => {
      await result.current.start(template);
    });

    expect(result.current.error).toBe('Workspace not found');
    expect(result.current.startingId).toBeNull();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('does nothing without an active workspace', async () => {
    const { result } = renderHook(() => useStartFromTemplate(''));
    await act(async () => {
      await result.current.start(template);
    });

    expect(mockPost).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });
});
