/**
 * Filing a conversation into a project.
 *
 * The distinction worth defending is between "no project" and "leave it
 * alone". The API treats an omitted field as "leave it where it is" and an
 * explicit null as "take it out" — if this control sent the wrong one,
 * every rename would silently unfile the conversation, or choosing "No
 * project" would appear to do nothing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FileIntoProject } from '../FileIntoProject';
import * as projectsApi from '@/lib/api/projects';
import * as conversationsApi from '@/lib/api/conversations';

vi.mock('@/lib/api/projects', async () => {
  const actual = await vi.importActual<typeof projectsApi>('@/lib/api/projects');
  return { ...actual, listProjects: vi.fn() };
});

vi.mock('@/lib/api/conversations', async () => {
  const actual = await vi.importActual<typeof conversationsApi>('@/lib/api/conversations');
  return { ...actual, useUpdateConversation: vi.fn() };
});

const projects = [
  { id: 'p1', name: 'Market research' },
  { id: 'p2', name: 'Q3 launch' },
];

function idle(overrides: Record<string, unknown> = {}) {
  return { mutate: vi.fn(), isPending: false, ...overrides };
}

function renderControl(projectId?: string | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <FileIntoProject workspaceId="ws_1" conversationId="c1" projectId={projectId} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(projectsApi.listProjects).mockResolvedValue(projects as never);
  vi.mocked(conversationsApi.useUpdateConversation).mockReturnValue(idle() as never);
});

describe('FileIntoProject', () => {
  it('shows where the conversation currently sits, before being a control', async () => {
    renderControl('p2');
    const select = await screen.findByLabelText(/file this conversation into a project/i);
    // A statement of fact first: someone arriving can see whether this
    // conversation belongs anywhere without clicking.
    expect(select).toHaveValue('p2');
  });

  it('files the conversation into the chosen project', async () => {
    const user = userEvent.setup();
    const update = vi.fn();
    vi.mocked(conversationsApi.useUpdateConversation).mockReturnValue(
      idle({ mutate: update }) as never,
    );

    renderControl(null);
    const select = await screen.findByLabelText(/file this conversation into a project/i);
    await user.selectOptions(select, 'p1');

    expect(update).toHaveBeenCalledWith({ projectId: 'p1' }, expect.anything());
  });

  it('sends an explicit null to take it out, never an omitted field', async () => {
    const user = userEvent.setup();
    const update = vi.fn();
    vi.mocked(conversationsApi.useUpdateConversation).mockReturnValue(
      idle({ mutate: update }) as never,
    );

    renderControl('p1');
    const select = await screen.findByLabelText(/file this conversation into a project/i);
    await user.selectOptions(select, '');

    // Omitting the field means "leave it where it is" — choosing "No
    // project" would then appear to do nothing at all.
    expect(update).toHaveBeenCalledWith({ projectId: null }, expect.anything());
  });

  it('offers nothing at all when there are no projects yet', async () => {
    vi.mocked(projectsApi.listProjects).mockResolvedValue([] as never);

    const { container } = renderControl(null);
    // An empty dropdown invites a click that leads nowhere, and sending
    // someone off to create a project mid-conversation is an errand.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container.querySelector('select')).toBeNull();
  });

  it('surfaces a refusal rather than silently failing', async () => {
    const user = userEvent.setup();
    const { toast } = await import('sonner');
    const toastError = vi.spyOn(toast, 'error');
    vi.mocked(conversationsApi.useUpdateConversation).mockReturnValue(
      idle({
        mutate: vi.fn((_v, opts) => opts?.onError?.(new Error('Project not found'))),
      }) as never,
    );

    renderControl(null);
    const select = await screen.findByLabelText(/file this conversation into a project/i);
    await user.selectOptions(select, 'p1');

    expect(toastError).toHaveBeenCalledWith('Project not found');
  });
});
