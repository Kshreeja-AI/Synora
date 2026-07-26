import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from './Command';

function renderPalette(onSelect: (value: string) => void) {
  return render(
    <Command>
      <CommandInput placeholder="Search..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Navigation">
          <CommandItem value="Dashboard" onSelect={onSelect}>
            Dashboard
          </CommandItem>
          <CommandItem value="Settings" onSelect={onSelect}>
            Settings
          </CommandItem>
          <CommandItem value="Workspace settings" onSelect={onSelect}>
            Workspace settings
          </CommandItem>
        </CommandGroup>
        <CommandGroup heading="Actions">
          <CommandItem value="Log out" onSelect={onSelect}>
            Log out
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

describe('Command palette', () => {
  it('renders all items with no query', () => {
    renderPalette(vi.fn());
    expect(screen.getByText('Dashboard')).toBeVisible();
    expect(screen.getByText('Settings')).toBeVisible();
    expect(screen.getByText('Workspace settings')).toBeVisible();
  });

  it('filters items by typed query', () => {
    renderPalette(vi.fn());
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'work' } });

    expect(screen.getByText('Workspace settings')).toBeVisible();
    expect(screen.getByText('Dashboard').closest('[data-command-item]')).toHaveAttribute(
      'data-hidden',
      'true'
    );
  });

  it('shows the empty state when nothing matches', () => {
    renderPalette(vi.fn());
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'nonexistent-thing' } });
    expect(screen.getByText('No results found.')).toBeInTheDocument();
  });

  it('selects the highlighted item on Enter', () => {
    const onSelect = vi.fn();
    renderPalette(onSelect);

    const input = screen.getByRole('combobox');
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSelect).toHaveBeenCalledWith('Dashboard');
  });

  it('moves the highlight down with ArrowDown and selects it on Enter', () => {
    const onSelect = vi.fn();
    renderPalette(onSelect);

    const input = screen.getByRole('combobox');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSelect).toHaveBeenCalledWith('Settings');
  });

  it('calls onSelect when an item is clicked directly', () => {
    const onSelect = vi.fn();
    renderPalette(onSelect);

    fireEvent.click(screen.getByText('Settings'));

    expect(onSelect).toHaveBeenCalledWith('Settings');
  });

  it('hides a group entirely (including its heading) when none of its items match', () => {
    renderPalette(vi.fn());
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'workspace' } });

    expect(screen.getByText('Navigation')).toBeInTheDocument();
    expect(screen.queryByText('Actions')).not.toBeInTheDocument();
    expect(screen.queryByText('Log out')).not.toBeInTheDocument();
  });

  it('keeps a group visible when at least one of its items matches', () => {
    renderPalette(vi.fn());
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'log out' } });

    expect(screen.getByText('Actions')).toBeInTheDocument();
    expect(screen.queryByText('Navigation')).not.toBeInTheDocument();
  });
});
