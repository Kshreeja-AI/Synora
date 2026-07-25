'use client';

import React from 'react';
import { Toaster as SonnerToaster, toast } from 'sonner';

type ToasterProps = React.ComponentProps<typeof SonnerToaster>;

/**
 * App-level toast outlet. Renders once (in the root layout); fire toasts
 * anywhere with the re-exported `toast` function.
 */
function Toaster(props: ToasterProps): React.JSX.Element {
  return (
    <SonnerToaster
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-popover group-[.toaster]:text-popover-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg',
          description: 'group-[.toast]:text-muted-foreground',
          actionButton: 'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
          cancelButton: 'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
        },
      }}
      {...props}
    />
  );
}

export { Toaster, toast };
