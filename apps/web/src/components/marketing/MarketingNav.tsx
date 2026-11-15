'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Menu, X } from 'lucide-react';
import { Button, cn } from '@synora/design-system';
import { ThemeToggle } from './ThemeToggle';
import { Logo } from '../brand/Logo';

const NAV_LINKS = [
  { href: '/#features', label: 'Features' },
  { href: '/#providers', label: 'Providers' },
  { href: '/#security', label: 'Security' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/changelog', label: 'Changelog' },
];

export function MarketingNav(): React.JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md">
      <nav
        aria-label="Main"
        className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5 sm:px-8"
      >
        <Link href="/" aria-label="Synora home" className="rounded-md">
          <Logo markClassName="h-7 w-7" />
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div className="hidden items-center gap-2 md:flex">
          <ThemeToggle />
          <Button asChild variant="ghost" size="sm">
            <Link href="/auth/login">Sign in</Link>
          </Button>
          <Button asChild variant="primary" size="sm">
            <Link href="/auth/register">Create account</Link>
          </Button>
        </div>

        <div className="flex items-center gap-1 md:hidden">
          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon"
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X aria-hidden /> : <Menu aria-hidden />}
          </Button>
        </div>
      </nav>

      <div
        id="mobile-menu"
        className={cn('border-t border-border/60 md:hidden', open ? 'block' : 'hidden')}
      >
        <div className="space-y-1 px-4 py-3">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="block rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
          <div className="flex gap-2 pt-2">
            <Button asChild variant="outline" size="sm" className="flex-1">
              <Link href="/auth/login">Sign in</Link>
            </Button>
            <Button asChild variant="primary" size="sm" className="flex-1">
              <Link href="/auth/register">Create account</Link>
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}
