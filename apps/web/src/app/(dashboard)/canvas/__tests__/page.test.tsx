/**
 * Canvas page tests.
 *
 * The assertions worth having are the ones that keep the surface honest: a
 * server refusal to move a block off the navigable area reaches the user
 * verbatim rather than as a generic failure, a drag writes once on release
 * rather than per pixel, and the keyboard path keeps working alongside the
 * pointer one.
 *
 * DRAGS ARE DRIVEN WITH MouseEvent, NOT PointerEvent, because jsdom does
 * not implement the latter. React dispatches on the event's type string,
 * so a MouseEvent named `pointermove` reaches `onPointerMove` carrying
 * real clientX/clientY — which is the part these tests actually need.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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
    useCanvasLinks: vi.fn(),
    useCreateCanvas: vi.fn(),
    useArchiveCanvas: vi.fn(),
    useAddBlock: vi.fn(),
    useUpdateBlock: vi.fn(),
    useRemoveBlock: vi.fn(),
    useConnectBlocks: vi.fn(),
    useDisconnectBlocks: vi.fn(),
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

function pointerEvent(type: string, clientX: number, clientY: number): MouseEvent {
  return new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY, button: 0 });
}

/** Press on the handle, travel, release. One gesture, as a user makes it. */
function dragBy(handle: Element, dx: number, dy: number) {
  fireEvent(handle, pointerEvent('pointerdown', 100, 100));
  fireEvent(handle, pointerEvent('pointermove', 100 + dx, 100 + dy));
  fireEvent(handle, pointerEvent('pointerup', 100 + dx, 100 + dy));
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
  vi.mocked(canvasApi.useCanvasLinks).mockReturnValue({ data: [] } as never);
  vi.mocked(canvasApi.useCreateCanvas).mockReturnValue(idle() as never);
  vi.mocked(canvasApi.useArchiveCanvas).mockReturnValue(idle() as never);
  vi.mocked(canvasApi.useAddBlock).mockReturnValue(idle() as never);
  vi.mocked(canvasApi.useUpdateBlock).mockReturnValue(idle() as never);
  vi.mocked(canvasApi.useRemoveBlock).mockReturnValue(idle() as never);
  vi.mocked(canvasApi.useConnectBlocks).mockReturnValue(idle() as never);
  vi.mocked(canvasApi.useDisconnectBlocks).mockReturnValue(idle() as never);
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

  describe('dragging', () => {
    it('moves a block to where it was dropped, snapped to the grid, in one request', async () => {
      const user = userEvent.setup();
      const update = vi.fn();
      vi.mocked(canvasApi.useCanvas).mockReturnValue({ data: canvas } as never);
      vi.mocked(canvasApi.useUpdateBlock).mockReturnValue(idle({ mutate: update }) as never);

      renderPage();
      await openCanvas(user);
      dragBy(screen.getByRole('button', { name: /drag note block/i }), 48, 7);

      // Once, on release — not once per pixel travelled. Writing every
      // intermediate position would be a request storm whose responses
      // could land out of order, leaving the block somewhere nobody
      // dropped it.
      expect(update).toHaveBeenCalledTimes(1);
      expect(update).toHaveBeenCalledWith(
        { canvasId: 'canvas_1', blockId: 'b1', changes: { x: 40, y: 0 } },
        expect.anything(),
      );
    });

    it('writes nothing when the pointer only wobbles', async () => {
      const user = userEvent.setup();
      const update = vi.fn();
      vi.mocked(canvasApi.useCanvas).mockReturnValue({ data: canvas } as never);
      vi.mocked(canvasApi.useUpdateBlock).mockReturnValue(idle({ mutate: update }) as never);

      renderPage();
      await openCanvas(user);
      dragBy(screen.getByRole('button', { name: /drag note block/i }), 2, 1);

      // A click that shifted two pixels is a click, and it should not
      // reach the server or fill the undo history.
      expect(update).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: /nothing to undo/i })).toBeDisabled();
    });

    it('translates pointer distance through the zoom level', async () => {
      const user = userEvent.setup();
      const update = vi.fn();
      vi.mocked(canvasApi.useCanvas).mockReturnValue({ data: canvas } as never);
      vi.mocked(canvasApi.useUpdateBlock).mockReturnValue(idle({ mutate: update }) as never);

      renderPage();
      await openCanvas(user);
      await user.click(screen.getByRole('button', { name: /zoom out/i }));
      expect(screen.getByText('80%')).toBeInTheDocument();

      // At 80%, 60 screen pixels is 75 canvas pixels, which snaps to 80.
      // Taking the raw 60 would leave the block trailing the pointer.
      dragBy(screen.getByRole('button', { name: /drag note block/i }), 60, 0);

      expect(update).toHaveBeenCalledWith(
        { canvasId: 'canvas_1', blockId: 'b1', changes: { x: 80, y: 0 } },
        expect.anything(),
      );
    });

    it('counts a whole drag as one undo step, back to where the block started', async () => {
      const user = userEvent.setup();
      const update = vi.fn((_v, opts) => opts?.onSuccess?.());
      vi.mocked(canvasApi.useCanvas).mockReturnValue({ data: canvas } as never);
      vi.mocked(canvasApi.useUpdateBlock).mockReturnValue(idle({ mutate: update }) as never);

      renderPage();
      await openCanvas(user);
      dragBy(screen.getByRole('button', { name: /drag note block/i }), 120, 60);

      // Named the same way a nudge is named: which input was used to move
      // the block is not something the undo button should make you think
      // about.
      await user.click(
        await screen.findByRole('button', { name: /undo moving the note block/i }),
      );

      expect(update).toHaveBeenLastCalledWith(
        { canvasId: 'canvas_1', blockId: 'b1', changes: { x: 0, y: 0 } },
        expect.anything(),
      );
    });

    it('tells the user when the server refuses a dropped position', async () => {
      const user = userEvent.setup();
      const { toast } = await import('sonner');
      const toastError = vi.spyOn(toast, 'error');
      vi.mocked(canvasApi.useCanvas).mockReturnValue({ data: canvas } as never);
      vi.mocked(canvasApi.useUpdateBlock).mockReturnValue(
        idle({
          mutate: vi.fn((_v, opts) =>
            opts?.onError?.(
              new Error(
                'x must be within ±100000; a block outside the surface cannot be found again',
              ),
            ),
          ),
        }) as never,
      );

      renderPage();
      await openCanvas(user);
      dragBy(screen.getByRole('button', { name: /drag note block/i }), 90, 0);

      expect(toastError).toHaveBeenCalledWith(expect.stringContaining('cannot be found again'));
    });

    it('carries every selected block, keeping the arrangement', async () => {
      const user = userEvent.setup();
      const update = vi.fn();
      const twoBlocks = {
        ...canvas,
        blocks: [canvas.blocks[0], { ...canvas.blocks[0], id: 'b2', x: 100, y: 40 }],
      };
      vi.mocked(canvasApi.useCanvas).mockReturnValue({ data: twoBlocks } as never);
      vi.mocked(canvasApi.useUpdateBlock).mockReturnValue(idle({ mutate: update }) as never);

      renderPage();
      await openCanvas(user);
      for (const box of screen.getAllByRole('checkbox', { name: /select note block/i })) {
        await user.click(box);
      }
      dragBy(screen.getAllByRole('button', { name: /drag note block/i })[0], 60, 0);

      // The same offset for both, snapped from the grabbed block — pulling
      // each onto its own grid point would deform an arrangement somebody
      // deliberately made.
      expect(update).toHaveBeenCalledTimes(2);
      expect(update).toHaveBeenCalledWith(
        { canvasId: 'canvas_1', blockId: 'b1', changes: { x: 60, y: 0 } },
        expect.anything(),
      );
      expect(update).toHaveBeenCalledWith(
        { canvasId: 'canvas_1', blockId: 'b2', changes: { x: 160, y: 40 } },
        expect.anything(),
      );
    });

    it('moves only the grabbed block when it is not part of the selection', async () => {
      const user = userEvent.setup();
      const update = vi.fn();
      const twoBlocks = {
        ...canvas,
        blocks: [canvas.blocks[0], { ...canvas.blocks[0], id: 'b2', x: 100, y: 40 }],
      };
      vi.mocked(canvasApi.useCanvas).mockReturnValue({ data: twoBlocks } as never);
      vi.mocked(canvasApi.useUpdateBlock).mockReturnValue(idle({ mutate: update }) as never);

      renderPage();
      await openCanvas(user);
      // Only the second block is selected; the first is the one dragged.
      await user.click(screen.getAllByRole('checkbox', { name: /select note block/i })[1]);
      dragBy(screen.getAllByRole('button', { name: /drag note block/i })[0], 60, 0);

      // Having a selection must not make every other block un-draggable,
      // and must not drag along a selection set up for something else.
      expect(update).toHaveBeenCalledTimes(1);
      expect(update).toHaveBeenCalledWith(
        { canvasId: 'canvas_1', blockId: 'b1', changes: { x: 60, y: 0 } },
        expect.anything(),
      );
    });

    it('undoes a group move in one press, to where each block actually was', async () => {
      const user = userEvent.setup();
      const update = vi.fn();
      const twoBlocks = {
        ...canvas,
        blocks: [canvas.blocks[0], { ...canvas.blocks[0], id: 'b2', x: 100, y: 40 }],
      };
      vi.mocked(canvasApi.useCanvas).mockReturnValue({ data: twoBlocks } as never);
      vi.mocked(canvasApi.useUpdateBlock).mockReturnValue(idle({ mutate: update }) as never);

      renderPage();
      await openCanvas(user);
      for (const box of screen.getAllByRole('checkbox', { name: /select note block/i })) {
        await user.click(box);
      }
      dragBy(screen.getAllByRole('button', { name: /drag note block/i })[0], 60, 0);
      update.mockClear();

      // One action, one press to reverse it — not one press per block.
      await user.click(await screen.findByRole('button', { name: /undo moving 2 blocks/i }));

      expect(update).toHaveBeenCalledTimes(2);
      expect(update).toHaveBeenCalledWith(
        { canvasId: 'canvas_1', blockId: 'b1', changes: { x: 0, y: 0 } },
        expect.anything(),
      );
      expect(update).toHaveBeenCalledWith(
        { canvasId: 'canvas_1', blockId: 'b2', changes: { x: 100, y: 40 } },
        expect.anything(),
      );
    });

    it('nudges the whole selection too, not just the drag path', async () => {
      const user = userEvent.setup();
      const update = vi.fn();
      const twoBlocks = {
        ...canvas,
        blocks: [canvas.blocks[0], { ...canvas.blocks[0], id: 'b2', x: 100, y: 40 }],
      };
      vi.mocked(canvasApi.useCanvas).mockReturnValue({ data: twoBlocks } as never);
      vi.mocked(canvasApi.useUpdateBlock).mockReturnValue(idle({ mutate: update }) as never);

      renderPage();
      await openCanvas(user);
      for (const box of screen.getAllByRole('checkbox', { name: /select note block/i })) {
        await user.click(box);
      }
      await user.click(screen.getAllByRole('button', { name: /move note block right/i })[0]);

      // Grouping that only worked with a pointer would be grouping the
      // keyboard path cannot reach.
      expect(update).toHaveBeenCalledTimes(2);
    });

    it('says how many blocks are selected, and lets them be released', async () => {
      const user = userEvent.setup();
      vi.mocked(canvasApi.useCanvas).mockReturnValue({ data: canvas } as never);

      renderPage();
      await openCanvas(user);
      await user.click(screen.getByRole('checkbox', { name: /select note block/i }));

      expect(screen.getByText(/1 selected — move or delete them together/)).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /clear selection/i }));
      expect(
        screen.queryByText(/selected — move or delete them together/),
      ).not.toBeInTheDocument();
    });

    it('deletes every selected block in one action', async () => {
      const user = userEvent.setup();
      const twoBlocks = {
        ...canvas,
        blocks: [canvas.blocks[0], { ...canvas.blocks[0], id: 'b2', x: 100, y: 40 }],
      };
      const removeAsync = vi.fn().mockResolvedValue(undefined);
      vi.mocked(canvasApi.useCanvas).mockReturnValue({ data: twoBlocks } as never);
      vi.mocked(canvasApi.useRemoveBlock).mockReturnValue(
        idle({ mutateAsync: removeAsync }) as never,
      );

      renderPage();
      await openCanvas(user);
      for (const box of screen.getAllByRole('checkbox', { name: /select note block/i })) {
        await user.click(box);
      }
      await user.click(screen.getByRole('button', { name: /delete selected/i }));

      expect(removeAsync).toHaveBeenCalledTimes(2);
      expect(removeAsync).toHaveBeenCalledWith({ canvasId: 'canvas_1', blockId: 'b1' });
      expect(removeAsync).toHaveBeenCalledWith({ canvasId: 'canvas_1', blockId: 'b2' });
      // Deleted blocks can no longer be a stale part of a selection.
      expect(screen.queryByText(/selected — move or delete them together/)).not.toBeInTheDocument();
    });

    it('undoes a group delete in one press, restoring every block and the line between them', async () => {
      const user = userEvent.setup();
      const withConnection = {
        ...canvas,
        blocks: [canvas.blocks[0], { ...canvas.blocks[0], id: 'b2', content: 'Other', x: 300 }],
        connections: [{ id: 'c1', from: 'b1', to: 'b2', createdAt: 1 }],
      };
      const removeAsync = vi.fn().mockResolvedValue(undefined);
      const addAsync = vi
        .fn()
        .mockResolvedValueOnce({ ...withConnection.blocks[0], id: 'b1_new' })
        .mockResolvedValueOnce({ ...withConnection.blocks[1], id: 'b2_new' });
      const connectAsync = vi.fn().mockResolvedValue(undefined);
      vi.mocked(canvasApi.useCanvas).mockReturnValue({ data: withConnection } as never);
      vi.mocked(canvasApi.useRemoveBlock).mockReturnValue(
        idle({ mutateAsync: removeAsync }) as never,
      );
      vi.mocked(canvasApi.useAddBlock).mockReturnValue(idle({ mutateAsync: addAsync }) as never);
      vi.mocked(canvasApi.useConnectBlocks).mockReturnValue(
        idle({ mutateAsync: connectAsync }) as never,
      );

      renderPage();
      await openCanvas(user);
      for (const box of screen.getAllByRole('checkbox', { name: /select note block/i })) {
        await user.click(box);
      }
      await user.click(screen.getByRole('button', { name: /delete selected/i }));

      // One action, one press to reverse it — not one press per block.
      await user.click(await screen.findByRole('button', { name: /undo deleting 2 blocks/i }));

      expect(addAsync).toHaveBeenCalledTimes(2);
      // The connection between them comes back too, re-pointed at both new
      // ids — restoring a lonely pair of blocks with the line between them
      // quietly dropped would still be losing part of the structure.
      expect(connectAsync).toHaveBeenCalledWith(
        expect.objectContaining({ from: 'b1_new', to: 'b2_new' }),
      );
    });

    it('keeps the keyboard path alongside the pointer one', async () => {
      const user = userEvent.setup();
      vi.mocked(canvasApi.useCanvas).mockReturnValue({ data: canvas } as never);

      renderPage();
      await openCanvas(user);

      // A drag is unreachable without a pointer. Removing the arrow
      // buttons once dragging existed would have taken the canvas away
      // from anyone working by keyboard.
      expect(screen.getByRole('button', { name: /drag note block/i })).toBeInTheDocument();
      for (const dir of [/move note block left/i, /move note block right/i]) {
        expect(screen.getByRole('button', { name: dir })).toBeInTheDocument();
      }
      expect(screen.getByText(/if you are working from the keyboard/i)).toBeInTheDocument();
    });
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

  describe('the viewport', () => {
    it('zooms in and out within bounds, and shows the level', async () => {
      const user = userEvent.setup();
      vi.mocked(canvasApi.useCanvas).mockReturnValue({ data: canvas } as never);

      renderPage();
      await openCanvas(user);
      expect(screen.getByText('100%')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /zoom in/i }));
      expect(screen.getByText('120%')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /zoom out/i }));
      await user.click(screen.getByRole('button', { name: /zoom out/i }));
      expect(screen.getByText('80%')).toBeInTheDocument();
    });

    it('resets zoom and pan together', async () => {
      const user = userEvent.setup();
      vi.mocked(canvasApi.useCanvas).mockReturnValue({ data: canvas } as never);

      renderPage();
      await openCanvas(user);
      await user.click(screen.getByRole('button', { name: /zoom in/i }));
      await user.click(screen.getByRole('button', { name: /pan right/i }));
      await user.click(screen.getByRole('button', { name: /reset view/i }));

      expect(screen.getByText('100%')).toBeInTheDocument();
    });

    it('offers panning in four directions', async () => {
      const user = userEvent.setup();
      vi.mocked(canvasApi.useCanvas).mockReturnValue({ data: canvas } as never);

      renderPage();
      await openCanvas(user);
      for (const label of [/pan left/i, /pan right/i, /pan up/i, /pan down/i]) {
        expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
      }
    });
  });

  describe('undo', () => {
    it('says there is nothing to undo before anything happens', async () => {
      const user = userEvent.setup();
      vi.mocked(canvasApi.useCanvas).mockReturnValue({ data: canvas } as never);

      renderPage();
      await openCanvas(user);
      expect(screen.getByRole('button', { name: /nothing to undo/i })).toBeDisabled();
    });

    it('names what it will undo, and reverses a move to where the block was', async () => {
      const user = userEvent.setup();
      const update = vi.fn((_v, opts) => opts?.onSuccess?.());
      vi.mocked(canvasApi.useCanvas).mockReturnValue({ data: canvas } as never);
      vi.mocked(canvasApi.useUpdateBlock).mockReturnValue(idle({ mutate: update }) as never);

      renderPage();
      await openCanvas(user);
      await user.click(screen.getByRole('button', { name: /move note block right/i }));

      // Naming the action matters: "Undo" alone makes someone guess what
      // is about to change.
      const undoButton = await screen.findByRole('button', { name: /undo moving the note block/i });
      await user.click(undoButton);

      // Back to x=0, the position it actually held before the nudge.
      expect(update).toHaveBeenLastCalledWith(
        { canvasId: 'canvas_1', blockId: 'b1', changes: { x: 0, y: 0 } },
        expect.anything(),
      );
    });

    it('restores a deleted block together with the lines that touched it', async () => {
      const user = userEvent.setup();
      const withConnection = {
        ...canvas,
        blocks: [canvas.blocks[0], { ...canvas.blocks[0], id: 'b2', content: 'Other', x: 300 }],
        connections: [{ id: 'c1', from: 'b1', to: 'b2', createdAt: 1 }],
      };
      const remove = vi.fn((_v, opts) => opts?.onSuccess?.());
      const add = vi.fn((_v, opts) => opts?.onSuccess?.({ ...canvas.blocks[0], id: 'b1_new' }));
      const connect = vi.fn();
      vi.mocked(canvasApi.useCanvas).mockReturnValue({ data: withConnection } as never);
      vi.mocked(canvasApi.useRemoveBlock).mockReturnValue(idle({ mutate: remove }) as never);
      vi.mocked(canvasApi.useAddBlock).mockReturnValue(idle({ mutate: add }) as never);
      vi.mocked(canvasApi.useConnectBlocks).mockReturnValue(idle({ mutate: connect }) as never);

      renderPage();
      await openCanvas(user);
      await user.click(screen.getAllByRole('button', { name: /remove note block/i })[0]);
      await user.click(await screen.findByRole('button', { name: /undo deleting the note block/i }));

      // The block comes back...
      expect(add).toHaveBeenCalled();
      // ...and so does the connection, re-pointed at its new id. Without
      // this, undo would return a lonely block and quietly lose the
      // structure around it.
      expect(connect).toHaveBeenCalledWith(
        expect.objectContaining({ from: 'b1_new', to: 'b2' }),
      );
    });

    it('undoes an added block by removing it', async () => {
      const user = userEvent.setup();
      const add = vi.fn((_v, opts) => opts?.onSuccess?.({ ...canvas.blocks[0], id: 'b_new' }));
      const remove = vi.fn();
      vi.mocked(canvasApi.useCanvas).mockReturnValue({ data: canvas } as never);
      vi.mocked(canvasApi.useAddBlock).mockReturnValue(idle({ mutate: add }) as never);
      vi.mocked(canvasApi.useRemoveBlock).mockReturnValue(idle({ mutate: remove }) as never);

      renderPage();
      await openCanvas(user);
      await user.click(screen.getByRole('button', { name: /^note$/i }));
      await user.click(await screen.findByRole('button', { name: /undo adding a note block/i }));

      expect(remove).toHaveBeenCalledWith(
        { canvasId: 'canvas_1', blockId: 'b_new' },
        expect.anything(),
      );
    });
  });

  /**
   * A link block shows what it points at, read now.
   *
   * The old behaviour — "run: run_42" — was honest but useless. What must
   * not creep in is the other direction: showing a title the canvas stored
   * itself, which would slowly become a museum of names things used to
   * have.
   */
  describe('link blocks', () => {
    const linkCanvas = {
      ...canvas,
      blocks: [
        {
          ...canvas.blocks[0],
          id: 'lb1',
          kind: 'link' as const,
          content: 'Last night',
          target: 'workflow' as const,
          targetId: 'wf_1',
        },
      ],
    };

    it('shows the target\'s real name and a useful second line', async () => {
      const user = userEvent.setup();
      vi.mocked(canvasApi.useCanvas).mockReturnValue({ data: linkCanvas } as never);
      vi.mocked(canvasApi.useCanvasLinks).mockReturnValue({
        data: [{ blockId: 'lb1', title: 'Nightly report', detail: '3 steps' }],
      } as never);

      renderPage();
      await openCanvas(user);

      expect(screen.getByText('Nightly report')).toBeInTheDocument();
      expect(screen.getByText(/workflow · 3 steps/)).toBeInTheDocument();
      // The raw id is no longer the only thing on offer.
      expect(screen.queryByText(/workflow: wf_1/)).not.toBeInTheDocument();
    });

    it('says plainly when the target is gone, without guessing why', async () => {
      const user = userEvent.setup();
      vi.mocked(canvasApi.useCanvas).mockReturnValue({ data: linkCanvas } as never);
      vi.mocked(canvasApi.useCanvasLinks).mockReturnValue({
        data: [{ blockId: 'lb1', missing: true }],
      } as never);

      renderPage();
      await openCanvas(user);

      // Deleted and "belongs to another workspace" read the same, on
      // purpose: telling them apart would tell an outsider which ids are
      // real.
      expect(
        screen.getByText(/This workflow is gone, or is not in this workspace/),
      ).toBeInTheDocument();
    });

    it('falls back to the id while the lookup is still out', async () => {
      const user = userEvent.setup();
      vi.mocked(canvasApi.useCanvas).mockReturnValue({ data: linkCanvas } as never);
      vi.mocked(canvasApi.useCanvasLinks).mockReturnValue({ data: [] } as never);

      renderPage();
      await openCanvas(user);

      // Honest about pointing at something, rather than showing a
      // placeholder that could be mistaken for a title.
      expect(screen.getByText(/workflow: wf_1/)).toBeInTheDocument();
    });
  });

  describe('connections', () => {
    const twoBlocks: CanvasDocument = {
      ...canvas,
      blocks: [
        canvas.blocks[0],
        { ...canvas.blocks[0], id: 'b2', kind: 'text', content: 'Tell the team', x: 300 },
      ],
    };

    it('connects two blocks in two clicks, and explains the pending step', async () => {
      const user = userEvent.setup();
      const connect = vi.fn();
      vi.mocked(canvasApi.useCanvas).mockReturnValue({ data: twoBlocks } as never);
      vi.mocked(canvasApi.useConnectBlocks).mockReturnValue(idle({ mutate: connect }) as never);

      renderPage();
      await openCanvas(user);
      await user.click(screen.getByRole('button', { name: /connect from this note block/i }));

      // The half-finished state has to say what it is waiting for.
      expect(screen.getByRole('status')).toHaveTextContent(/Pick the block this one connects to/);

      await user.click(screen.getByRole('button', { name: /connect to this text block/i }));
      expect(connect).toHaveBeenCalledWith(
        { canvasId: 'canvas_1', from: 'b1', to: 'b2' },
        expect.anything(),
      );
    });

    it('cancels when the same block is picked twice, without calling the server', async () => {
      const user = userEvent.setup();
      const connect = vi.fn();
      vi.mocked(canvasApi.useCanvas).mockReturnValue({ data: twoBlocks } as never);
      vi.mocked(canvasApi.useConnectBlocks).mockReturnValue(idle({ mutate: connect }) as never);

      renderPage();
      await openCanvas(user);
      await user.click(screen.getByRole('button', { name: /connect from this note block/i }));
      await user.click(screen.getByRole('button', { name: /cancel connecting from this note block/i }));

      // A self-connection would be refused anyway; asking is pointless.
      expect(connect).not.toHaveBeenCalled();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('lists existing connections by the text of the blocks they join', async () => {
      const user = userEvent.setup();
      vi.mocked(canvasApi.useCanvas).mockReturnValue({
        data: {
          ...twoBlocks,
          connections: [{ id: 'c1', from: 'b1', to: 'b2', label: 'then', createdAt: 1 }],
        },
      } as never);

      renderPage();
      await openCanvas(user);

      expect(screen.getByText(/Connections \(1\)/)).toBeInTheDocument();
      expect(screen.getByText(/Ship on Friday → Tell the team \(then\)/)).toBeInTheDocument();
    });

    it('removes a connection', async () => {
      const user = userEvent.setup();
      const disconnect = vi.fn();
      vi.mocked(canvasApi.useCanvas).mockReturnValue({
        data: {
          ...twoBlocks,
          connections: [{ id: 'c1', from: 'b1', to: 'b2', createdAt: 1 }],
        },
      } as never);
      vi.mocked(canvasApi.useDisconnectBlocks).mockReturnValue(
        idle({ mutate: disconnect }) as never,
      );

      renderPage();
      await openCanvas(user);
      await user.click(screen.getByRole('button', { name: /remove connection/i }));

      expect(disconnect).toHaveBeenCalledWith(
        { canvasId: 'canvas_1', connectionId: 'c1' },
        expect.anything(),
      );
    });

    it('surfaces the server\'s refusal verbatim when a connection is rejected', async () => {
      const user = userEvent.setup();
      const { toast } = await import('sonner');
      const toastError = vi.spyOn(toast, 'error');
      vi.mocked(canvasApi.useCanvas).mockReturnValue({ data: twoBlocks } as never);
      vi.mocked(canvasApi.useConnectBlocks).mockReturnValue(
        idle({
          mutate: vi.fn((_v, opts) =>
            opts?.onError?.(new Error('these blocks are already connected in that direction')),
          ),
        }) as never,
      );

      renderPage();
      await openCanvas(user);
      await user.click(screen.getByRole('button', { name: /connect from this note block/i }));
      await user.click(screen.getByRole('button', { name: /connect to this text block/i }));

      expect(toastError).toHaveBeenCalledWith(expect.stringContaining('already connected'));
    });

    it('says that deleting a block also deletes its lines', async () => {
      const user = userEvent.setup();
      vi.mocked(canvasApi.useCanvas).mockReturnValue({ data: twoBlocks } as never);

      renderPage();
      await openCanvas(user);
      expect(screen.getByText(/deletes the lines that touched it/)).toBeInTheDocument();
    });
  });
});
