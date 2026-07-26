import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('renders the title and description', () => {
    render(<EmptyState title="No workspaces yet" description="Create one to get started." />);
    expect(screen.getByText('No workspaces yet')).toBeInTheDocument();
    expect(screen.getByText('Create one to get started.')).toBeInTheDocument();
  });

  it('renders the icon when provided', () => {
    render(<EmptyState title="Empty" icon={<svg data-testid="empty-icon" />} />);
    expect(screen.getByTestId('empty-icon')).toBeInTheDocument();
  });

  it('renders and wires up the action', () => {
    const onClick = vi.fn();
    render(
      <EmptyState
        title="No workspaces yet"
        action={<button onClick={onClick}>Create workspace</button>}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('omits the description when none is given', () => {
    render(<EmptyState title="Empty" />);
    expect(screen.queryByText(/./, { selector: 'p' })).not.toBeInTheDocument();
  });
});
