'use client';

import React from 'react';
import { Check } from 'lucide-react';
import { Card, CardContent } from './Card';
import { Button } from './Button';
import { cn } from '../lib/cn';

export interface PricingCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Plan name (e.g., "Pro", "Enterprise") */
  name: string;
  /** Price string (e.g., "$19", "Custom") */
  price: string;
  /** Optional price period (e.g., "/month") */
  period?: string;
  /** Plan description */
  description: string;
  /** List of features included */
  features: string[];
  /** Whether this is the most popular/highlighted plan */
  highlighted?: boolean;
  /** Optional CTA button label (default: "Get started") */
  ctaLabel?: string;
  /** Optional CTA button href */
  ctaHref?: string;
  /** Badge for plan (e.g., "Most Popular") */
  badge?: string;
}

/**
 * PricingCard
 *
 * Component for displaying pricing plans with features and CTA.
 * Supports highlighted state for promoting popular plans.
 * Fully responsive with proper semantic HTML.
 *
 * @example
 * ```tsx
 * <PricingCard
 *   name="Pro"
 *   price="$19"
 *   period="/month"
 *   description="Most popular"
 *   features={['Unlimited conversations', 'All AI providers']}
 *   highlighted
 *   ctaHref="/auth/register"
 * />
 * ```
 */
export const PricingCard = React.forwardRef<HTMLDivElement, PricingCardProps>(
  (
    {
      name,
      price,
      period,
      description,
      features,
      highlighted = false,
      ctaLabel = 'Get started',
      ctaHref,
      badge,
      className,
      ...props
    },
    ref
  ) => (
    <Card
      ref={ref}
      className={cn(
        'relative h-full transition-all',
        highlighted
          ? 'border-primary/40 bg-gradient-to-br from-primary/5 to-transparent lg:scale-105'
          : 'border-border/30',
        className
      )}
      {...props}
    >
      {highlighted && badge && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
          {badge}
        </div>
      )}

      <CardContent className="p-8 flex flex-col h-full">
        {/* Header */}
        <div className="mb-6">
          <h3 className="mb-1 text-lg font-semibold text-foreground">{name}</h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>

        {/* Price */}
        <div className="mb-8">
          <div className="flex items-baseline gap-1">
            <span className="text-4xl font-bold text-foreground">{price}</span>
            {period && <span className="text-sm text-muted-foreground">{period}</span>}
          </div>
        </div>

        {/* CTA Button */}
        <Button
          asChild={!!ctaHref}
          className="mb-8 w-full"
          variant={highlighted ? 'primary' : 'outline'}
        >
          {ctaHref ? <a href={ctaHref}>{ctaLabel}</a> : <button>{ctaLabel}</button>}
        </Button>

        {/* Features */}
        <ul className="space-y-3 flex-1">
          {features.map((feature) => (
            <li key={feature} className="flex items-start gap-3 text-sm text-foreground">
              <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" aria-hidden />
              {feature}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
);

PricingCard.displayName = 'PricingCard';
