import type { Metadata } from 'next';
import { Section, SectionHeading } from '../../../components/marketing/Section';
import { PlanCard } from '../../../components/marketing/PlanCard';
import { PLANS } from '../../../content/plans';

export const metadata: Metadata = {
  title: 'Pricing',
  description:
    'Simple, transparent pricing for Synora — start free, upgrade when your creation demands it.',
  openGraph: {
    title: 'Synora Pricing',
    description: 'Start free. Upgrade when your creation demands it.',
    type: 'website',
  },
};

const FAQS = [
  {
    q: 'Can I use Synora for free?',
    a: 'Yes. The Free plan includes text and code generation with your own API key, one workspace, and three projects — no credit card required.',
  },
  {
    q: 'Which AI providers can I use?',
    a: 'Ten today: Anthropic, OpenAI, Google Gemini, xAI, OpenRouter, DeepSeek, Together, Azure OpenAI, AWS Bedrock, and Ollama for self-hosted models. Switching is a configuration change, never a migration.',
  },
  {
    q: 'When do image, video, and audio generation arrive?',
    a: 'They are in active development in the current release cycle, shipping with an asynchronous pipeline and a full asset manager. Pro includes them as they release.',
  },
  {
    q: 'Is my data used to train models?',
    a: 'No. Your prompts and content are never used for training, and API keys are read through an audited secrets layer that never exposes them to the frontend.',
  },
  {
    q: 'How does billing work?',
    a: 'Subscription billing is landing later in this release cycle. Until then, every capability that has shipped is available on the Free tier with your own API key.',
  },
];

export default function PricingPage(): React.JSX.Element {
  return (
    <>
      <Section className="pb-10 pt-20">
        <SectionHeading
          eyebrow="Pricing"
          title="Start free. Scale when you're ready."
          description="Transparent plans that grow with your work — and honest labels on what's shipped versus what's landing next."
        />
        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-8 pt-4 md:grid-cols-3">
          {PLANS.map((plan) => (
            <PlanCard key={plan.id} plan={plan} />
          ))}
        </div>
      </Section>

      <Section className="border-t border-border">
        <SectionHeading title="Frequently asked questions" />
        <div className="mx-auto max-w-3xl divide-y divide-border">
          {FAQS.map((faq) => (
            <details key={faq.q} className="group py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between text-left font-medium text-foreground [&::-webkit-details-marker]:hidden">
                {faq.q}
                <span
                  aria-hidden
                  className="ml-4 text-muted-foreground transition-transform group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{faq.a}</p>
            </details>
          ))}
        </div>
      </Section>
    </>
  );
}
