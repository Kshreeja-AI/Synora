import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type React from 'react';
import ProjectDetailPage from './page';

const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'p1' }),
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('../../../../hooks/useCurrentWorkspace', () => ({
  useCurrentWorkspace: vi.fn(),
}));

vi.mock('../../../../lib/api/projects', () => ({
  getProject: vi.fn(),
  deleteProject: vi.fn(),
}));

vi.mock('../../../../lib/api/folders', () => ({
  listFolders: vi.fn(),
  createFolder: vi.fn(),
  deleteFolder: vi.fn(),
}));

vi.mock('../../../../lib/api/assets', () => ({
  listAssets: vi.fn(),
  uploadAsset: vi.fn(),
  deleteAsset: vi.fn(),
}));

import { useCurrentWorkspace } from '../../../../hooks/useCurrentWorkspace';
import { getProject, deleteProject } from '../../../../lib/api/projects';
import { listFolders, createFolder } from '../../../../lib/api/folders';
import { listAssets, uploadAsset } from '../../../../lib/api/assets';

const WORKSPACE = { id: 'w1', name: 'Acme Inc', slug: 'acme-inc', role: 'OWNER' as const, memberCount: 1 };
const PROJECT = { id: 'p1', name: 'Launch Plan', description: 'Q3 launch', workspaceId: 'w1' };

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('ProjectDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useCurrentWorkspace as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ currentWorkspace: WORKSPACE });
    (getProject as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(PROJECT);
    (listFolders as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (listAssets as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  it('shows the project name and description', async () => {
    renderWithClient(<ProjectDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('Launch Plan')).toBeDefined();
      expect(screen.getByText('Q3 launch')).toBeDefined();
    });
  });

  it('shows an empty state when there are no files', async () => {
    renderWithClient(<ProjectDetailPage />);

    await waitFor(() => {
      expect(screen.getByText(/no files here/i)).toBeDefined();
    });
  });

  it('lists folders and assets', async () => {
    (listFolders as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'f1', name: 'Marketing', workspaceId: 'w1', projectId: 'p1', parentId: null },
    ]);
    (listAssets as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'a1', name: 'brief.pdf', mimeType: 'application/pdf', size: 2048, url: 'http://x/brief.pdf' },
    ]);

    renderWithClient(<ProjectDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('Marketing')).toBeDefined();
      expect(screen.getByText('brief.pdf')).toBeDefined();
    });
  });

  it('creates a folder through the dialog', async () => {
    (createFolder as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'f1', name: 'New Folder' });
    const user = userEvent.setup();

    renderWithClient(<ProjectDetailPage />);
    await user.click(await screen.findByRole('button', { name: /new folder/i }));
    await user.type(screen.getByLabelText('Folder name'), 'New Folder');
    await user.click(screen.getByRole('button', { name: /create folder/i }));

    await waitFor(() => {
      expect(createFolder).toHaveBeenCalledWith('w1', { name: 'New Folder', projectId: 'p1' });
    });
  });

  it('uploads a file when chosen', async () => {
    (uploadAsset as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'a1', name: 'notes.txt' });
    renderWithClient(<ProjectDetailPage />);
    await screen.findByText('Launch Plan');

    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, file);

    await waitFor(() => {
      expect(uploadAsset).toHaveBeenCalledWith('w1', file, { projectId: 'p1', folderId: undefined });
    });
  });

  it('deletes the project after confirming', async () => {
    (deleteProject as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ message: 'ok' });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();

    renderWithClient(<ProjectDetailPage />);
    await user.click(await screen.findByRole('button', { name: /delete project/i }));

    await waitFor(() => {
      expect(deleteProject).toHaveBeenCalledWith('p1');
      expect(pushMock).toHaveBeenCalledWith('/dashboard/projects');
    });
  });
});
