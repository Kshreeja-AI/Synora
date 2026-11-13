import { cn } from '@synora/design-system';

export interface LogoMarkProps {
  className?: string;
}

/**
 * The Synora mark: two offset arcs that read as an "S" and as two things
 * meeting. Drawn in currentColor on a token-coloured tile so it follows
 * the theme without a second asset.
 */
export function LogoMark({ className }: LogoMarkProps): React.JSX.Element {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-foreground text-background',
        className
      )}
    >
      <svg viewBox="0 0 24 24" fill="none" className="h-[62%] w-[62%]">
        <path
          d="M17.5 7.5C16.4 5.9 14.5 5 12.3 5 9.4 5 7 6.6 7 9.1c0 5 10 2.6 10 7.3 0 2.3-2.3 3.6-5 3.6-2.4 0-4.5-1-5.5-2.8"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

export interface LogoProps {
  className?: string;
  markClassName?: string;
}

export function Logo({ className, markClassName }: LogoProps): React.JSX.Element {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark className={markClassName} />
      <span className="text-[17px] font-semibold tracking-tight text-foreground">Synora</span>
    </span>
  );
}
