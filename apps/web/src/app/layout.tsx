import type { Metadata } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { Toaster } from '@synora/design-system';
import '@synora/design-system/styles.css';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: {
    default: 'Synora AI — AI Platform for Creators',
    template: '%s · Synora AI',
  },
  description:
    'Create, generate, and collaborate with AI-powered tools for text, code, images, video, and audio.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      style={
        {
          '--font-sans': GeistSans.style.fontFamily,
          '--font-mono': GeistMono.style.fontFamily,
        } as React.CSSProperties
      }
      suppressHydrationWarning
    >
      <body className="min-h-screen font-sans">
        <Providers>
          {children}
          <Toaster position="bottom-right" />
        </Providers>
      </body>
    </html>
  );
}
