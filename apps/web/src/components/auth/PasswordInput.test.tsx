import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PasswordInput } from './PasswordInput';

describe('PasswordInput', () => {
  it('renders as a password field by default', () => {
    render(<PasswordInput placeholder="Password" />);
    const input = screen.getByPlaceholderText('Password') as HTMLInputElement;
    expect(input.type).toBe('password');
  });

  it('toggles to plain text and back when the visibility button is clicked', () => {
    render(<PasswordInput placeholder="Password" />);
    const input = screen.getByPlaceholderText('Password') as HTMLInputElement;
    const toggle = screen.getByLabelText('Show password');

    fireEvent.click(toggle);
    expect(input.type).toBe('text');
    expect(screen.getByLabelText('Hide password')).toBeDefined();

    fireEvent.click(screen.getByLabelText('Hide password'));
    expect(input.type).toBe('password');
  });

  it('forwards value and onChange like a normal input', () => {
    let value = '';
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      value = e.target.value;
    };
    render(<PasswordInput placeholder="Password" value="" onChange={handleChange} />);
    const input = screen.getByPlaceholderText('Password') as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'secret123' } });
    expect(value).toBe('secret123');
  });
});
