'use client';

import { useEffect, useRef, useState } from 'react';

interface UseScrollRevealOptions {
  once?: boolean; // Only animate once, then keep in view state
  threshold?: number | number[]; // IntersectionObserver threshold
  margin?: string; // IntersectionObserver rootMargin
}

/**
 * useScrollReveal
 *
 * Triggers animation when element enters viewport.
 * Returns ref to attach to element and isVisible state.
 * Falls back to immediate visibility in SSR/test environments.
 *
 * Usage:
 *   const { ref, isVisible } = useScrollReveal();
 *   <motion.div ref={ref} animate={isVisible ? 'visible' : 'hidden'} variants={...} />
 */
export function useScrollReveal(options: UseScrollRevealOptions = {}) {
  const { once = true, threshold = 0.1, margin = '-50px' } = options;
  const ref = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const hasAnimated = useRef(false);

  useEffect(() => {
    if (!ref.current) return;

    // Skip if already animated and once=true
    if (once && hasAnimated.current) {
      setIsVisible(true);
      return;
    }

    // Check if IntersectionObserver is available (not in test environment)
    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          if (once) {
            hasAnimated.current = true;
            observer.unobserve(entry.target);
          }
        } else if (!once) {
          setIsVisible(false);
        }
      },
      { threshold, rootMargin: margin }
    );

    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [once, threshold, margin]);

  return { ref, isVisible };
}
