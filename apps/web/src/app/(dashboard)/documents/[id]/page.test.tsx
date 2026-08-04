/**
 * Document detail — content rendered exactly as stored, editable on
 * request (what is in the textarea is exactly what will be stored), and
 * a missing document says so plainly with a way back.
 *
 * A document filed into a shared project is readable by that project's
 * people but stays owner-only to edit; the Edit button is gated on
 * viewer identity so a non-owner never reaches a Save that would 404.
 * When filed, the project is named and linked so landing here from a
 * project's timeline is not a dead end.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DocumentDetailPage from './page';
import * as documentsApi from '@/lib/api/documents';
import * as projectsApi from '@/lib/api/projects';
import { useCurrentUser } from '@/hooks/useCurrentUser';

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'doc_1' }),
}));

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: vi.fn(() => ({ data: { id: 'u1', role: 'USER' } })),
}));

vi.mock('@/lib/api/documents', async () => {
  const actual = await vi.importActual<typeof documentsApi>('@/lib/api/documents');
  return { ...actual, useDocument: vi.fn(), useUpdateDocument: vi.fn() };
});

vi.mock('@/lib/api/projects', async () => {
  const actual = await vi.importActual<typeof projectsApi>('@/lib/api/projects');
  return { ...actual, getProject: vi.fn() };
});

function mockUpdate(overrides: Record<string, unknown> = {}) {
  const mutation = {
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    ...overrides,
  };
  vi.mocked(documentsApi.useUpdateDocument).mockReturnValue(mutation as never);
  return mutation;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DocumentDetailPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(projectsApi.getProject).mockRejectedValue(new Error('not fetched in this test'));
  vi.mocked(useCurrentUser).mockReturnValue({
    data: { id: 'u1', role: 'USER' },
  } as unknown as ReturnType<typeof useCurrentUser>);
  mockUpdate();
  vi.mocked(documentsApi.useDocument).mockReturnValue({
    data: {
      id: 'doc_1',
      userId: 'u1',
      projectId: null,
      title: 'Launch plan',
      content: '# Heading\n\nBody paragraph.',
      format: 'MARKDOWN',
      status: 'DRAFT',
      createdAt: '2026-08-01T00:00:00Z',
      updatedAt: '2026-08-03T00:00:00Z',
    },
    isLoading: false,
    error: null,
  } as never);
});

describe('DocumentDetailPage', () => {
  it('renders the title and the markdown content', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Launch plan' })).toBeInTheDocument();
    expect(screen.getByText('Body paragraph.')).toBeInTheDocument();
  });

  it('edit prefills the stored text exactly, and save sends exactly what is shown', () => {
    const { mutate } = mockUpdate();
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /edit/i }));

    // What is in the textarea is what is stored — the honest baseline
    // for "what you see is what will be saved".
    const contentBox = screen.getByLabelText('Content');
    expect(contentBox).toHaveValue('# Heading\n\nBody paragraph.');

    fireEvent.change(contentBox, { target: { value: '# Heading\n\nRevised.' } });
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Launch plan v2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(mutate).toHaveBeenCalledWith(
      { title: 'Launch plan v2', content: '# Heading\n\nRevised.' },
      expect.anything(),
    );
  });

  it('cancel discards the edit and saves nothing', () => {
    const { mutate } = mockUpdate();
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    fireEvent.change(screen.getByLabelText('Content'), { target: { value: 'thrown away' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(mutate).not.toHaveBeenCalled();
    // Back to reading the stored version.
    expect(screen.getByText('Body paragraph.')).toBeInTheDocument();
  });

  it('shows the save error where the person is looking', () => {
    mockUpdate({ isError: true, error: new Error('Content too large') });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    expect(screen.getByRole('alert')).toHaveTextContent('Content too large');
  });

  it('hides Edit for a viewer who is not the document\'s author', () => {
    vi.mocked(useCurrentUser).mockReturnValue({
      data: { id: 'someone-else', role: 'USER' },
    } as unknown as ReturnType<typeof useCurrentUser>);

    renderPage();

    // Reachable here only because the caller can see the shared project
    // this document is filed into — read access, never a write claim.
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.getByText('Body paragraph.')).toBeInTheDocument();
  });

  it('names and links the project a document is filed into', async () => {
    vi.mocked(documentsApi.useDocument).mockReturnValue({
      data: {
        id: 'doc_1',
        userId: 'u1',
        projectId: 'proj_9',
        title: 'Launch plan',
        content: '# Heading\n\nBody paragraph.',
        format: 'MARKDOWN',
        status: 'DRAFT',
        createdAt: '2026-08-01T00:00:00Z',
        updatedAt: '2026-08-03T00:00:00Z',
      },
      isLoading: false,
      error: null,
    } as never);
    vi.mocked(projectsApi.getProject).mockResolvedValue({
      id: 'proj_9',
      name: 'Q3 Launch',
    } as never);

    renderPage();

    const link = await screen.findByRole('link', { name: /Filed in Q3 Launch/i });
    expect(link).toHaveAttribute('href', '/dashboard/projects/proj_9');
  });

  it('shows no project label for a document that was never filed', () => {
    renderPage();
    expect(screen.queryByText(/Filed in/)).not.toBeInTheDocument();
  });

  it('degrades quietly if the filed project is no longer reachable', async () => {
    vi.mocked(documentsApi.useDocument).mockReturnValue({
      data: {
        id: 'doc_1',
        userId: 'u1',
        projectId: 'proj_gone',
        title: 'Launch plan',
        content: '# Heading\n\nBody paragraph.',
        format: 'MARKDOWN',
        status: 'DRAFT',
        createdAt: '2026-08-01T00:00:00Z',
        updatedAt: '2026-08-03T00:00:00Z',
      },
      isLoading: false,
      error: null,
    } as never);
    vi.mocked(projectsApi.getProject).mockRejectedValue(new Error('Project not found'));

    renderPage();

    await waitFor(() => expect(projectsApi.getProject).toHaveBeenCalled());
    // The document itself must still render; an ancillary label failing
    // is not grounds to break the page.
    expect(screen.getByText('Body paragraph.')).toBeInTheDocument();
    expect(screen.queryByText(/Filed in/)).not.toBeInTheDocument();
  });

  it('says plainly when the document cannot be found, with a way back', () => {
    vi.mocked(documentsApi.useDocument).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Document not found'),
    } as never);

    renderPage();
    expect(screen.getByRole('alert')).toHaveTextContent('Document not found');
    expect(screen.getByRole('link', { name: /back to documents/i })).toHaveAttribute(
      'href',
      '/documents',
    );
  });
});
