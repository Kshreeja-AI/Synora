/**
 * ConversationFilesPanel tests.
 *
 * The panel's contract: render the server's file list, gate the
 * download control on virus-scan status, and confirm before delete.
 * Upload mechanics live in FileUploadButton and the API client — the
 * hooks are mocked here so these tests pin panel behavior only.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConversationFilesPanel } from '../ConversationFilesPanel';
import type { ConversationFile } from '@/lib/api/files';

const mockFiles = vi.fn<() => ConversationFile[]>();
const deleteMutate = vi.fn();

vi.mock('@/lib/api/files', () => ({
  useConversationFiles: () => ({ data: mockFiles() }),
  useDeleteFile: () => ({ mutate: deleteMutate }),
  useUploadFile: () => ({ mutate: vi.fn(), isPending: false }),
  getFileDownloadUrl: (w: string, c: string, f: string) =>
    `http://api.test/api/workspaces/${w}/conversations/${c}/files/${f}/download`,
}));

function file(partial: Partial<ConversationFile>): ConversationFile {
  return {
    id: 'f1',
    fileName: 'report.pdf',
    mimeType: 'application/pdf',
    fileSize: 2048,
    processingStatus: 'COMPLETED',
    virusScanStatus: 'CLEAN',
    createdAt: '2026-01-01T00:00:00Z',
    ...partial,
  };
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ConversationFilesPanel workspaceId="ws" conversationId="c1" />
    </QueryClientProvider>
  );
}

describe('ConversationFilesPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFiles.mockReturnValue([]);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('shows the attachment count in the toggle', () => {
    mockFiles.mockReturnValue([file({}), file({ id: 'f2', fileName: 'notes.txt' })]);
    renderPanel();
    expect(screen.getByText(/Attachments \(2\)/)).toBeInTheDocument();
  });

  it('lists files with download links once expanded', () => {
    mockFiles.mockReturnValue([file({})]);
    renderPanel();

    fireEvent.click(screen.getByText(/Attachments/));
    const link = screen.getByLabelText('Download report.pdf');
    expect(link).toHaveAttribute(
      'href',
      'http://api.test/api/workspaces/ws/conversations/c1/files/f1/download'
    );
  });

  it('hides the download control for infected files and shows the block reason', () => {
    mockFiles.mockReturnValue([file({ virusScanStatus: 'INFECTED' })]);
    renderPanel();

    fireEvent.click(screen.getByText(/Attachments/));
    expect(screen.queryByLabelText('Download report.pdf')).toBeNull();
    expect(screen.getByText(/Blocked by security scan/)).toBeInTheDocument();
  });

  it('shows a scan-in-progress indicator for pending files but keeps download available', () => {
    mockFiles.mockReturnValue([file({ virusScanStatus: 'PENDING' })]);
    renderPanel();

    fireEvent.click(screen.getByText(/Attachments/));
    expect(screen.getByLabelText('Security scan in progress')).toBeInTheDocument();
    expect(screen.getByLabelText('Download report.pdf')).toBeInTheDocument();
  });

  it('deletes only after the user confirms', () => {
    mockFiles.mockReturnValue([file({})]);
    renderPanel();

    fireEvent.click(screen.getByText(/Attachments/));
    fireEvent.click(screen.getByLabelText('Delete report.pdf'));
    expect(deleteMutate).toHaveBeenCalledWith('f1');

    deleteMutate.mockClear();
    (window.confirm as ReturnType<typeof vi.fn>).mockReturnValue(false);
    fireEvent.click(screen.getByLabelText('Delete report.pdf'));
    expect(deleteMutate).not.toHaveBeenCalled();
  });

  it('shows the empty state when expanded with no files', () => {
    renderPanel();
    fireEvent.click(screen.getByText(/Attachments/));
    expect(screen.getByText(/No attachments yet/)).toBeInTheDocument();
  });
});
