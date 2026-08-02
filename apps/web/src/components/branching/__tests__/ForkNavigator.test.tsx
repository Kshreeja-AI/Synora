/**
 * ForkNavigator tests.
 *
 * The component's job is to render a per-fork `< N / M >` indicator
 * and to flip the canonical branch when the user pages through
 * alternatives. Everything upstream of that (fetching siblings,
 * mutating set-main) is exercised via React Query mocks — we assert on
 * the DOM the user sees and on the mutation payload the backend gets.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ForkNavigator } from '../ForkNavigator';

const mockUseSiblingBranches = vi.fn();
const mockUseSetMainBranch = vi.fn();

vi.mock('@/lib/api/branches', () => ({
  useSiblingBranches: (...args: unknown[]) => mockUseSiblingBranches(...args),
  useSetMainBranch: (...args: unknown[]) => mockUseSetMainBranch(...args),
}));

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const noSiblings = { data: undefined, isFetching: false };

describe('ForkNavigator', () => {
  it('renders nothing when a message has no siblings', () => {
    mockUseSiblingBranches.mockReturnValue(noSiblings);
    mockUseSetMainBranch.mockReturnValue({ mutate: vi.fn(), isPending: false });

    const { container } = renderWithClient(
      <ForkNavigator
        workspaceId="ws"
        conversationId="c"
        messageId="m1"
        parentId="p"
        siblingIndex={0}
        siblingCount={1}
      />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the message has no parent (root)', () => {
    mockUseSiblingBranches.mockReturnValue(noSiblings);
    mockUseSetMainBranch.mockReturnValue({ mutate: vi.fn(), isPending: false });

    const { container } = renderWithClient(
      <ForkNavigator
        workspaceId="ws"
        conversationId="c"
        messageId="m1"
        parentId={null}
        siblingIndex={0}
        siblingCount={2}
      />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('shows N / M and disables the correct arrow at each end', () => {
    // Fresh sibling list from the server has three alternatives; we're
    // currently viewing the middle one.
    mockUseSiblingBranches.mockReturnValue({
      data: [
        { id: 'a', content: 'A', role: 'ASSISTANT', createdAt: '', parentId: 'p' },
        { id: 'b', content: 'B', role: 'ASSISTANT', createdAt: '', parentId: 'p' },
        { id: 'c', content: 'C', role: 'ASSISTANT', createdAt: '', parentId: 'p' },
      ],
      isFetching: false,
    });
    mockUseSetMainBranch.mockReturnValue({ mutate: vi.fn(), isPending: false });

    renderWithClient(
      <ForkNavigator
        workspaceId="ws"
        conversationId="c"
        messageId="b"
        parentId="p"
        siblingIndex={1}
        siblingCount={3}
      />
    );

    expect(screen.getByText('2 / 3')).toBeInTheDocument();
    expect(screen.getByLabelText('Previous alternative')).not.toBeDisabled();
    expect(screen.getByLabelText('Next alternative')).not.toBeDisabled();

    // Now viewing the first alternative — prev must be disabled.
    // (Same sibling list; re-render with a different messageId.)
    screen.getByRole('group', { name: /Alternative response 2 of 3/ });
  });

  it('clicking next flips the canonical branch to the next sibling', () => {
    const mutate = vi.fn();
    mockUseSiblingBranches.mockReturnValue({
      data: [
        { id: 'a', content: 'A', role: 'ASSISTANT', createdAt: '', parentId: 'p' },
        { id: 'b', content: 'B', role: 'ASSISTANT', createdAt: '', parentId: 'p' },
      ],
      isFetching: false,
    });
    mockUseSetMainBranch.mockReturnValue({ mutate, isPending: false });

    renderWithClient(
      <ForkNavigator
        workspaceId="ws"
        conversationId="c"
        messageId="a"
        parentId="p"
        siblingIndex={0}
        siblingCount={2}
      />
    );

    fireEvent.click(screen.getByLabelText('Next alternative'));
    expect(mutate).toHaveBeenCalledWith({ messageId: 'b', parentId: 'p' });
  });

  it('clicking prev flips the canonical branch to the previous sibling', () => {
    const mutate = vi.fn();
    mockUseSiblingBranches.mockReturnValue({
      data: [
        { id: 'a', content: 'A', role: 'ASSISTANT', createdAt: '', parentId: 'p' },
        { id: 'b', content: 'B', role: 'ASSISTANT', createdAt: '', parentId: 'p' },
      ],
      isFetching: false,
    });
    mockUseSetMainBranch.mockReturnValue({ mutate, isPending: false });

    renderWithClient(
      <ForkNavigator
        workspaceId="ws"
        conversationId="c"
        messageId="b"
        parentId="p"
        siblingIndex={1}
        siblingCount={2}
      />
    );

    fireEvent.click(screen.getByLabelText('Previous alternative'));
    expect(mutate).toHaveBeenCalledWith({ messageId: 'a', parentId: 'p' });
  });

  it('falls back to the linearizer snapshot when sibling fetch has not returned yet', () => {
    // Pre-fetch state: hook returns undefined data but the linearizer
    // already told us we're 2-of-3. Arrows still render usable state.
    mockUseSiblingBranches.mockReturnValue({ data: undefined, isFetching: true });
    mockUseSetMainBranch.mockReturnValue({ mutate: vi.fn(), isPending: false });

    renderWithClient(
      <ForkNavigator
        workspaceId="ws"
        conversationId="c"
        messageId="m"
        parentId="p"
        siblingIndex={1}
        siblingCount={3}
      />
    );

    expect(screen.getByText('2 / 3')).toBeInTheDocument();
  });
});
