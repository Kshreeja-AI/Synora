import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Checkbox } from './Checkbox';

describe('Checkbox', () => {
  it('renders unchecked by default', () => {
    render(<Checkbox aria-label="Remember me" />);
    expect(screen.getByRole('checkbox')).toHaveAttribute('aria-checked', 'false');
  });

  it('renders checked when controlled', () => {
    render(<Checkbox aria-label="Remember me" checked readOnly />);
    expect(screen.getByRole('checkbox')).toHaveAttribute('aria-checked', 'true');
  });

  it('calls onCheckedChange when clicked', () => {
    const onCheckedChange = vi.fn();
    render(<Checkbox aria-label="Remember me" onCheckedChange={onCheckedChange} />);

    fireEvent.click(screen.getByRole('checkbox'));

    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('is disabled when the disabled prop is set', () => {
    render(<Checkbox aria-label="Remember me" disabled />);
    expect(screen.getByRole('checkbox')).toBeDisabled();
  });
});
