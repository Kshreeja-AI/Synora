/**
 * Changelog content. Newest entry first — a test enforces ordering.
 * Entries describe what actually shipped; no aspirational entries.
 */
export interface ChangelogEntry {
  date: string; // ISO yyyy-mm-dd
  title: string;
  tag: 'release' | 'feature' | 'improvement' | 'fix';
  description: string;
  highlights: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: '2026-07-25',
    title: 'Design system & frontend foundation',
    tag: 'feature',
    description:
      'The visual and technical foundation for the full Synora platform: a token-driven dark-first design system and a hardened frontend data layer.',
    highlights: [
      'New design system: dark-mode-first theme, accessible Radix-based components, premium Geist typography',
      'Automatic session refresh — signed-in sessions now renew seamlessly in the background',
      'Faster, more consistent styling across every page',
    ],
  },
  {
    date: '2026-07-23',
    title: 'Synora 1.0 — launchable core',
    tag: 'release',
    description:
      'The first production-ready release of the Synora platform core.',
    highlights: [
      'Accounts with secure sign-in, rotating sessions, and lockout protection',
      'Projects and documents with per-user isolation',
      'AI text & code generation across 10 interchangeable providers — switch providers via configuration only',
      'Production hardening: rate limiting, audited secrets, container deployment, full CI pipeline',
    ],
  },
];
