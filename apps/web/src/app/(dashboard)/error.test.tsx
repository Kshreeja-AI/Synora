import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DashboardGroupError from './error';

describe('DashboardGroupError', () => {
  it('shows a message and calls reset when "Try again" is clicked', () => {
    const reset = vi.fn();
    render(<DashboardGroupError error={new Error('boom')} reset={reset} />);

    expect(screen.getByText('Something went wrong')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
