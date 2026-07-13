import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Synora AI - AI Platform for Creators',
  description: 'Create, generate, and collaborate with AI-powered tools',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
