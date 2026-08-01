'use client';

import React from 'react';
import { Card, CardContent } from './Card';
import { cn } from '../lib/cn';

export interface StepCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Step number or identifier */
  step: string | number;
  /** Step title */
  title: string;
  /** Step description */
  description: string;
  /** Visual variant */
  variant?: 'default' | 'highlighted';
  /** Customize step indicator styling */
  stepIndicatorClassName?: string;
}

/**
 * StepCard
 *
 * Card component for displaying workflow or process steps.
 * Features numbered or custom step indicators and clear hierarchy.
 * Commonly used in "How it works" or process sections.
 *
 * @example
 * ```tsx
 * <StepCard
 *   step={1}
 *   title="Create"
 *   description="Start a new project or conversation"
 * />
 * ```
 */
export const StepCard = React.forwardRef<HTMLDivElement, StepCardProps>(
  (
    {
      step,
      title,
      description,
      variant = 'default',
      stepIndicatorClassName,
      className,
      ...props
    },
    ref
  ) => (
    <Card
      ref={ref}
      className={cn(
        'h-full',
        variant === 'highlighted' && 'border-primary/30 bg-primary/5',
        className
      )}
      {...props}
    >
      <CardContent className="p-6">
        {/* Step Indicator */}
        <div
          className={cn(
            'mb-4 flex h-10 w-10 items-center justify-center rounded-full text-xs font-bold',
            'bg-primary text-primary-foreground',
            stepIndicatorClassName
          )}
          aria-label={`Step ${step}`}
        >
          {step}
        </div>

        {/* Title */}
        <h4 className="mb-2 font-semibold text-foreground">{title}</h4>

        {/* Description */}
        <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
      </CardContent>
    </Card>
  )
);

StepCard.displayName = 'StepCard';
