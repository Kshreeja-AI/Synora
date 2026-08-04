/**
 * Canvas page tests.
 *
 * The assertions worth having are the ones that keep the surface honest
 * about its own limits: a server refusal to move a block off the navigable
 * area reaches the user verbatim rather than as a generic failure, and the
 * page says plainly that dragging is not built yet rather than leaving
 * someone to discover it by trying.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CanvasPage from '../page';
import * as canvasApi from '@/lib/api/canvas';
import type { CanvasDocument } from '@/lib/api/canvas';

vi.mock('@/hooks/useCurrentWorkspace', () => ({
  useCurrentWorkspace: () => ({ currentWorkspace: { id: 'ws_1', name: 'Test Co' } }),
}));

vi.mock('@/lib/api/canvas', async () => {
  const actual = await vi.importActual<typeof canvasApi>('@/lib/api/canvas');
  return {
    ...actual,
    useCanvases: vi.fn(),
    useCanvas: vi.fn(),
    useCreateCanvas: vi.fn(),
    useArchiveCanvas: vi.fn(),
    useAddBlock: vi.fn(),
    useUpdateBlock: vi.fn(),
    useRemoveBlock: vi.fn(),
  };
});

const canvas: CanvasDocument = {
  id: 'canvas_1',
  workspaceId: 'ws_1',
  title: 'Launch plan',
  blocks: [
    {
      id: 'b1',
      kind: 'note',
      content: 'Ship on Friday',
      x: 0,
      y: 0,
      width: 240,
      height: 120,
      createdAt: 1,
      updatedAt: 1,
    },
  ],
  createdBy: 'u1',
  createdAt: 1,
  updatedAt: 1,
  archived: false,
};

function idle(overrides: Record<string, unknown> = {}) {
  return { mutate: vi.fn(), isPending: false, ...overrides };
}

/**
 * The list entry, addressed by role rather than by text: once a canvas is
 * open its title also appears as the pane heading, so a bare text query
 * matches two elements.
 */
function openCanvas(user: ReturnType<typeof userEvent.setup>) {
  return user.click(screen.getByRole('button', { name: /Launch plan/ }));
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CanvasPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(canvasApi.useCanvases).mockReturnValue({ data: [canvas], isLoading: false } as never);
  vi.mocked(canvasApi.useCanvas).mockReturnValue({ data: undefined } as never);
  vi.mocked(canvasApi.useCreateCanvas).mockReturnValue(idle() as never);
  vi.mocked(canvasApi.useArchiveCanvas).mockReturnValue(idle() as never);
  vi.mocked(canvasApi.useAddBlock).mockReturnValue(idle() as never);
  vi.mocked(canvasApi.useUpdateBlock).mockReturnValue(idle() as never);
  vi.mocked(canvasApi.useRemoveBlock).mockReturnValue(idle() as never);
});

describe('canvas page', () => {
  it('lists canvases with their block counts', async () => {
    renderPage();
    expect(await screen.findByRole('button', { name: /Launch plan/ })).toBeInTheDocument();
    expect(screen.getByText('1 block')).toBeInTheDocument();
  });

  it('shows an empty state before any canvas exists', async () => {
    vi.mocked(canvasApi.useCanvases).mockReturnValue({ data: [], isLoading: false } as never);
    renderPage();
    expect(await screen.findByText('No canvases yet')).toBeInTheDocument();
  });

  it('renders blocks at their stored positions', async () => {
    const user = userEvent.setup();
    vi.mocked(canvasApi.useCanvas).mockReturnValue({ data: canvas } as never);

    renderPage();
    await openCanvas(user);

    expect(screen.getByLabelText('note block')).toBeInTheDocument();
    expect(screen.getByLabelText(/Content of note block/)).toHaveValue('Ship on Friday');
  });

  it('nudges a block by a fixed step', async () => {
    const user = userEvent.setup();
    const update = vi.fn();
    vi.mocked(canvasApi.useCanvas).mockReturnValue({ data: canvas } as never);
    vi.mocked(canvasApi.useUpdateBlock).mockReturnValue(idle({ mutate: update }) as never);

    renderPage();
    await openCanvas(user);
    await user.click(screen.getByRole('button', { name: /move note block right/i }));

    expect(update).toHaveBeenCalledWith(
      { canvasId: 'canvas_1', blockId: 'b1', changes: { x: 20, y: 0 } },
      expect.anything(),
    );
  });

  it('says plainly that dragging is not built yet', async () => {
    const user = userEvent.setup();
    vi.mocked(canvasApi.useCanvas).mockReturnValue({ data: canvas } as never);

    renderPage();
    await openCanvas(user);

    // Better said than discovered by trying.
    expect(screen.getByText(/Dragging is not built yet/)).toBeInTheDocument();
  });

  it('tells the user when the server refuses a move', async () => {
    const user = userEvent.setup();
    const { toast } = await import('sonner');
    const toastError = vi.spyOn(toast, 'error');
    vi.mocked(canvasApi.useCanvas).mockReturnValue({ data: canvas } as never);
    vi.mocked(canvasApi.useUpdateBlock).mockReturnValue(
      idle({
        mutate: vi.fn((_v, opts) =>
          opts?.onError?.(
            new Error('x must be within ±100000; a block outside the surface cannot be found again'),
          ),
        ),
      }) as never,
    );

    renderPage();
    await openCanvas(user);
    await user.click(screen.getByRole('button', { name: /move note block right/i }));

    expect(toastError).toHaveBeenCalledWith(expect.stringContaining('cannot be found again'));
  });

  it('shows an empty canvas prompt rather than a blank area', async () => {
    const user = userEvent.setup();
    vi.mocked(canvasApi.useCanvas).mockReturnValue({
      data: { ...canvas, blocks: [] },
    } as never);

    renderPage();
    await openCanvas(user);
    expect(screen.getByText(/Empty canvas/)).toBeInTheDocument();
  });
});
