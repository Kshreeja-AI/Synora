'use client';

import React from 'react';
import { ChevronDown } from 'lucide-react';
import { Card, CardContent } from './Card';
import { cn } from '../lib/cn';

export interface FAQItemProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Question text */
  question: string;
  /** Answer text */
  answer: string;
  /** Whether item starts expanded */
  defaultOpen?: boolean;
}

/**
 * FAQItem
 *
 * Accessible collapsible FAQ item using native HTML <details> element.
 * Supports keyboard navigation and screen readers.
 * Motion-aware with smooth open/close animation.
 *
 * @example
 * ```tsx
 * <FAQItem
 *   question="How does Synora work?"
 *   answer="Synora is a unified workspace for AI-powered content creation..."
 * />
 * ```
 */
export const FAQItem = React.forwardRef<HTMLDivElement, FAQItemProps>(
  (
    {
      question,
      answer,
      defaultOpen = false,
      className,
      ...props
    },
    ref
  ) => (
    <Card ref={ref} className={cn('overflow-hidden', className)} {...props}>
      <CardContent className="p-0">
        <details open={defaultOpen} className="group">
          {/* Summary (always visible) */}
          <summary
            className={cn(
              'flex cursor-pointer items-center justify-between px-6 py-4',
              'font-semibold text-foreground',
              'hover:bg-card/50 transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50'
            )}
          >
            {question}

            {/* Animated chevron */}
            <div
              className="group-open:rotate-180 transition-transform"
              aria-hidden
            >
              <ChevronDown className="h-5 w-5 flex-shrink-0" />
            </div>
          </summary>

          {/* Answer (revealed when open) */}
          <p className="border-t border-border/30 px-6 py-4 text-sm text-muted-foreground leading-relaxed">
            {answer}
          </p>
        </details>
      </CardContent>
    </Card>
  )
);

FAQItem.displayName = 'FAQItem';
