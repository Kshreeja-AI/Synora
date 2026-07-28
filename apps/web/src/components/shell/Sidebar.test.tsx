import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

let pathname = '/dashboard';
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
}));

vi.mock('./WorkspaceSwitcher', () => ({
  WorkspaceSwitcher: ({ collapsed }: { collapsed?: boolean }) => (
    <div data-testid="workspace-switcher" data-collapsed={collapsed} />
  ),
}));

import { Sidebar } from './Sidebar';

describe('Sidebar', () => {
  it('marks the active nav link with aria-current', () => {
    pathname = '/dashboard';
    render(<Sidebar open onNavigate={vi.fn()} />);
    expect(screen.getByRole('link', { name: /dashboard/i })).toHaveAttribute('aria-current', 'page');
  });

  it('calls onNavigate when a nav link is clicked', () => {
    const onNavigate = vi.fn();
    render(<Sidebar open onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole('link', { name: /dashboard/i }));
    expect(onNavigate).toHaveBeenCalled();
  });

  it('passes collapsed=true to the workspace switcher when closed', () => {
    render(<Sidebar open={false} onNavigate={vi.fn()} />);
    expect(screen.getByTestId('workspace-switcher')).toHaveAttribute('data-collapsed', 'true');
  });

  it('hides nav labels when collapsed', () => {
    render(<Sidebar open={false} onNavigate={vi.fn()} />);
    expect(screen.queryByText('Synora')).toBeNull();
  });

  it('marks Projects active on a project detail sub-route without marking Dashboard active', () => {
    pathname = '/dashboard/projects/abc123';
    render(<Sidebar open onNavigate={vi.fn()} />);
    expect(screen.getByRole('link', { name: /^projects$/i })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /^dashboard$/i })).not.toHaveAttribute('aria-current');
  });
});
