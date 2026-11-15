import Link from 'next/link';
import { FEATURES } from '../../content/features';
import { Logo } from '../brand/Logo';

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
      <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          <div className="col-span-2 md:col-span-1">
            <Logo markClassName="h-7 w-7" />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted-foreground">
              One workspace for conversations, agents and workflows, behind a single
              provider-agnostic engine.
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
