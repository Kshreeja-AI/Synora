import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { Badge, Button, Card, CardContent } from '@synora/design-system';
import { Section } from '../../../../components/marketing/Section';
import { FEATURES, getFeature } from '../../../../content/features';

export function generateStaticParams(): { slug: string }[] {
  return FEATURES.map((feature) => ({ slug: feature.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const feature = getFeature(slug);
  if (!feature) return {};
  return {
    title: feature.title,
    description: feature.tagline,
    openGraph: { title: `Synora — ${feature.title}`, description: feature.tagline, type: 'website' },
  };
}

export default async function FeaturePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<React.JSX.Element> {
  const { slug } = await params;
  const feature = getFeature(slug);
  if (!feature) notFound();

  return (
    <>
      <Section className="pb-12 pt-20 text-center">
        <div className="animate-fade-up">
          <div className="mb-6 text-5xl">{feature.icon}</div>
          <div className="mb-4 flex items-center justify-center gap-3">
            <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
              {feature.title}
            </h1>
            {feature.status === 'coming-soon' && <Badge variant="secondary">Coming soon</Badge>}
          </div>
          <p className="mx-auto max-w-2xl text-lg text-muted-foreground sm:text-xl">
            {feature.tagline}
          </p>
          <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">{feature.description}</p>
          <div className="mt-8">
            <Button asChild size="lg" className="group">
              <Link href="/auth/register">
                {feature.status === 'available' ? 'Try it now' : 'Get early access'}
                <ArrowRight
                  aria-hidden
                  className="transition-transform group-hover:translate-x-0.5"
                />
              </Link>
            </Button>
          </div>
        </div>
      </Section>

      <Section className="pt-0">
        <div className="mx-auto grid max-w-4xl grid-cols-1 gap-6">
          {feature.sections.map((section) => (
            <Card key={section.heading}>
              <CardContent className="p-8">
                <h2 className="mb-3 text-xl font-semibold text-foreground">{section.heading}</h2>
                <p className="leading-relaxed text-muted-foreground">{section.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="mx-auto mt-16 max-w-4xl">
          <h2 className="mb-6 text-lg font-semibold text-foreground">Explore more</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.filter((f) => f.slug !== feature.slug)
              .slice(0, 3)
              .map((other) => (
                <Link key={other.slug} href={`/features/${other.slug}`} className="group">
                  <Card className="h-full transition-colors group-hover:border-primary/40">
                    <CardContent className="p-5">
                      <div className="mb-2 text-2xl">{other.icon}</div>
                      <div className="font-medium text-foreground">{other.title}</div>
                      <p className="mt-1 text-sm text-muted-foreground">{other.tagline}</p>
                    </CardContent>
                  </Card>
                </Link>
              ))}
          </div>
        </div>
      </Section>
    </>
  );
}
