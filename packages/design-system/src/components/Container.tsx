'use client';

import React from 'react';
import { cn } from '../lib/cn';

export interface ContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Max width of container */
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full';
  /** Horizontal padding */
  padding?: 'none' | 'sm' | 'md' | 'lg';
  /** Center content */
  center?: boolean;
}

const sizeStyles = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  full: 'max-w-full',
};

const paddingStyles = {
  none: 'px-0',
  sm: 'px-4 sm:px-6',
  md: 'px-6 sm:px-8 lg:px-10',
  lg: 'px-8 sm:px-12 lg:px-16',
};

/**
 * Container
 *
 * Layout container component with configurable sizing and padding.
 * Provides consistent max-width constraints and horizontal spacing across the app.
 * Used to wrap page content and ensure proper text line lengths and readability.
 *
 * @example
 * ```tsx
 * <Container size="2xl" padding="md" center>
 *   <h1>Content here</h1>
 * </Container>
 * ```
 */
export const Container = React.forwardRef<HTMLDivElement, ContainerProps>(
  (
    {
      size = '2xl',
      padding = 'md',
      center = true,
      className,
      ...props
    },
    ref
  ) => (
    <div
      ref={ref}
      className={cn(
        sizeStyles[size],
        paddingStyles[padding],
        center && 'mx-auto',
        className
      )}
      {...props}
    />
  )
);

Container.displayName = 'Container';
