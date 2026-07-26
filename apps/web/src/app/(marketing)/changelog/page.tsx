import type { Metadata } from 'next';
import { Badge } from '@synora/design-system';
import { Section, SectionHeading } from '../../../components/marketing/Section';
import { CHANGELOG, type ChangelogEntry } from '../../../content/changelog';

export const metadata: Metadata = {
  title: 'Changelog',
  description: 'What shipped in Synora, release by release.',
  openGraph: { title: 'Synora Changelog', description: 'What shipped, release by release.', type: 'website' },
};

const TAG_VARIANT: Record<ChangelogEntry['tag'], 'default' | 'success' | 'secondary' | 'warning'> =
  {
    release: 'success',
    feature: 'default',
    improvement: 'secondary',
    fix: 'warning',
  };

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export default function ChangelogPage(): React.JSX.Element {
  return (
    <Section className="pt-20">
      <SectionHeading
        eyebrow="Changelog"
        title="What's new in Synora"
        description="Every entry here describes work that actually shipped — no vaporware."
      />
      <ol
        aria-label="Changelog entries"
        className="relative mx-auto max-w-3xl space-y-12 border-l border-border pl-8"
      >
        {CHANGELOG.map((entry) => (
          <li key={`${entry.date}-${entry.title}`} className="relative">
            <span
              aria-hidden
              className="absolute -left-[37px] top-1.5 h-3 w-3 rounded-full border-2 border-background bg-primary"
            />
            <div className="mb-1 flex flex-wrap items-center gap-3">
              <time dateTime={entry.date} className="text-sm text-muted-foreground">
                {formatDate(entry.date)}
              </time>
              <Badge variant={TAG_VARIANT[entry.tag]}>{entry.tag}</Badge>
            </div>
            <h2 className="text-xl font-semibold text-foreground">{entry.title}</h2>
            <p className="mt-2 text-muted-foreground">{entry.description}</p>
            <ul className="mt-4 space-y-2">
              {entry.highlights.map((highlight) => (
                <li key={highlight} className="flex items-start gap-2 text-sm text-foreground">
                  <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-primary" />
                  {highlight}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </Section>
  );
}
