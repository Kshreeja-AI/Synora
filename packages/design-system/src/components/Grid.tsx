'use client';

import React from 'react';
import { cn } from '../lib/cn';

export interface GridProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Number of columns on desktop */
  cols?: 1 | 2 | 3 | 4 | 6;
  /** Number of columns on sm breakpoint */
  colsSm?: 1 | 2 | 3 | 4 | 6;
  /** Number of columns on lg breakpoint */
  colsLg?: 1 | 2 | 3 | 4 | 6;
  /** Gap between items */
  gap?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
}

const colsStyles = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
  6: 'grid-cols-6',
};

const smColsStyles = {
  1: 'sm:grid-cols-1',
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-4',
  6: 'sm:grid-cols-6',
};

const lgColsStyles = {
  1: 'lg:grid-cols-1',
  2: 'lg:grid-cols-2',
  3: 'lg:grid-cols-3',
  4: 'lg:grid-cols-4',
  6: 'lg:grid-cols-6',
};

const gapStyles = {
  xs: 'gap-2',
  sm: 'gap-4',
  md: 'gap-6',
  lg: 'gap-8',
  xl: 'gap-12',
};

/**
 * Grid
 *
 * Responsive grid layout component with configurable columns and gaps.
 * Supports mobile-first responsive design with different column counts per breakpoint.
 * Commonly used for card layouts, feature grids, and content organization.
 *
 * @example
 * ```tsx
 * <Grid cols={1} colsSm={2} colsLg={3} gap="md">
 *   <Card>Item 1</Card>
 *   <Card>Item 2</Card>
 *   <Card>Item 3</Card>
 * </Grid>
 * ```
 */
export const Grid = React.forwardRef<HTMLDivElement, GridProps>(
  (
    {
      cols = 1,
      colsSm,
      colsLg,
      gap = 'md',
      className,
      ...props
    },
    ref
  ) => (
    <div
      ref={ref}
      className={cn(
        'grid',
        colsStyles[cols],
        colsSm && smColsStyles[colsSm],
        colsLg && lgColsStyles[colsLg],
        gapStyles[gap],
        className
      )}
      {...props}
    />
  )
);

Grid.displayName = 'Grid';
