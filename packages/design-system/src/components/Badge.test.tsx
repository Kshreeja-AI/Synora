import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from './Badge';

describe('Badge', () => {
  it('renders text', () => {
    render(<Badge>Beta</Badge>);
    expect(screen.getByText('Beta')).toBeDefined();
  });

  it('applies variant classes', () => {
    render(<Badge variant="destructive">Error</Badge>);
    expect(screen.getByText('Error').className).toContain('text-destructive');
  });
});
