import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import DashboardNotFound from './not-found';

describe('DashboardNotFound', () => {
  it('shows a message and a link back to the dashboard', () => {
    render(<DashboardNotFound />);
    expect(screen.getByText('Page not found')).toBeDefined();
    expect(screen.getByRole('link', { name: 'Back to dashboard' })).toHaveAttribute('href', '/dashboard');
  });
});
