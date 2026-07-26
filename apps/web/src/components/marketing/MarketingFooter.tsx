import Link from 'next/link';
import { FEATURES } from '../../content/features';

const PRODUCT_LINKS = FEATURES.map((f) => ({
  href: `/features/${f.slug}`,
  label: f.title,
}));

const RESOURCE_LINKS = [
  { href: '/pricing', label: 'Pricing' },
  { href: '/changelog', label: 'Changelog' },
  { href: 'https://github.com/kshreeja-ai/synora', label: 'GitHub', external: true },
];

const ACCOUNT_LINKS = [
  { href: '/auth/login', label: 'Sign in' },
  { href: '/auth/register', label: 'Create account' },
];

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: { href: string; label: string; external?: boolean }[];
}): React.JSX.Element {
  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold text-foreground">{title}</h3>
      <ul className="space-y-2">
        {links.map((link) => (
          <li key={link.href}>
            {link.external ? (
              <a
                href={link.href}
                rel="noopener noreferrer"
                target="_blank"
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {link.label}
              </a>
            ) : (
              <Link
                href={link.href}
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {link.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MarketingFooter(): React.JSX.Element {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-2 text-lg font-bold tracking-tight">
              <span
                aria-hidden
                className="inline-block h-5 w-5 rounded-md bg-gradient-to-br from-primary to-fuchsia-500"
              />
              Synora
            </div>
            <p className="mt-3 max-w-xs text-sm text-muted-foreground">
              The unified AI platform for creators — text, code, images, video, and audio behind
              one provider-agnostic engine.
            </p>
          </div>
          <FooterColumn title="Product" links={PRODUCT_LINKS} />
          <FooterColumn title="Resources" links={RESOURCE_LINKS} />
          <FooterColumn title="Account" links={ACCOUNT_LINKS} />
        </div>
        <div className="mt-12 border-t border-border pt-6 text-sm text-muted-foreground">
          © {new Date().getFullYear()} Synora. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
