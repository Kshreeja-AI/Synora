/**
 * ShareDialog tests.
 *
 * The regression that motivated this rebuild: the old dialog sent
 * {permission, expiresIn} — keys the backend silently ignored, so
 * every share was created with defaults regardless of user choice.
 * These tests pin the exact payload shape so that can't recur.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ShareDialog } from '../ShareDialog';
import type { ShareLink } from '@/lib/api/sharing';

const createMutate = vi.fn();
const revokeMutate = vi.fn();
const mockShares = vi.fn<() => ShareLink[]>();

vi.mock('@/lib/api/sharing', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/sharing')>(
    '@/lib/api/sharing'
  );
  return {
    ...actual,
    useCreateShare: () => ({ mutate: createMutate, isPending: false }),
    useRevokeShare: () => ({ mutate: revokeMutate, isPending: false }),
    useConversationShares: () => ({ data: mockShares() }),
    getShareUrl: (token: string) => `http://app.test/share/${token}`,
  };
});

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ShareDialog
        open
        onOpenChange={vi.fn()}
        workspaceId="ws"
        conversationId="c1"
        conversationTitle="Quarterly plan"
      />
    </QueryClientProvider>
  );
}

describe('ShareDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockShares.mockReturnValue([]);
  });

  it('sends the exact backend payload shape on generate', () => {
    renderDialog();

    fireEvent.change(screen.getByLabelText('Permission Level'), {
      target: { value: 'EDIT' },
    });
    fireEvent.click(screen.getByText('Generate Link'));

    expect(createMutate).toHaveBeenCalledTimes(1);
    const [payload] = createMutate.mock.calls[0];
    // Keys must be exactly what the backend zod schema reads —
    // `permissions` (plural) and ISO `expiresAt`, never
    // `permission`/`expiresIn`.
    expect(payload.permissions).toBe('EDIT');
    expect(payload.isPublic).toBe(true);
    expect(payload.expiresAt).toBeUndefined(); // "never" default
    expect(payload).not.toHaveProperty('permission');
    expect(payload).not.toHaveProperty('expiresIn');
  });

  it('converts a selected expiry window to an ISO timestamp', () => {
    renderDialog();

    fireEvent.change(screen.getByLabelText('Link Expiration'), {
      target: { value: '7d' },
    });
    fireEvent.click(screen.getByText('Generate Link'));

    const [payload] = createMutate.mock.calls[0];
    expect(typeof payload.expiresAt).toBe('string');
    const expires = new Date(payload.expiresAt).getTime();
    const sevenDays = Date.now() + 7 * 24 * 60 * 60 * 1000;
    // Within a minute of the expected instant.
    expect(Math.abs(expires - sevenDays)).toBeLessThan(60_000);
  });

  it('shows the frontend share URL after a link is created', () => {
    createMutate.mockImplementation((_input, opts) => {
      opts?.onSuccess?.({
        id: 's1',
        conversationId: 'c1',
        shareToken: 'tok123',
        permissions: 'VIEW',
        isPublic: true,
        createdAt: '2026-01-01T00:00:00Z',
      });
    });
    renderDialog();

    fireEvent.click(screen.getByText('Generate Link'));
    expect(screen.getByDisplayValue('http://app.test/share/tok123')).toBeInTheDocument();
  });

  it('lists existing links and revokes on click', () => {
    mockShares.mockReturnValue([
      {
        id: 's1',
        conversationId: 'c1',
        shareToken: 'tok-a',
        permissions: 'VIEW',
        isPublic: true,
        expiresAt: null,
        createdAt: '2026-01-01T00:00:00Z',
      },
    ]);
    renderDialog();

    expect(screen.getByText(/Active links \(1\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Revoke share link'));
    expect(revokeMutate).toHaveBeenCalledWith('s1');
  });

  it('only offers permissions the backend accepts', () => {
    renderDialog();
    const select = screen.getByLabelText('Permission Level') as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(['VIEW', 'COMMENT', 'EDIT']);
    expect(values).not.toContain('MANAGE');
  });
});
