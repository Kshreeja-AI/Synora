/**
 * Document detail — content rendered exactly as stored, and a missing
 * document says so plainly with a way back.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import DocumentDetailPage from './page';
import * as documentsApi from '@/lib/api/documents';

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'doc_1' }),
}));

vi.mock('@/lib/api/documents', async () => {
  const actual = await vi.importActual<typeof documentsApi>('@/lib/api/documents');
  return { ...actual, useDocument: vi.fn() };
});

beforeEach(() => {
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
