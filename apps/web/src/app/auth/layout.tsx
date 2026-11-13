import Link from 'next/link';
import { ShieldCheck, Layers, GitBranch } from 'lucide-react';
import { Logo } from '../../components/brand/Logo';

// Statements about the product as it is built, not aspirations: each one
// names something that exists in this codebase today.
const POINTS = [
  {
    icon: Layers,
    title: 'One workspace, many models',
    body: 'Conversations, agents and media generation run through a single provider-agnostic engine.',
  },
  {
    icon: GitBranch,
    title: 'You approve what runs',
    body: 'Agent plans and risky steps wait for a decision before anything is executed.',
  },
  {
    icon: ShieldCheck,
    title: 'Sessions you control',
    body: 'Rotating sessions, optional two-factor authentication, and sign-out everywhere.',
  },
];

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="grid min-h-dvh bg-background lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <aside className="relative hidden overflow-hidden border-r border-border bg-card lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
        <div
          aria-hidden
          className="bg-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_top_left,black_10%,transparent_70%)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -left-40 -top-40 h-[480px] w-[480px] rounded-full bg-primary/10 blur-3xl"
        />

        <Link href="/" className="relative w-fit rounded-md" aria-label="Synora home">
          <Logo />
        </Link>

        <div className="relative max-w-md">
          <h2 className="text-3xl font-semibold leading-tight tracking-tightest text-foreground xl:text-4xl">
            The workspace where AI work stays under your control.
          </h2>
          <ul className="mt-10 space-y-6">
            {POINTS.map((point) => {
              const Icon = point.icon;
              return (
                <li key={point.title} className="flex gap-4">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-primary">
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  <span>
                    <span className="block text-sm font-medium text-foreground">{point.title}</span>
                    <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">
                      {point.body}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        <p className="relative text-xs text-muted-foreground">
          &copy; {new Date().getFullYear()} Synora
        </p>
      </aside>

      <main className="flex min-h-dvh flex-col px-5 py-8 sm:px-8">
        <Link href="/" className="w-fit rounded-md lg:hidden" aria-label="Synora home">
          <Logo />
        </Link>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[400px] animate-fade-up">{children}</div>
        </div>
      </main>
    </div>
  );
}
