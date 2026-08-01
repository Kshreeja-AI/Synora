'use client';

import React from 'react';
import { Card, CardContent } from './Card';
import { Badge } from './Badge';
import { cn } from '../lib/cn';

export interface FeatureCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Icon component or emoji string */
  icon: React.ReactNode;
  /** Card title */
  title: string;
  /** Card description */
  description: string;
  /** Optional badge for status (e.g., "Coming soon") */
  badge?: {
    label: string;
    variant?: 'default' | 'secondary' | 'destructive' | 'outline';
  };
  /** Visual variant */
  variant?: 'default' | 'highlighted' | 'gradient';
  /** Responsive sizing */
  size?: 'sm' | 'md' | 'lg';
  /** Whether card is interactive (adds hover effects) */
  interactive?: boolean;
  /** Optional URL for link behavior */
  href?: string;
}

const variantStyles = {
  default: 'border-border/50 bg-card',
  highlighted: 'border-primary/40 bg-gradient-to-br from-primary/5 to-transparent',
  gradient: 'border-border/30 bg-gradient-to-br from-card to-background',
};

const sizeStyles = {
  sm: 'p-4',
  md: 'p-6',
  lg: 'p-8',
};

const iconSizeStyles = {
  sm: 'h-6 w-6 mb-2',
  md: 'h-8 w-8 mb-4',
  lg: 'h-10 w-10 mb-4',
};

const titleStyles = {
  sm: 'text-base',
  md: 'text-lg',
  lg: 'text-xl',
};

const descriptionStyles = {
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-sm',
};

/**
 * FeatureCard
 *
 * Reusable card component for displaying features with icon, title, and description.
 * Supports multiple variants, sizes, and responsive layouts.
 * Fully accessible with semantic HTML and ARIA attributes.
 *
 * @example
 * ```tsx
 * <FeatureCard
 *   icon={<Code2 />}
 *   title="Code Generation"
 *   description="Write, edit, and refactor code with AI assistance"
 *   badge={{ label: 'Coming soon', variant: 'secondary' }}
 * />
 * ```
 */
export const FeatureCard = React.forwardRef<HTMLDivElement, FeatureCardProps>(
  (
    {
      icon,
      title,
      description,
      badge,
      variant = 'default',
      size = 'md',
      interactive = true,
      href,
      className,
      ...props
    },
    ref
  ) => {
    const content = (
      <Card
        ref={ref}
        className={cn(
          variantStyles[variant],
          'h-full transition-all',
          interactive && 'hover:border-primary/30 hover:shadow-md',
          className
        )}
        {...props}
      >
        <CardContent className={cn(sizeStyles[size])}>
          {/* Icon */}
          <div className={cn('text-foreground flex-shrink-0', iconSizeStyles[size])} aria-hidden>
            {icon}
          </div>

          {/* Title with optional badge */}
          <div className="mb-2 flex items-start gap-2">
            <h3 className={cn('font-semibold text-foreground', titleStyles[size])}>{title}</h3>
            {badge && <Badge variant={badge.variant}>{badge.label}</Badge>}
          </div>

          {/* Description */}
          <p className={cn('leading-relaxed text-muted-foreground', descriptionStyles[size])}>
            {description}
          </p>
        </CardContent>
      </Card>
    );

    if (href) {
      return (
        <a href={href} className="block no-underline hover:no-underline">
          {content}
        </a>
      );
    }

    return content;
  }
);

FeatureCard.displayName = 'FeatureCard';
