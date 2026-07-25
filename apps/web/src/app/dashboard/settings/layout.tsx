'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@synora/design-system';

const SETTINGS_NAV = [
  { href: '/dashboard/settings/profile', label: 'Profile' },
  { href: '/dashboard/settings/account', label: 'Account' },
  { href: '/dashboard/settings/sessions', label: 'Sessions' },
];

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const pathname = usePathname();

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-3xl font-bold text-foreground">Settings</h1>

      <nav
        aria-label="Settings sections"
        className="mb-8 inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground"
      >
        {SETTINGS_NAV.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-all',
                active
                  ? 'bg-background text-foreground shadow'
                  : 'hover:text-foreground'
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      {children}
    </div>
  );
}
