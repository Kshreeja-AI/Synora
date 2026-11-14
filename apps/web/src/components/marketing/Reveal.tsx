'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@synora/design-system';

export interface RevealProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Stagger, in milliseconds, for items revealed together. */
  delay?: number;
}

/**
 * Fades content up as it scrolls into view.
 *
 * The server-rendered markup is fully visible. The hidden starting state is
 * applied only after mount, only below the fold, and only when the visitor
 * has not asked for reduced motion — so content can never be stranded
 * invisible by a missing script, a failed observer, or a motion preference.
 */
export function Reveal({ delay = 0, className, children, ...props }: RevealProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (el.getBoundingClientRect().top < window.innerHeight * 0.92) return;

    el.style.opacity = '0';
    el.style.transform = 'translateY(16px)';

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        el.style.transition = `opacity 600ms cubic-bezier(0.16,1,0.3,1) ${delay}ms, transform 600ms cubic-bezier(0.16,1,0.3,1) ${delay}ms`;
        el.style.opacity = '1';
        el.style.transform = 'none';
        observer.disconnect();
      },
      { rootMargin: '0px 0px -8% 0px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [delay]);

  return (
    <div ref={ref} className={cn(className)} {...props}>
      {children}
    </div>
  );
}
