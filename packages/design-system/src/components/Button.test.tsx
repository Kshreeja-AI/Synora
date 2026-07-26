import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from './Button';

describe('Button', () => {
  it('renders children', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole('button', { name: 'Click me' })).toBeDefined();
  });

  it('fires onClick', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is disabled while loading and shows a spinner', () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>
    );
    const button = screen.getByRole('button');
    expect(button).toHaveProperty('disabled', true);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    expect(button.querySelector('svg')).not.toBeNull();
  });

  it('applies variant classes', () => {
    render(<Button variant="danger">Delete</Button>);
    expect(screen.getByRole('button').className).toContain('bg-destructive');
  });

  it('renders as child element with asChild', () => {
    render(
      <Button asChild>
        <a href="/somewhere">Link</a>
      </Button>
    );
    const link = screen.getByRole('link', { name: 'Link' });
    expect(link.getAttribute('href')).toBe('/somewhere');
  });
});
