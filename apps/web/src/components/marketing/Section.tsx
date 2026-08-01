import { cn } from '@synora/design-system';

export function Section({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLElement>): React.JSX.Element {
  return (
    <section className={cn('mx-auto max-w-7xl px-4 py-24 sm:py-32 sm:px-6 lg:px-8', className)} {...props}>
      {children}
    </section>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
}): React.JSX.Element {
  return (
    <div className="mx-auto mb-16 max-w-2xl text-center">
      {eyebrow && (
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {eyebrow}
        </p>
      )}
      <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">{title}</h2>
      {description && <p className="mt-4 text-base text-muted-foreground sm:text-lg">{description}</p>}
    </div>
  );
}
