/**
 * The Ask Synora page.
 *
 * Exists because a browser pass found something no component test could:
 * a new account landing here with both buttons disabled and nothing saying
 * why. That message lives in the PAGE, not in a component, so nothing
 * guarded it — and a hint that silently disappears is worse than one that
 * was never written, because the dead end returns without anyone noticing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CommandPage from '../page';
import * as workspaceHook from '@/hooks/useCurrentWorkspace';
import * as commandApi from '@/lib/api/command';

vi.mock('@/hooks/useCurrentWorkspace');
vi.mock('@/lib/api/command');
vi.mock('@/components/command/PendingApprovals', () => ({
  PendingApprovals: () => null,
}));

function idleMutation() {
  return { mutate: vi.fn(), isPending: false, isError: false } as unknown as ReturnType<
    typeof commandApi.useRunCommand
  >;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CommandPage />
    </QueryClientProvider>,
  );
}

describe('CommandPage', () => {
  beforeEach(() => {
    vi.mocked(commandApi.useRunCommand).mockReturnValue(idleMutation());
    vi.mocked(commandApi.usePlanCommand).mockReturnValue(
      idleMutation() as unknown as ReturnType<typeof commandApi.usePlanCommand>,
    );
    vi.mocked(commandApi.useRunPlan).mockReturnValue(
      idleMutation() as unknown as ReturnType<typeof commandApi.useRunPlan>,
    );
    // Missing until the announcer read it. `useUndoCommand` arrived with
    // undo, but the page only touched it inside a branch these tests never
    // enter, so an incomplete mock stayed invisible. Every hook the page
    // calls has to be stubbed, whether or not today's assertions reach it.
    vi.mocked(commandApi.useUndoCommand).mockReturnValue(
      idleMutation() as unknown as ReturnType<typeof commandApi.useUndoCommand>,
    );
    vi.mocked(commandApi.useCommandExecutions).mockReturnValue({
      data: { items: [], total: 0 },
    } as unknown as ReturnType<typeof commandApi.useCommandExecutions>);
  });

  it('explains the dead end when the person is not in a workspace yet', () => {
    vi.mocked(workspaceHook.useCurrentWorkspace).mockReturnValue({
      currentWorkspace: null,
    } as unknown as ReturnType<typeof workspaceHook.useCurrentWorkspace>);

    renderPage();

    // A disabled control with no reason cannot be told apart from a broken
    // one, so the reason has to be on screen.
    expect(screen.getByText(/you are not in one yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Do it/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /See the steps/i })).toBeDisabled();
  });

  it('stays quiet about workspaces once the person is in one', () => {
    vi.mocked(workspaceHook.useCurrentWorkspace).mockReturnValue({
      currentWorkspace: { id: 'ws-1', name: 'Real Workspace' },
    } as unknown as ReturnType<typeof workspaceHook.useCurrentWorkspace>);

    renderPage();

    // The hint is an explanation for a blocked state, not a permanent notice.
    expect(screen.queryByText(/you are not in one yet/i)).not.toBeInTheDocument();
  });

  it('carries a live region from first render, not from the first answer', () => {
    vi.mocked(workspaceHook.useCurrentWorkspace).mockReturnValue({
      currentWorkspace: { id: 'ws-1', name: 'Real Workspace' },
    } as unknown as ReturnType<typeof workspaceHook.useCurrentWorkspace>);

    renderPage();

    // The component tests prove the announcer speaks correctly; this proves
    // it is actually on the page. A perfect announcer nobody mounted is the
    // exact state this page was in before — every answer inserted silently,
    // and a person using a screen reader told nothing at all.
    //
    // Present from FIRST RENDER: a live region mounted at the moment its
    // content arrives is not announced by assistive technology.
    expect(screen.getByTestId('command-announcer')).toBeInTheDocument();
  });

  it('offers reading the steps as its own action, never as a gate on doing', () => {
    vi.mocked(workspaceHook.useCurrentWorkspace).mockReturnValue({
      currentWorkspace: { id: 'ws-1', name: 'Real Workspace' },
    } as unknown as ReturnType<typeof workspaceHook.useCurrentWorkspace>);

    renderPage();

    // Both are reachable side by side. Routing every command through a
    // preview is how people learn to click past prompts.
    expect(screen.getByRole('button', { name: /Do it/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /See the steps/i })).toBeInTheDocument();
  });
});
