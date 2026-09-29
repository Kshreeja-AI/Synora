'use client';

import React from 'react';
import { cn } from '../lib/cn';

export interface HeadingProps extends React.HTMLAttributes<HTMLHeadingElement> {
  /** Heading level (h1-h6) */
  level: 1 | 2 | 3 | 4 | 5 | 6;
  /** Visual size (can differ from level for responsive design) */
  size?: 'xs' | 'sm' | 'base' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl' | '6xl' | '7xl';
  /** Text variant */
  variant?: 'default' | 'gradient' | 'muted';
  /** Font weight */
  weight?: 'normal' | 'semibold' | 'bold';
  /** Letter spacing */
  tracking?: 'normal' | 'wide' | 'wider' | 'widest';
}

const sizeStyles = {
  xs: 'text-xs',
  sm: 'text-sm',
  base: 'text-base',
  lg: 'text-lg',
  xl: 'text-xl',
  '2xl': 'text-2xl',
  '3xl': 'text-3xl',
  '4xl': 'text-4xl',
  '5xl': 'text-5xl',
  '6xl': 'text-6xl',
  '7xl': 'text-7xl',
};

const variantStyles = {
  default: 'text-foreground',
  gradient: 'bg-gradient-to-br from-foreground via-foreground to-muted-foreground bg-clip-text text-transparent',
  muted: 'text-muted-foreground',
};

const weightStyles = {
  normal: 'font-normal',
  semibold: 'font-semibold',
  bold: 'font-bold',
};

const trackingStyles = {
  normal: 'tracking-normal',
  wide: 'tracking-wide',
  wider: 'tracking-wider',
  widest: 'tracking-widest',
};

/**
 * Heading
 *
 * Semantic heading component with flexible styling and sizing.
 * Supports multiple variants, sizes, and responsive configurations.
 * Ensures proper heading hierarchy for accessibility and SEO.
 *
 * @example
 * ```tsx
 * <Heading level={1} size="5xl" variant="gradient">
 *   Welcome to Synora
 * </Heading>
 * ```
 */
export const Heading = React.forwardRef<
  HTMLHeadingElement,
  HeadingProps & { children: React.ReactNode }
>(
  (
    {
      level,
      size = 'lg',
      variant = 'default',
      weight = 'bold',
      tracking = 'normal',
      className,
      children,
      ...props
    },
    ref
  ) => {
    const Component = `h${level}` as const;

    return React.createElement(
      Component,
      {
        ref,
        className: cn(
          sizeStyles[size],
          variantStyles[variant],
          weightStyles[weight],
          trackingStyles[tracking],
          className
        ),
        ...props,
      },
      children
    );
  }
);

Heading.displayName = 'Heading';
