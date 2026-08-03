'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { en, type Dictionary, type MessageKey } from './messages/en';
import { DEFAULT_LOCALE, resolveLocale, SUPPORTED_LOCALES } from './locales';

/**
 * Client-side i18n runtime.
 *
 * Design principles:
 *   • Zero external deps — a hand-rolled resolver is easier to reason
 *     about than pulling in a full framework for what starts as one
 *     locale, and it lets us keep the tightly-typed MessageKey guarantee.
 *   • Type-safe keys — a typo in a message id fails at build time, not
 *     at render as an empty string.
 *   • Fall back gracefully — a missing key in a non-default locale
 *     resolves to the English string, then to the raw key. The UI is
 *     never empty because a translator was slow.
 *   • Native Intl for numbers and dates — the platform ships with better
 *     locale-aware formatting than any polyfill, so we use it.
 */

const LOCALE_STORAGE_KEY = 'synora.locale';

// Dictionary registry keyed by locale code. Extend in place when adding
// locales; each entry must be a full copy of `en` (missing keys fall back
// but "opting into a locale means committing to keep it whole" is the
// working policy).
const DICTIONARIES: Record<string, Dictionary> = { en };

interface I18nContextValue {
  locale: string;
  setLocale: (next: string) => void;
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function readDotPath(dict: unknown, path: string): unknown {
  let node: unknown = dict;
  for (const segment of path.split('.')) {
    if (node && typeof node === 'object' && segment in node) {
      node = (node as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return node;
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  // Simple `{name}` substitution — no expressions, no HTML injection risk
  // because callers pass primitives and React handles escaping at render.
  return template.replace(/\{(\w+)\}/g, (match, name) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/** Pure resolver — exported so tests and non-React code can share it. */
export function translate(
  locale: string,
  key: MessageKey,
  params?: Record<string, string | number>
): string {
  const localized = DICTIONARIES[locale];
  const fromLocale = localized ? readDotPath(localized, key) : undefined;
  if (typeof fromLocale === 'string') return interpolate(fromLocale, params);
  // Fallback #1: English source.
  const fromEnglish = readDotPath(en, key);
  if (typeof fromEnglish === 'string') return interpolate(fromEnglish, params);
  // Fallback #2: the raw key. Better than an empty string for debugging.
  return key;
}

interface I18nProviderProps {
  /** Initial locale — usually from server-side user prefs. Client will
   *  overwrite from localStorage if present, then from navigator.language. */
  initialLocale?: string;
  children: React.ReactNode;
}

export function I18nProvider({ initialLocale, children }: I18nProviderProps): React.JSX.Element {
  const [locale, setLocaleState] = useState<string>(() =>
    resolveLocale(initialLocale ?? DEFAULT_LOCALE)
  );

  useEffect(() => {
    // Client-side preference resolution runs once on mount, in priority:
    // localStorage → navigator.language → the prop → DEFAULT_LOCALE. This
    // means the app respects a user's last explicit choice across sessions
    // without needing a round-trip to the server.
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    const nav = window.navigator?.language;
    const chosen = resolveLocale(stored ?? nav ?? initialLocale);
    if (chosen !== locale) setLocaleState(chosen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setLocale = (next: string) => {
    const resolved = resolveLocale(next);
    setLocaleState(resolved);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, resolved);
      // Update the html lang attribute so screen readers and font-hinting
      // pick up the change immediately.
      document.documentElement.lang = resolved;
    }
  };

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      t: (key, params) => translate(locale, key, params),
    }),
    [locale]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // Without a provider we still translate — every callable in this
    // module is safe standalone — so components render usefully in tests
    // that don't wrap them. Locale switching just no-ops in that mode.
    return {
      locale: DEFAULT_LOCALE,
      setLocale: () => {},
      t: (key: MessageKey, params?: Record<string, string | number>) =>
        translate(DEFAULT_LOCALE, key, params),
    };
  }
  return ctx;
}

export { SUPPORTED_LOCALES, DEFAULT_LOCALE, resolveLocale };
export type { MessageKey };
