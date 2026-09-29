'use client';

import React from 'react';
import { Button } from './Button';
import { cn } from '../lib/cn';

export interface CTAProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Main heading text */
  heading: string;
  /** Description text below heading */
  description?: string;
  /** CTA button label */
  ctaLabel?: string;
  /** CTA button href */
  ctaHref?: string;
  /** Secondary button label */
  secondaryLabel?: string;
  /** Secondary button href */
  secondaryHref?: string;
  /** Visual variant */
  variant?: 'primary' | 'secondary' | 'gradient';
}

const variantStyles = {
  primary: 'bg-gradient-to-br from-primary/12 via-background to-fuchsia-500/8 border-primary/20',
  secondary: 'bg-card/50 border-border/30',
  gradient: 'bg-gradient-to-br from-primary/8 to-transparent border-border/20',
};

/**
 * CTA
 *
 * Call-to-action section component with heading, description, and action buttons.
 * Commonly used as final persuasion section before signup/login.
 * Supports multiple visual variants and flexible button configurations.
 *
 * @example
 * ```tsx
 * <CTA
 *   heading="Ready to get started?"
 *   description="Join creators using Synora to transform their workflow."
 *   ctaLabel="Start free now"
 *   ctaHref="/auth/register"
 * />
 * ```
 */
export const CTA = React.forwardRef<HTMLDivElement, CTAProps>(
  (
    {
      heading,
      description,
      ctaLabel = 'Get started',
      ctaHref,
      secondaryLabel,
      secondaryHref,
      variant = 'primary',
      className,
      ...props
    },
    ref
  ) => (
    <div
      ref={ref}
      className={cn(
        'relative overflow-hidden rounded-2xl border p-12 text-center sm:p-16 lg:p-20',
        variantStyles[variant],
        className
      )}
      {...props}
    >
      {/* Heading */}
      <h2 className="mx-auto max-w-2xl text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
        {heading}
      </h2>

      {/* Description */}
      {description && (
        <p className="mx-auto mt-4 max-w-xl text-sm text-muted-foreground sm:text-base leading-relaxed">
          {description}
        </p>
      )}

      {/* Actions */}
      <div className="mt-8 flex flex-col gap-3 items-center justify-center sm:flex-row">
        <Button asChild size="lg">
          {ctaHref ? <a href={ctaHref}>{ctaLabel}</a> : <button>{ctaLabel}</button>}
        </Button>

        {secondaryLabel && (
          <Button asChild variant="outline" size="lg">
            {secondaryHref ? (
              <a href={secondaryHref}>{secondaryLabel}</a>
            ) : (
              <button>{secondaryLabel}</button>
            )}
          </Button>
        )}
      </div>
    </div>
  )
);

CTA.displayName = 'CTA';
