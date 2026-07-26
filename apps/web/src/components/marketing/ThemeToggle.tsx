'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@synora/design-system';

export function ThemeToggle(): React.JSX.Element {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Theme is unknown until hydration; render a stable placeholder first.
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <Button variant="ghost" size="icon" aria-label="Toggle theme" disabled>
        <Sun aria-hidden />
      </Button>
    );
  }

  const isDark = resolvedTheme === 'dark';
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
    >
      {isDark ? <Sun aria-hidden /> : <Moon aria-hidden />}
    </Button>
  );
}
