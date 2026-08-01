'use client';

import React from 'react';
import { cn } from '../lib/cn';

export interface StatCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** The stat metric (e.g., "100ms", "10+") */
  metric: string | React.ReactNode;
  /** The label describing the metric */
  label: string | React.ReactNode;
  /** Optional icon component */
  icon?: React.ReactNode;
  /** Visual variant */
  variant?: 'default' | 'highlighted' | 'gradient';
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
}

const variantStyles = {
  default: 'bg-gradient-to-br from-primary/8 to-transparent border border-border/30',
  highlighted: 'bg-gradient-to-br from-primary/12 to-transparent border border-primary/20',
  gradient: 'bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border border-primary/15',
};

const sizeStyles = {
  sm: 'p-4 rounded-md',
  md: 'p-6 rounded-lg',
  lg: 'p-8 rounded-lg',
};

const metricSizeStyles = {
  sm: 'text-2xl',
  md: 'text-3xl',
  lg: 'text-4xl',
};

const labelSizeStyles = {
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-base',
};

const iconSizeStyles = {
  sm: 'h-5 w-5 mb-2',
  md: 'h-6 w-6 mb-3',
  lg: 'h-8 w-8 mb-4',
};

/**
 * StatCard
 *
 * Card component for displaying key metrics and statistics.
 * Supports variants for different visual emphasis and sizes for responsive layouts.
 * Typically used in hero sections and performance/metrics sections.
 *
 * @example
 * ```tsx
 * <StatCard
 *   metric="10+"
 *   label="AI providers supported"
 *   variant="highlighted"
 * />
 * ```
 */
export const StatCard = React.forwardRef<HTMLDivElement, StatCardProps>(
  (
    {
      metric,
      label,
      icon,
      variant = 'default',
      size = 'md',
      className,
      ...props
    },
    ref
  ) => (
    <div
      ref={ref}
      className={cn(
        'text-center transition-all hover:shadow-md',
        variantStyles[variant],
        sizeStyles[size],
        className
      )}
      {...props}
    >
      {icon && (
        <div
          className={cn('text-primary flex-shrink-0 inline-block', iconSizeStyles[size])}
          aria-hidden
        >
          {icon}
        </div>
      )}
      <div className={cn('font-bold text-foreground', metricSizeStyles[size])}>
        {metric}
      </div>
      <div className={cn('text-muted-foreground', labelSizeStyles[size])}>
        {label}
      </div>
    </div>
  )
);

StatCard.displayName = 'StatCard';
