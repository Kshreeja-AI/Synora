'use client';

import React from 'react';
import { Card, CardContent } from './Card';
import { cn } from '../lib/cn';

export interface TestimonialCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Quote or testimonial text */
  content: string;
  /** Author name */
  author: string;
  /** Author's role or title */
  role: string;
  /** Avatar (emoji, image URL, or initials) */
  avatar?: string;
  /** Company or organization name */
  company?: string;
}

/**
 * TestimonialCard
 *
 * Card component for displaying customer testimonials.
 * Shows quote with author information and optional avatar.
 * Fully responsive and accessible.
 *
 * @example
 * ```tsx
 * <TestimonialCard
 *   content="Synora transformed how our team creates content."
 *   author="Jane Doe"
 *   role="Creative Director"
 *   company="Studio Pro"
 *   avatar="👩‍💼"
 * />
 * ```
 */
export const TestimonialCard = React.forwardRef<HTMLDivElement, TestimonialCardProps>(
  (
    {
      content,
      author,
      role,
      avatar,
      company,
      className,
      ...props
    },
    ref
  ) => (
    <Card ref={ref} className={cn('h-full', className)} {...props}>
      <CardContent className="p-6 flex flex-col h-full">
        {/* Quote */}
        <p className="mb-6 text-sm leading-relaxed text-muted-foreground italic flex-1">
          "{content}"
        </p>

        {/* Divider */}
        <div className="border-t border-border/20 mb-4" />

        {/* Author */}
        <div className="flex items-center gap-3">
          {avatar && (
            <div className="text-2xl flex-shrink-0" aria-hidden>
              {avatar}
            </div>
          )}
          <div>
            <p className="text-sm font-semibold text-foreground">{author}</p>
            <p className="text-xs text-muted-foreground">
              {role}
              {company && ` • ${company}`}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
);

TestimonialCard.displayName = 'TestimonialCard';
