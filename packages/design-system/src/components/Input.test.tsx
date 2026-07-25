import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Input } from './Input';
import { Label } from './Label';

describe('Input', () => {
  it('accepts typed input', () => {
    const onChange = vi.fn();
    render(<Input placeholder="Email" onChange={onChange} />);
    const input = screen.getByPlaceholderText('Email');
    fireEvent.change(input, { target: { value: 'a@b.co' } });
    expect(onChange).toHaveBeenCalled();
  });

  it('associates with a Label via htmlFor', () => {
    render(
      <>
        <Label htmlFor="email">Email</Label>
        <Input id="email" />
      </>
    );
    expect(screen.getByLabelText('Email')).toBeDefined();
  });

  it('respects disabled', () => {
    render(<Input disabled placeholder="x" />);
    expect(screen.getByPlaceholderText('x')).toHaveProperty('disabled', true);
  });
});
