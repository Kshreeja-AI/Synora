/**
 * ConversationExport tests: the menu must produce direct links to the
 * backend export endpoint with the right format params — the previous
 * implementation fetched relative URLs with a localStorage token that
 * no longer exists, so the links themselves are the contract here.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConversationExport } from '../ConversationExport';

vi.mock('@/lib/api/conversationExport', () => ({
  getConversationExportUrl: (w: string, c: string, format: string) =>
    `http://api.test/api/workspaces/${w}/conversations/${c}/export?format=${format}`,
}));

describe('ConversationExport', () => {
  it('opens a menu with markdown and JSON download links', () => {
    render(<ConversationExport workspaceId="ws" conversationId="c1" />);

    fireEvent.click(screen.getByRole('button', { name: /Export/ }));

    const markdown = screen.getByRole('menuitem', { name: /Download as Markdown/ });
    const json = screen.getByRole('menuitem', { name: /Download as JSON/ });

    expect(markdown).toHaveAttribute(
      'href',
      'http://api.test/api/workspaces/ws/conversations/c1/export?format=markdown'
    );
    expect(json).toHaveAttribute(
      'href',
      'http://api.test/api/workspaces/ws/conversations/c1/export?format=json'
    );
  });

  it('reflects expanded state for assistive tech', () => {
    render(<ConversationExport workspaceId="ws" conversationId="c1" />);

    const trigger = screen.getByRole('button', { name: /Export/ });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('closes the menu after choosing a format', () => {
    render(<ConversationExport workspaceId="ws" conversationId="c1" />);

    fireEvent.click(screen.getByRole('button', { name: /Export/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Download as JSON/ }));

    expect(screen.queryByRole('menu')).toBeNull();
  });
});
