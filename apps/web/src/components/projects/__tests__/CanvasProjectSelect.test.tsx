/**
 * Filing a canvas into a project.
 *
 * Same shape as the conversation control on purpose — two surfaces doing
 * the same job should not ask people to learn it twice — so the same
 * distinction has to hold: explicit null takes it out, an omitted field
 * leaves it alone.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CanvasProjectSelect } from '../CanvasProjectSelect';
import * as projectsApi from '@/lib/api/projects';
import * as canvasApi from '@/lib/api/canvas';

vi.mock('@/lib/api/projects', async () => {
  const actual = await vi.importActual<typeof projectsApi>('@/lib/api/projects');
  return { ...actual, listProjects: vi.fn() };
});

vi.mock('@/lib/api/canvas', async () => {
  const actual = await vi.importActual<typeof canvasApi>('@/lib/api/canvas');
  return { ...actual, useSetCanvasProject: vi.fn() };
});

const projects = [
  { id: 'p1', name: 'Market research' },
  { id: 'p2', name: 'Q3 launch' },
];

function idle(overrides: Record<string, unknown> = {}) {
  return { mutate: vi.fn(), isPending: false, ...overrides };
}

function renderControl(projectId?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CanvasProjectSelect workspaceId="ws_1" canvasId="cv1" projectId={projectId} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(projectsApi.listProjects).mockResolvedValue(projects as never);
  vi.mocked(canvasApi.useSetCanvasProject).mockReturnValue(idle() as never);
});

describe('CanvasProjectSelect', () => {
  it('shows which project the canvas already belongs to', async () => {
    renderControl('p2');
    expect(await screen.findByLabelText(/file this canvas into a project/i)).toHaveValue('p2');
  });

  it('files the canvas into the chosen project', async () => {
    const user = userEvent.setup();
    const setProject = vi.fn();
    vi.mocked(canvasApi.useSetCanvasProject).mockReturnValue(
      idle({ mutate: setProject }) as never,
    );

    renderControl(undefined);
    await user.selectOptions(
      await screen.findByLabelText(/file this canvas into a project/i),
      'p1',
    );

    expect(setProject).toHaveBeenCalledWith(
      { canvasId: 'cv1', projectId: 'p1' },
      expect.anything(),
    );
  });

  it('sends an explicit null to take it out', async () => {
    const user = userEvent.setup();
    const setProject = vi.fn();
    vi.mocked(canvasApi.useSetCanvasProject).mockReturnValue(
      idle({ mutate: setProject }) as never,
    );

    renderControl('p1');
    await user.selectOptions(await screen.findByLabelText(/file this canvas into a project/i), '');

    expect(setProject).toHaveBeenCalledWith(
      { canvasId: 'cv1', projectId: null },
      expect.anything(),
    );
  });

  it('offers nothing when there are no projects', async () => {
    vi.mocked(projectsApi.listProjects).mockResolvedValue([] as never);

    const { container } = renderControl(undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
    // No "make a project from this canvas" either: a canvas is usually
    // still called "Untitled" while it is being arranged, so promoting one
    // would produce a project named "Untitled" more often than not.
    expect(container.querySelector('select')).toBeNull();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
