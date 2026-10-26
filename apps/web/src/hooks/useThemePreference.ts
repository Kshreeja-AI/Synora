'use client';

import { useEffect } from 'react';
import { useTheme } from 'next-themes';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCurrentUser } from './useCurrentUser';
import { updatePreferences } from '../lib/api/account';
import type { PreferencesResponse } from '../lib/api/types';

type ThemePreference = PreferencesResponse['theme'];

const TO_NEXT_THEMES: Record<ThemePreference, string> = {
  LIGHT: 'light',
  DARK: 'dark',
  AUTO: 'system',
};

const FROM_NEXT_THEMES: Record<string, ThemePreference> = {
  light: 'LIGHT',
  dark: 'DARK',
  system: 'AUTO',
};

export interface UseThemePreferenceResult {
  current: ThemePreference;
  selectTheme: (value: ThemePreference) => void;
}

/**
 * Bridges `next-themes` (local, instant) with the server-side theme
 * preference (`UserPreferences.theme`, from M3) so the choice follows the
 * user across devices. On first load after sign-in, the server value wins;
 * from then on, a user-initiated change updates both together.
 */
export function useThemePreference(): UseThemePreferenceResult {
  const { theme, setTheme } = useTheme();
  const { data: user } = useCurrentUser();
  const queryClient = useQueryClient();

  useEffect(() => {
    const serverTheme = user?.preferences.theme;
    if (!serverTheme) return;
    const mapped = TO_NEXT_THEMES[serverTheme];
    if (mapped !== theme) {
      setTheme(mapped);
    }
  }, [user?.preferences.theme, theme, setTheme]);

  const mutation = useMutation({
    mutationFn: (value: ThemePreference) => updatePreferences({ theme: value }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users', 'me'] }),
  });

  function selectTheme(value: ThemePreference): void {
    setTheme(TO_NEXT_THEMES[value]);
    mutation.mutate(value);
  }

  const current: ThemePreference = (theme ? FROM_NEXT_THEMES[theme] : undefined) ?? 'AUTO';

  return { current, selectTheme };
}
