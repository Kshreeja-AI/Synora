/**
 * The project workspace panel.
 *
 * What is defended here is restraint as much as function. The panel shows
 * real titles, real counts and real timestamps — and deliberately does not
 * judge the project or invent a summary of it, because those are the two
 * things in a panel like this that can be confidently wrong.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProjectWorkspacePanel } from '../ProjectWorkspacePanel';
import * as api from '@/lib/api/projectWorkspace';
import type { ProjectWorkspace } from '@/lib/api/projectWorkspace';

vi.mock('@/lib/api/projectWorkspace', async () => {
  const actual = await vi.importActual<typeof api>('@/lib/api/projectWorkspace');
  return { ...actual, useProjectWorkspace: vi.fn() };
});

function workspace(overrides: Partial<ProjectWorkspace> = {}): ProjectWorkspace {
  return {
    project: {
      id: 'p1',
      name: 'Market research',
      description: null,
      goal: 'Decide whether to enter the German market by March.',
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    counts: { conversation: 2, canvas: 0, file: 1, document: 0, image: 0, video: 0, audio: 0, agentRun: 0 },
    timeline: [
      {
        kind: 'conversation',
        id: 'c1',
        title: 'Competitor pricing',
        at: new Date(Date.now() - 3_600_000).toISOString(),
      },
      {
        kind: 'file',
        id: 'f1',
        title: 'pricing.csv',
        at: new Date(Date.now() - 86_400_000).toISOString(),
        detail: 'text/csv · 4 KB',
      },
    ],
    resumeConversationId: 'c1',
    lastActivityAt: new Date(Date.now() - 3_600_000).toISOString(),
    ...overrides,
  };
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ProjectWorkspacePanel projectId="p1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(api.useProjectWorkspace).mockReturnValue({
    data: workspace(),
    isLoading: false,
  } as never);
});

describe('ProjectWorkspacePanel', () => {
  it('shows the goal, so the project has something to be finished against', () => {
    renderPanel();
    expect(screen.getByText(/Decide whether to enter the German market/)).toBeInTheDocument();
  });

  it('offers to add a goal rather than demanding one up front', () => {
    vi.mocked(api.useProjectWorkspace).mockReturnValue({
      data: workspace({ project: { ...workspace().project, goal: null } }),
      isLoading: false,
    } as never);

    renderPanel();
    // Many projects only become clear once they are underway; nobody
    // should be blocked from starting by a required field.
    expect(screen.getByText(/No goal set/)).toBeInTheDocument();
  });

  it('offers to continue where you left off', () => {
    renderPanel();
    const resume = screen.getByRole('link', { name: /continue where you left off/i });
    expect(resume).toHaveAttribute('href', '/conversations/c1');
  });

  it('does not offer to continue when there is nothing to continue', () => {
    vi.mocked(api.useProjectWorkspace).mockReturnValue({
      data: workspace({ resumeConversationId: null }),
      isLoading: false,
    } as never);

    renderPanel();
    expect(screen.queryByRole('link', { name: /continue where/i })).not.toBeInTheDocument();
  });

  it('lists the work in one chronology, newest first', () => {
    renderPanel();
    const items = screen.getAllByRole('listitem');
    // Counts come first in the DOM, so the timeline entries are the ones
    // carrying titles.
    expect(screen.getByText('Competitor pricing')).toBeInTheDocument();
    expect(screen.getByText('pricing.csv')).toBeInTheDocument();
    expect(items.length).toBeGreaterThan(1);
  });

  it('links a conversation to its page and leaves a file unlinked', () => {
    renderPanel();
    expect(screen.getByRole('link', { name: /Competitor pricing/ })).toHaveAttribute(
      'href',
      '/conversations/c1',
    );
    // A file has no page to open today, so it is listed without a link
    // rather than given one that goes nowhere.
    expect(screen.queryByRole('link', { name: /pricing\.csv/ })).not.toBeInTheDocument();
  });

  it('shows an agent run in the chronology, linked to its own permalink page', () => {
    vi.mocked(api.useProjectWorkspace).mockReturnValue({
      data: workspace({
        counts: { ...workspace().counts, agentRun: 1 },
        timeline: [
          ...workspace().timeline,
          {
            kind: 'agentRun',
            id: 'run1',
            title: 'Summarise the competitive landscape',
            at: new Date(Date.now() - 1_800_000).toISOString(),
            detail: 'Researcher · completed',
          },
        ],
      }),
      isLoading: false,
    } as never);

    renderPanel();
    expect(screen.getByText('Summarise the competitive landscape')).toBeInTheDocument();
    expect(screen.getByText(/Researcher · completed/)).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /Summarise the competitive landscape/ }),
    ).toHaveAttribute('href', '/agents/runs/run1');
  });

  it('states last activity as a fact, and passes no judgement on the project', () => {
    renderPanel();
    expect(screen.getByText(/Last activity/)).toBeInTheDocument();
    // "Stalled", "behind", "at risk" would be the platform deciding
    // something about someone's work that it has no standing to decide —
    // and would be wrong exactly during a deliberate pause.
    expect(screen.queryByText(/stalled|at risk|behind schedule/i)).not.toBeInTheDocument();
  });

  it('says an empty project is empty, without inventing activity', () => {
    vi.mocked(api.useProjectWorkspace).mockReturnValue({
      data: workspace({
        timeline: [],
        counts: { conversation: 0, canvas: 0, file: 0, document: 0, image: 0, video: 0, audio: 0, agentRun: 0 },
        resumeConversationId: null,
        lastActivityAt: null,
      }),
      isLoading: false,
    } as never);

    renderPanel();
    expect(screen.getByText(/Nothing here yet/)).toBeInTheDocument();
    expect(screen.queryByText(/Last activity/)).not.toBeInTheDocument();
  });

  it('renders nothing while the work is still loading', () => {
    vi.mocked(api.useProjectWorkspace).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as never);

    const { container } = renderPanel();
    // Better an absent panel than a skeleton of a history that may turn
    // out to be empty.
    expect(container).toBeEmptyDOMElement();
  });
});
