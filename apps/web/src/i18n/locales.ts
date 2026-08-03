/**
 * Supported locales — the single source of truth for what the frontend
 * knows how to render in. Adding a locale means adding a dictionary at
 * `messages/<code>.ts` and appending its metadata here.
 *
 * `code` follows BCP 47 (e.g. 'en', 'en-GB', 'de'). The default is 'en' —
 * the fallback for anything unmatched and the source-of-truth dictionary
 * every other locale is measured against.
 */
export interface LocaleInfo {
  /** BCP 47 tag — never localized. */
  readonly code: string;
  /** Endonym: what a native speaker of this language calls it. */
  readonly nativeLabel: string;
  /** English name shown next to the endonym in the picker. */
  readonly englishLabel: string;
}

export const DEFAULT_LOCALE = 'en';

export const SUPPORTED_LOCALES: readonly LocaleInfo[] = [
  { code: 'en', nativeLabel: 'English', englishLabel: 'English' },
  // Additional locales register here as their dictionaries land. The
  // resolver falls back to `en` for any missing key, so a partial
  // translation ships gracefully.
];

export function isSupportedLocale(code: string): boolean {
  return SUPPORTED_LOCALES.some((l) => l.code === code);
}

/**
 * Pick a supported locale from a raw preference string (from user prefs,
 * navigator.language, or a URL param). Handles case, region tags
 * (`en-US` → `en`), and unknown inputs — always resolves to something
 * renderable, never throws.
 */
export function resolveLocale(preferred: string | null | undefined): string {
  if (!preferred) return DEFAULT_LOCALE;
  const normalized = preferred.toLowerCase();
  const exact = SUPPORTED_LOCALES.find((l) => l.code.toLowerCase() === normalized);
  if (exact) return exact.code;
  const primary = normalized.split(/[-_]/)[0];
  const language = SUPPORTED_LOCALES.find((l) => l.code.toLowerCase() === primary);
  return language ? language.code : DEFAULT_LOCALE;
}
