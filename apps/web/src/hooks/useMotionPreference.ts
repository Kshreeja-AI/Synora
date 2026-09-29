'use client';

import { useEffect, useState } from 'react';

/**
 * useMotionPreference
 *
 * Detects and respects user's prefers-reduced-motion preference.
 * Returns true if user prefers reduced motion, false otherwise.
 *
 * Usage:
 *   const prefersReducedMotion = useMotionPreference();
 *   const variants = prefersReducedMotion ? reducedVariants : normalVariants;
 */
export function useMotionPreference(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    // Check initial preference
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mediaQuery.matches);

    // Listen for changes
    const handleChange = (e: MediaQueryListEvent) => {
      setPrefersReducedMotion(e.matches);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  return prefersReducedMotion;
}
