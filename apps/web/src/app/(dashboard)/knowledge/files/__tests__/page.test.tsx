/**
 * Workspace files page tests.
 *
 * This page is a navigation fix rather than a capability: workspace assets
 * were already storable and listable, and the only surface showing them
 * was the project detail page. The assertions therefore cover reachability
 * and honesty — that project-attached files are visibly marked as such
 * rather than presented as loose workspace files, and that a server
 * rejection reaches the user with its own wording.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import WorkspaceFilesPage from '../page';
import * as assetsApi from '@/lib/api/assets';
import type { Asset } from '@/lib/api/types';

vi.mock('@/hooks/useCurrentWorkspace', () => ({
  useCurrentWorkspace: () => ({ currentWorkspace: { id: 'ws_1', name: 'Test Co' } }),
}));

vi.mock('@/lib/api/assets', () => ({
  listAssets: vi.fn(),
  uploadAsset: vi.fn(),
  deleteAsset: vi.fn(),
}));

function makeAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: 'asset_1',
    workspaceId: 'ws_1',
    projectId: null,
    folderId: null,
    name: 'brand-guidelines.pdf',
    url: 'https://example.test/a.pdf',
    mimeType: 'application/pdf',
    size: 2048,
    uploadedById: 'u1',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <WorkspaceFilesPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(assetsApi.listAssets).mockResolvedValue([]);
  vi.mocked(assetsApi.uploadAsset).mockResolvedValue(makeAsset());
  vi.mocked(assetsApi.deleteAsset).mockResolvedValue({ message: 'ok' });
});

describe('workspace files page', () => {
  it('lists workspace files with their size and type', async () => {
    vi.mocked(assetsApi.listAssets).mockResolvedValue([makeAsset()]);

    renderPage();

    expect(await screen.findByText('brand-guidelines.pdf')).toBeInTheDocument();
    expect(screen.getByText('application/pdf')).toBeInTheDocument();
    expect(screen.getByText('2 KB')).toBeInTheDocument();
  });

  it('marks a file that belongs to a project rather than implying it is loose', async () => {
    vi.mocked(assetsApi.listAssets).mockResolvedValue([
      makeAsset({ id: 'asset_2', name: 'spec.md', projectId: 'proj_1' }),
    ]);

    renderPage();

    // The list deliberately includes project files, so it must say which
    // ones are already filed somewhere.
    expect(await screen.findByText('in a project')).toBeInTheDocument();
  });

  it('shows an empty state that explains what belongs here', async () => {
    renderPage();
    expect(await screen.findByText('No files yet')).toBeInTheDocument();
  });

  it('uploads a chosen file', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('No files yet');

    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    await user.upload(screen.getByLabelText(/upload a file/i), file);

    await waitFor(() => expect(assetsApi.uploadAsset).toHaveBeenCalledWith('ws_1', file));
  });

  it('surfaces the server\'s rejection wording rather than a generic failure', async () => {
    const user = userEvent.setup();
    const { toast } = await import('sonner');
    const toastError = vi.spyOn(toast, 'error');
    vi.mocked(assetsApi.uploadAsset).mockRejectedValue(
      new Error('File exceeds the maximum upload size'),
    );

    renderPage();
    await screen.findByText('No files yet');
    await user.upload(
      screen.getByLabelText(/upload a file/i),
      new File(['x'], 'huge.bin', { type: 'application/octet-stream' }),
    );

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(expect.stringContaining('maximum upload size')),
    );
  });

  it('deletes a file', async () => {
    const user = userEvent.setup();
    vi.mocked(assetsApi.listAssets).mockResolvedValue([makeAsset()]);

    renderPage();
    await user.click(await screen.findByRole('button', { name: /delete brand-guidelines/i }));

    await waitFor(() => expect(assetsApi.deleteAsset).toHaveBeenCalledWith('ws_1', 'asset_1'));
  });
});
