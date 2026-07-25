import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Blocks, Lock, RefreshCw } from 'lucide-react';
import { Badge, Button, Card, CardContent } from '@synora/design-system';
import { Section, SectionHeading } from '../../components/marketing/Section';
import { FEATURES } from '../../content/features';

export const metadata: Metadata = {
  description:
    'Synora is the unified AI platform for creators — text, code, images, video, and audio behind one provider-agnostic engine.',
  openGraph: {
    title: 'Synora AI — AI Platform for Creators',
    description:
      'Create with AI across every medium. Ten interchangeable providers, one premium workspace.',
    type: 'website',
  },
};

const PILLARS = [
  {
    icon: Blocks,
    title: 'Provider-agnostic by design',
    body: 'Ten AI providers behind one abstraction — Anthropic, OpenAI, Gemini, xAI, and more. Switch through configuration, never a migration.',
  },
  {
    icon: RefreshCw,
    title: 'Never locked in',
    body: 'Your projects, prompts, and history belong to you and outlive any single model vendor. Even future self-hosted models plug into the same engine.',
  },
  {
    icon: Lock,
    title: 'Security first',
    body: 'Rotating sessions with reuse detection, Argon2id hashing, audited secret access, and rate limiting — production hardening, not promises.',
  },
];

export default function HomePage(): React.JSX.Element {
  return (
    <>
      {/* Hero */}
      <div className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
        >
          <div className="absolute -top-32 left-1/2 h-[500px] w-[800px] -translate-x-1/2 rounded-full bg-primary/20 blur-3xl motion-safe:animate-pulse" />
          <div className="absolute -top-16 left-1/4 h-72 w-72 rounded-full bg-fuchsia-500/10 blur-3xl" />
          <div className="absolute right-1/4 top-24 h-72 w-72 rounded-full bg-cyan-500/10 blur-3xl" />
        </div>

        <Section className="pb-24 pt-24 text-center sm:pt-32">
          <div className="animate-fade-up">
            <Badge variant="outline" className="mb-6 gap-2 px-3 py-1">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-success" />
              Text & code generation live — media on the way
            </Badge>
            <h1 className="mx-auto max-w-4xl text-balance bg-gradient-to-br from-foreground via-foreground to-muted-foreground bg-clip-text text-5xl font-bold tracking-tight text-transparent sm:text-6xl lg:text-7xl">
              Create anything with AI.
              <br />
              Own every part of it.
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground sm:text-xl">
              Synora is the unified platform for creators — text, code, images, video, and audio
              behind one provider-agnostic engine that never locks you in.
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Button asChild size="lg" className="group">
                <Link href="/auth/register">
                  Start creating free
                  <ArrowRight
                    aria-hidden
                    className="transition-transform group-hover:translate-x-0.5"
                  />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link href="/pricing">View pricing</Link>
              </Button>
            </div>
          </div>

          {/* Stats band */}
          <dl className="mx-auto mt-20 grid max-w-3xl grid-cols-1 gap-8 sm:grid-cols-3">
            {[
              ['10', 'interchangeable AI providers'],
              ['5', 'creative mediums, one platform'],
              ['0', 'vendor lock-in, by architecture'],
            ].map(([stat, label]) => (
              <div key={label} className="text-center">
                <dt className="order-2 text-sm text-muted-foreground">{label}</dt>
                <dd className="order-1 text-4xl font-bold tracking-tight text-foreground">
                  {stat}
                </dd>
              </div>
            ))}
          </dl>
        </Section>
      </div>

      {/* Features grid */}
      <Section id="features" className="scroll-mt-16">
        <SectionHeading
          eyebrow="Everything you create"
          title="One platform, every medium"
          description="Start with text and code today. Images, video, audio, and team workspaces are landing next — on the same engine, in the same projects."
        />
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <Link key={feature.slug} href={`/features/${feature.slug}`} className="group">
              <Card className="h-full transition-all motion-safe:group-hover:-translate-y-1 group-hover:border-primary/40">
                <CardContent className="p-6">
                  <div className="mb-4 text-3xl">{feature.icon}</div>
                  <div className="mb-2 flex items-center gap-2">
                    <h3 className="text-lg font-semibold text-foreground">{feature.title}</h3>
                    {feature.status === 'coming-soon' && (
                      <Badge variant="secondary">Coming soon</Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">{feature.tagline}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </Section>

      {/* Pillars */}
      <Section className="border-t border-border">
        <SectionHeading
          eyebrow="Why Synora"
          title="Built like infrastructure, polished like a product"
        />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {PILLARS.map((pillar) => (
            <Card key={pillar.title}>
              <CardContent className="p-8">
                <pillar.icon aria-hidden className="mb-4 h-8 w-8 text-primary" />
                <h3 className="mb-2 text-lg font-semibold text-foreground">{pillar.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{pillar.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </Section>

      {/* CTA */}
      <Section>
        <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary/15 via-background to-fuchsia-500/10 p-12 text-center sm:p-16">
          <h2 className="mx-auto max-w-2xl text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Ready to create at the speed of thought?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
            Free to start. No credit card. Bring your own API key or use ours when billing lands.
          </p>
          <Button asChild size="lg" className="mt-8">
            <Link href="/auth/register">Get started free</Link>
          </Button>
        </div>
      </Section>
    </>
  );
}
