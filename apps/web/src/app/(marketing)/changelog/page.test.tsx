import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import ChangelogPage from './page';
import { CHANGELOG } from '../../../content/changelog';

describe('ChangelogPage', () => {
  it('renders every entry with its highlights, newest first', () => {
    render(<ChangelogPage />);
    const list = screen.getByRole('list', { name: 'Changelog entries' });
    const headings = within(list).getAllByRole('heading', { level: 2 });
    expect(headings.map((h) => h.textContent)).toEqual(CHANGELOG.map((e) => e.title));
    expect(screen.getByText(CHANGELOG[0].highlights[0])).toBeDefined();
  });
});
