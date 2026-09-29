/**
 * "Save as doc" — everything is stated before anything happens.
 *
 * Under test: the title is a visible, editable guess; the reply text is
 * saved VERBATIM (no rewriting, no hidden additions); project filing is
 * a visible checkbox honoured exactly; and success is proven by a link
 * to the new document, not a vanishing toast.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { SaveAsDocument, deriveTitle } from '../SaveAsDocument';
import * as documentsApi from '@/lib/api/documents';

vi.mock('@/lib/api/documents', async () => {
  const actual = await vi.importActual<typeof documentsApi>('@/lib/api/documents');
  return { ...actual, useCreateDocument: vi.fn() };
});

function mockCreate(overrides: Record<string, unknown> = {}) {
  const mutation = {
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    ...overrides,
  };
  vi.mocked(documentsApi.useCreateDocument).mockReturnValue(mutation as never);
  return mutation;
}

beforeEach(() => {
  mockCreate();
});

describe('deriveTitle', () => {
  it('uses the first markdown heading, stripped of markers', () => {
    expect(deriveTitle('# Launch plan\n\nDetails follow.')).toBe('Launch plan');
  });

  it('falls back to the first non-empty line', () => {
    expect(deriveTitle('\n\nThe **short** version.\nMore.')).toBe('The short version.');
  });

  it('never returns an empty title', () => {
    expect(deriveTitle('')).toBe('Saved reply');
  });
});

describe('SaveAsDocument', () => {
  it('opens with the derived title visible and editable — a guess, not a decision', () => {
    render(<SaveAsDocument content={'# Quarterly summary\n\nBody.'} />);
    fireEvent.click(screen.getByRole('button', { name: /save as document/i }));

    const input = screen.getByLabelText('Title');
    expect(input).toHaveValue('Quarterly summary');

    fireEvent.change(input, { target: { value: 'My own title' } });
    expect(input).toHaveValue('My own title');
  });

  it('saves the reply text verbatim — no rewriting, no hidden additions', () => {
    const { mutate } = mockCreate();
    const content = '# Plan\n\nStep 1.\nStep 2.';
    render(<SaveAsDocument content={content} />);

    fireEvent.click(screen.getByRole('button', { name: /save as document/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(mutate).toHaveBeenCalledWith(
      { title: 'Plan', content },
      expect.anything(),
    );
  });

  it('files into the conversation’s project only while the visible checkbox is checked', () => {
    const { mutate } = mockCreate();
    render(<SaveAsDocument content="Reply text" projectId="proj_1" />);

    fireEvent.click(screen.getByRole('button', { name: /save as document/i }));
    const checkbox = screen.getByRole('checkbox', {
      name: /file into the same project/i,
    });
    expect(checkbox).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(mutate).toHaveBeenLastCalledWith(
      expect.objectContaining({ projectId: 'proj_1' }),
      expect.anything(),
    );

    // Unchecked: the claim is dropped entirely, not sent as null.
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(mutate).toHaveBeenLastCalledWith(
      { title: 'Reply text', content: 'Reply text' },
      expect.anything(),
    );
  });

  it('offers no project checkbox when the conversation is not in a project', () => {
    render(<SaveAsDocument content="Reply text" />);
    fireEvent.click(screen.getByRole('button', { name: /save as document/i }));
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('proves success with a link to the new document', () => {
    const { mutate } = mockCreate();
    render(<SaveAsDocument content="Reply text" />);

    fireEvent.click(screen.getByRole('button', { name: /save as document/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    // Simulate the mutation succeeding.
    const options = vi.mocked(mutate).mock.calls[0][1] as {
      onSuccess: (doc: { id: string }) => void;
    };
    act(() => options.onSuccess({ id: 'doc_9' }));

    const link = screen.getByRole('link', { name: /saved — open document/i });
    expect(link).toHaveAttribute('href', '/documents/doc_9');
    // The form is gone; the affordance's whole job now is navigation.
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();
  });

  it('cancel closes the form and sends nothing', () => {
    const { mutate } = mockCreate();
    render(<SaveAsDocument content="Reply text" />);

    fireEvent.click(screen.getByRole('button', { name: /save as document/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(mutate).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();
  });

  it('shows the server error where the person is looking', () => {
    mockCreate({ isError: true, error: new Error('Project not found') });
    render(<SaveAsDocument content="Reply text" projectId="proj_gone" />);

    fireEvent.click(screen.getByRole('button', { name: /save as document/i }));
    expect(screen.getByRole('alert')).toHaveTextContent('Project not found');
  });
});
