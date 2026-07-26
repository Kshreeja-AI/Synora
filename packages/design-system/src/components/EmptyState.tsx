import React from 'react';
import { cn } from '../lib/cn';

export interface EmptyStateProps extends React.ComponentPropsWithoutRef<'div'> {
  /** Typically a lucide-react icon element, e.g. `<Inbox />`. */
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(
  ({ icon, title, description, action, className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border px-6 py-16 text-center',
        className
      )}
      {...props}
    >
      {icon && (
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground [&>svg]:size-6">
          {icon}
        </div>
      )}
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
);
EmptyState.displayName = 'EmptyState';

export { EmptyState };
