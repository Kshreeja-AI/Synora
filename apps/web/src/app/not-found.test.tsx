import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import NotFound from './not-found';

describe('NotFound', () => {
  it('shows a message and a link back home', () => {
    render(<NotFound />);
    expect(screen.getByText('Page not found')).toBeDefined();
    expect(screen.getByRole('link', { name: 'Go home' })).toHaveAttribute('href', '/');
  });
});
