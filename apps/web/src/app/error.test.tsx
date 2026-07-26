import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RootError from './error';

describe('RootError', () => {
  it('shows a message and calls reset when "Try again" is clicked', () => {
    const reset = vi.fn();
    render(<RootError error={new Error('boom')} reset={reset} />);

    expect(screen.getByText('Something went wrong')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
