import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../lib/cn';

interface SpinnerProps extends React.SVGAttributes<SVGSVGElement> {
  size?: 'sm' | 'md' | 'lg';
}

const sizeClasses: Record<NonNullable<SpinnerProps['size']>, string> = {
  sm: 'h-4 w-4',
  md: 'h-6 w-6',
  lg: 'h-8 w-8',
};

function Spinner({ className, size = 'md', ...props }: SpinnerProps): React.JSX.Element {
  return (
    <Loader2
      role="status"
      aria-label="Loading"
      className={cn('animate-spin text-muted-foreground', sizeClasses[size], className)}
      {...props}
    />
  );
}

export { Spinner, type SpinnerProps };
