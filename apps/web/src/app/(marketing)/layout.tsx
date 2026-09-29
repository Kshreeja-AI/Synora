import type { Metadata } from 'next';
import { MarketingNav } from '../../components/marketing/MarketingNav';
import { MarketingFooter } from '../../components/marketing/MarketingFooter';

export const metadata: Metadata = {
  title: 'Synora AI — Universal AI Workspace for Creators',
  description:
    'Synora is the unified AI platform for creators — text, code, images, video, and audio behind one provider-agnostic engine.',
  openGraph: {
    title: 'Synora AI — Universal AI Workspace for Creators',
    description:
      'Create with AI across every medium. Ten interchangeable providers, one premium workspace.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Synora AI — Universal AI Workspace for Creators',
    description: 'Create with AI across every medium. Ten interchangeable providers, one premium workspace.',
  },
  robots: 'index, follow',
};

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex min-h-screen flex-col">
      <MarketingNav />
      <main className="flex-1">{children}</main>
      <MarketingFooter />
    </div>
  );
}
