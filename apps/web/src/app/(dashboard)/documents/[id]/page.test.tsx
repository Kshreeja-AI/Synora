/**
 * Document detail — content rendered exactly as stored, editable on
 * request (what is in the textarea is exactly what will be stored), and
 * a missing document says so plainly with a way back.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DocumentDetailPage from './page';
import * as documentsApi from '@/lib/api/documents';

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'doc_1' }),
}));

vi.mock('@/lib/api/documents', async () => {
  const actual = await vi.importActual<typeof documentsApi>('@/lib/api/documents');
  return { ...actual, useDocument: vi.fn(), useUpdateDocument: vi.fn() };
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

beforeEach(() => {
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
    render(<DocumentDetailPage />);
    expect(screen.getByRole('heading', { name: 'Launch plan' })).toBeInTheDocument();
    expect(screen.getByText('Body paragraph.')).toBeInTheDocument();
  });

  it('edit prefills the stored text exactly, and save sends exactly what is shown', () => {
    const { mutate } = mockUpdate();
    render(<DocumentDetailPage />);

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
    render(<DocumentDetailPage />);

    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    fireEvent.change(screen.getByLabelText('Content'), { target: { value: 'thrown away' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(mutate).not.toHaveBeenCalled();
    // Back to reading the stored version.
    expect(screen.getByText('Body paragraph.')).toBeInTheDocument();
  });

  it('shows the save error where the person is looking', () => {
    mockUpdate({ isError: true, error: new Error('Content too large') });
    render(<DocumentDetailPage />);

    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    expect(screen.getByRole('alert')).toHaveTextContent('Content too large');
  });

  it('says plainly when the document cannot be found, with a way back', () => {
    vi.mocked(documentsApi.useDocument).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Document not found'),
    } as never);

    render(<DocumentDetailPage />);
    expect(screen.getByRole('alert')).toHaveTextContent('Document not found');
    expect(screen.getByRole('link', { name: /back to documents/i })).toHaveAttribute(
      'href',
      '/documents',
    );
  });
});
