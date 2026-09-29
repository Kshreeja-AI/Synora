/**
 * Documents list — personal scope said on the page, honest empty state,
 * every row a link to a page that actually exists.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import DocumentsPage from './page';
import * as documentsApi from '@/lib/api/documents';

vi.mock('@/lib/api/documents', async () => {
  const actual = await vi.importActual<typeof documentsApi>('@/lib/api/documents');
  return { ...actual, useDocuments: vi.fn() };
});

function doc(overrides: Record<string, unknown> = {}) {
  return {
    id: 'doc_1',
    userId: 'u1',
    projectId: null,
    title: 'Launch plan',
    content: '# Launch plan',
    format: 'MARKDOWN',
    status: 'DRAFT',
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-03T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(documentsApi.useDocuments).mockReturnValue({
    data: [doc()],
    isLoading: false,
    error: null,
  } as never);
});

describe('DocumentsPage', () => {
  it('lists documents as links to their pages', () => {
    render(<DocumentsPage />);
    expect(screen.getByRole('link', { name: /Launch plan/ })).toHaveAttribute(
      'href',
      '/documents/doc_1',
    );
  });

  it('says documents are personal, across workspaces', () => {
    render(<DocumentsPage />);
    // Said up front, rather than discovered by switching workspaces and
    // being surprised the list didn't change.
    expect(screen.getByText(/Yours, across all workspaces/)).toBeInTheDocument();
  });

  it('marks documents filed into a project', () => {
    vi.mocked(documentsApi.useDocuments).mockReturnValue({
      data: [doc({ projectId: 'proj_1' })],
      isLoading: false,
      error: null,
    } as never);

    render(<DocumentsPage />);
    expect(screen.getByText(/filed in a project/)).toBeInTheDocument();
  });

  it('shows an honest empty state that names the way in', () => {
    vi.mocked(documentsApi.useDocuments).mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    } as never);

    render(<DocumentsPage />);
    expect(screen.getByText(/No documents yet/)).toBeInTheDocument();
    expect(screen.getByText(/Save as doc/)).toBeInTheDocument();
  });

  it('surfaces load errors instead of an empty-looking page', () => {
    vi.mocked(documentsApi.useDocuments).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Network down'),
    } as never);

    render(<DocumentsPage />);
    expect(screen.getByRole('alert')).toHaveTextContent('Network down');
  });
});
