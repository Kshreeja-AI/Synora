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

// The sidebar reads the current user to decide whether to show the Admin
// entry. Default to a non-admin so the base nav is what most tests see.
vi.mock('../../hooks/useCurrentUser', () => ({
  useCurrentUser: vi.fn(() => ({ data: { id: 'u1', role: 'USER' } })),
}));

import { Sidebar } from './Sidebar';
import { useCurrentUser } from '../../hooks/useCurrentUser';

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

  // The chat and knowledge surfaces live at the URL root (the
  // `(dashboard)` route group), not under /dashboard — they were absent
  // from this nav entirely, making them unreachable by navigation.
  it('links to every primary surface, including the root-level ones', () => {
    pathname = '/dashboard';
    render(<Sidebar open onNavigate={vi.fn()} />);

    expect(screen.getByRole('link', { name: /^conversations$/i })).toHaveAttribute(
      'href',
      '/conversations'
    );
    expect(screen.getByRole('link', { name: /^knowledge$/i })).toHaveAttribute(
      'href',
      '/knowledge/prompts'
    );
    expect(screen.getByRole('link', { name: /^tools$/i })).toHaveAttribute(
      'href',
      '/dashboard/tools'
    );
    expect(screen.getByRole('link', { name: /^usage$/i })).toHaveAttribute(
      'href',
      '/dashboard/usage'
    );
  });

  it('keeps Knowledge active on the templates tab, whose path is not its href', () => {
    pathname = '/knowledge/templates';
    render(<Sidebar open onNavigate={vi.fn()} />);
    expect(screen.getByRole('link', { name: /^knowledge$/i })).toHaveAttribute(
      'aria-current',
      'page'
    );
  });

  it('marks Conversations active inside an individual chat', () => {
    pathname = '/conversations/abc123';
    render(<Sidebar open onNavigate={vi.fn()} />);
    expect(screen.getByRole('link', { name: /^conversations$/i })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(screen.getByRole('link', { name: /^dashboard$/i })).not.toHaveAttribute('aria-current');
  });
  it('hides the Admin entry from non-admin users', () => {
    pathname = '/dashboard';
    render(<Sidebar open onNavigate={vi.fn()} />);
    // Default mock is role USER — Admin must not be in the nav at all.
    expect(screen.queryByRole('link', { name: /^admin$/i })).toBeNull();
  });

  it('shows the Admin entry for ADMIN users', () => {
    pathname = '/dashboard';
    vi.mocked(useCurrentUser).mockReturnValueOnce({
      data: { id: 'u1', role: 'ADMIN' },
    } as unknown as ReturnType<typeof useCurrentUser>);
    render(<Sidebar open onNavigate={vi.fn()} />);
    expect(screen.getByRole('link', { name: /^admin$/i })).toBeDefined();
  });

  it('exposes the surfaces added since the app shell shipped', () => {
    pathname = '/dashboard';
    render(<Sidebar open onNavigate={vi.fn()} />);
    // Search, Billing and Developer all had pages with no way to reach them
    // from the primary nav until this was fixed.
    expect(screen.getByRole('link', { name: /^search$/i })).toBeDefined();
    expect(screen.getByRole('link', { name: /^billing$/i })).toBeDefined();
    expect(screen.getByRole('link', { name: /^developer$/i })).toBeDefined();
  });

  it('links to the media studio', () => {
    pathname = '/dashboard';
    render(<Sidebar open onNavigate={vi.fn()} />);
    expect(screen.getByRole('link', { name: /^studio$/i })).toHaveAttribute('href', '/studio');
  });

  it('keeps Studio active across its tab query strings', () => {
    // The tab lives in the query string, so the pathname stays /studio.
    pathname = '/studio';
    render(<Sidebar open onNavigate={vi.fn()} />);
    expect(screen.getByRole('link', { name: /^studio$/i })).toHaveAttribute(
      'aria-current',
      'page'
    );
  });
});
