import Link from 'next/link';
import {
  ArrowRight,
  Bot,
  Check,
  FolderKanban,
  KeyRound,
  Layers,
  MessageSquare,
  Plus,
  ShieldCheck,
  Sparkles,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { Badge, Button } from '@synora/design-system';
import { Section, SectionHeading } from '../../components/marketing/Section';
import { Reveal } from '../../components/marketing/Reveal';
import { FEATURES } from '../../content/features';

/*
 * EVERY CLAIM ON THIS PAGE IS A STATEMENT ABOUT THE CODE AS IT IS.
 *
 * No testimonials, customer counts, uptime figures, latency numbers or
 * compliance badges appear here, because none of them have been measured or
 * earned yet. When one is — a real customer quote, a completed audit — it
 * belongs here with its source. Until then the page describes the product.
 */

interface Surface {
  icon: LucideIcon;
  title: string;
  body: string;
}

const SURFACES: Surface[] = [
  {
    icon: MessageSquare,
    title: 'Conversations',
    body: 'Streaming chat with the model you choose. Branch a reply to explore an alternative, share a thread, or export it.',
  },
  {
    icon: Sparkles,
    title: 'Ask Synora',
    body: 'Describe an outcome in one sentence. Synora proposes a plan and waits for your approval before it runs.',
  },
  {
    icon: Bot,
    title: 'Agents',
    body: 'Hand over a multi-step task, preview the plan, and approve or reject the steps that carry risk.',
  },
  {
    icon: Workflow,
    title: 'Workflows',
    body: 'Chain steps into a repeatable process and start it on a schedule or from a webhook trigger.',
  },
  {
    icon: FolderKanban,
    title: 'Projects & knowledge',
    body: 'File conversations and documents into projects, and keep prompts, templates and memories in one library.',
  },
  {
    icon: Layers,
    title: 'One engine underneath',
    body: 'Every surface talks to models through the same provider abstraction, so switching is configuration.',
  },
];

// The text providers registered in the backend's provider registry.
const PROVIDERS = [
  'Anthropic',
  'OpenAI',
  'Google Gemini',
  'xAI',
  'Groq',
  'OpenRouter',
  'DeepSeek',
  'Together AI',
  'Azure OpenAI',
  'AWS Bedrock',
  'Ollama',
  'Self-hosted (OpenAI-compatible)',
];

// Controls that exist in the codebase today.
const SECURITY_CONTROLS = [
  'Passwords hashed with bcrypt',
  'Short-lived access tokens with rotating refresh tokens',
  'Optional two-factor authentication with recovery codes',
  'CSRF protection on every state-changing request',
  'Rate limiting on sign-in and registration',
  'Session list with sign-out everywhere',
  'Workspace audit log for admins',
  'Provider keys stay server-side, never sent to the browser',
];

const FAQ_ITEMS = [
  {
    question: 'How do I get access?',
    answer:
      'Synora is in private beta. Accounts are created by invitation: a workspace owner invites your email address, and you register with that address.',
  },
  {
    question: 'Which AI providers can I use?',
    answer:
      'Anthropic, OpenAI, Google Gemini, xAI, Groq, OpenRouter, DeepSeek, Together AI, Azure OpenAI and AWS Bedrock, plus self-hosted models through Ollama or any OpenAI-compatible endpoint. Which ones are active depends on the keys configured for a deployment.',
  },
  {
    question: 'What is available today?',
    answer:
      'Text and code generation, conversations, agents, workflows, projects and the knowledge library are built. Capabilities that are still in progress are labelled "Coming soon" on this page rather than presented as finished.',
  },
  {
    question: 'Can I run it against my own models?',
    answer:
      'Yes. Point Synora at an Ollama server or any OpenAI-compatible endpoint and it is used through the same interface as the hosted providers.',
  },
  {
    question: 'Where do I ask something that is not answered here?',
    answer:
      'Sign in and open the Synora assistant — a dedicated chat for questions about the product and your workspace.',
  },
];

function ProductPreview(): React.JSX.Element {
  return (
    <div
      aria-hidden
      className="relative mx-auto w-full max-w-4xl overflow-hidden rounded-xl border border-border bg-card shadow-lg"
    >
      <div className="flex items-center gap-1.5 border-b border-border px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/25" />
        <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/25" />
        <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/25" />
        <span className="ml-3 text-xs text-muted-foreground">Ask Synora</span>
      </div>
      <div className="grid gap-0 sm:grid-cols-[180px_1fr]">
        <div className="hidden space-y-1 border-r border-border p-3 sm:block">
          {['Dashboard', 'Ask Synora', 'Conversations', 'Agents', 'Workflows', 'Projects'].map(
            (label, index) => (
              <div
                key={label}
                className={`rounded-md px-2.5 py-1.5 text-xs ${
                  index === 1 ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground'
                }`}
              >
                {label}
              </div>
            )
          )}
        </div>
        <div className="space-y-4 p-5 text-left sm:p-6">
          <div className="ml-auto w-fit max-w-[85%] rounded-lg rounded-br-sm bg-primary px-3.5 py-2 text-sm text-primary-foreground">
            Summarise this week&apos;s project notes and draft an update.
          </div>
          <div className="rounded-lg border border-border bg-background/60 p-4">
            <p className="mb-3 text-xs font-medium text-muted-foreground">Proposed plan · waiting for you</p>
            <ol className="space-y-2.5 text-sm">
              {[
                'Read the notes filed in the project',
                'Draft a summary with the selected model',
                'Save the update as a document',
              ].map((step, index) => (
                <li key={step} className="flex items-start gap-2.5">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border text-[10px] font-medium text-muted-foreground">
                    {index + 1}
                  </span>
                  <span className="text-foreground">{step}</span>
                </li>
              ))}
            </ol>
            <div className="mt-4 flex gap-2">
              <span className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">
                Approve and run
              </span>
              <span className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground">
                Edit plan
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function HomePage(): React.JSX.Element {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="bg-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,black,transparent)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-[-280px] h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl"
        />

        <div className="relative mx-auto max-w-6xl px-5 pb-16 pt-20 text-center sm:px-8 sm:pb-24 sm:pt-28">
          <div className="animate-fade-up">
            <Badge variant="outline" className="mb-6 gap-2 px-3 py-1 text-xs font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
              Private beta
            </Badge>
            <h1 className="mx-auto max-w-3xl text-[2.5rem] font-semibold leading-[1.05] tracking-tightest text-foreground sm:text-6xl">
              One workspace for every model you work with.
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              Synora puts conversations, agents and workflows behind a single provider-agnostic
              engine — and asks for your approval before anything runs on your behalf.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button asChild size="lg" className="w-full sm:w-auto">
                <Link href="/auth/register">
                  Create an account <ArrowRight aria-hidden />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
                <Link href="/auth/login">Sign in</Link>
              </Button>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              Registration is by invitation during the beta.
            </p>
          </div>

          <div className="mt-16 animate-fade-up [animation-delay:150ms] sm:mt-20">
            <ProductPreview />
          </div>
        </div>
      </section>

      {/* Surfaces */}
      <Section id="features" className="scroll-mt-16">
        <Reveal>
          <SectionHeading
            eyebrow="The workspace"
            title="Everything you do with AI, in one place"
            description="Six connected surfaces instead of six separate tools — each one sharing the same projects, history and permissions."
          />
        </Reveal>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SURFACES.map((surface, index) => {
            const Icon = surface.icon;
            return (
              <li key={surface.title}>
                <Reveal delay={(index % 3) * 70} className="h-full">
                  <div className="surface-interactive h-full p-6">
                    <span className="mb-4 flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background text-primary">
                      <Icon className="h-[18px] w-[18px]" aria-hidden />
                    </span>
                    <h3 className="text-base font-semibold text-foreground">{surface.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{surface.body}</p>
                  </div>
                </Reveal>
              </li>
            );
          })}
        </ul>
      </Section>

      {/* Capabilities, with honest status */}
      <div className="border-y border-border bg-card/40">
        <Section id="capabilities" className="scroll-mt-16">
          <Reveal>
            <SectionHeading
              eyebrow="Capabilities"
              title="What is built, and what is still landing"
              description="Each capability carries its real status. Nothing here is presented as finished before it is."
            />
          </Reveal>
          <ul className="mx-auto grid max-w-4xl gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2">
            {FEATURES.map((feature) => (
              <li key={feature.slug} className="bg-card">
                <Link
                  href={`/features/${feature.slug}`}
                  className="group flex h-full items-start justify-between gap-4 p-5 transition-colors hover:bg-accent/50"
                >
                  <span>
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">{feature.title}</span>
                      {feature.status === 'available' ? (
                        <Badge variant="outline" className="border-success/40 text-success">
                          Available
                        </Badge>
                      ) : (
                        <Badge variant="outline">Coming soon</Badge>
                      )}
                    </span>
                    <span className="mt-1.5 block text-sm leading-relaxed text-muted-foreground">
                      {feature.tagline}
                    </span>
                  </span>
                  <ArrowRight
                    className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-foreground"
                    aria-hidden
                  />
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      </div>

      {/* Providers */}
      <Section id="providers" className="scroll-mt-16">
        <div className="grid items-start gap-12 lg:grid-cols-2 lg:gap-16">
          <Reveal>
            <SectionHeading
              align="left"
              eyebrow="Provider-agnostic"
              title="Change the model, not your work"
              description="Business logic never learns a vendor's name. Providers sit behind one interface, so moving between them is a settings change — your conversations, projects and history stay exactly where they are."
            />
            <ul className="-mt-6 space-y-3 text-sm text-foreground">
              {[
                'Pick a provider and model per conversation',
                'Run hosted and self-hosted models side by side',
                'Daily spend and token ceilings enforced server-side',
              ].map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
          </Reveal>
          <Reveal delay={100}>
            <ul
              aria-label="Supported providers"
              className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3"
            >
              {PROVIDERS.map((provider) => (
                <li
                  key={provider}
                  className="flex min-h-[72px] items-center justify-center bg-card px-3 py-4 text-center text-sm font-medium text-foreground"
                >
                  {provider}
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </Section>

      {/* Security */}
      <div className="border-y border-border bg-card/40">
        <Section id="security" className="scroll-mt-16">
          <div className="grid items-start gap-12 lg:grid-cols-2 lg:gap-16">
            <Reveal>
              <SectionHeading
                align="left"
                eyebrow="Security"
                title="Controls that are implemented, listed plainly"
                description="No badges for audits that have not happened. This is what protects an account today."
              />
              <div className="-mt-4 flex items-center gap-3 text-sm text-muted-foreground">
                <span className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background text-primary">
                  <KeyRound className="h-4 w-4" aria-hidden />
                </span>
                Manage sessions and two-factor authentication from your account settings.
              </div>
            </Reveal>
            <Reveal delay={100}>
              <ul className="space-y-3">
                {SECURITY_CONTROLS.map((control) => (
                  <li key={control} className="flex items-start gap-3 text-sm text-foreground">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
                    {control}
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>
        </Section>
      </div>

      {/* FAQ */}
      <Section id="faq" className="scroll-mt-16">
        <Reveal>
          <SectionHeading title="Frequently asked questions" />
        </Reveal>
        <div className="mx-auto max-w-3xl divide-y divide-border border-y border-border">
          {FAQ_ITEMS.map((item) => (
            <details key={item.question} className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-left text-[15px] font-medium text-foreground [&::-webkit-details-marker]:hidden">
                {item.question}
                <Plus
                  className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-45"
                  aria-hidden
                />
              </summary>
              <p className="pb-5 pr-8 text-sm leading-relaxed text-muted-foreground">{item.answer}</p>
            </details>
          ))}
        </div>
      </Section>

      {/* Closing call to action */}
      <Section className="pt-0">
        <Reveal>
          <div className="relative overflow-hidden rounded-2xl border border-border bg-card px-6 py-14 text-center sm:px-12 sm:py-20">
            <div
              aria-hidden
              className="bg-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]"
            />
            <div className="relative">
              <h2 className="mx-auto max-w-xl text-3xl font-semibold tracking-tightest text-foreground sm:text-4xl">
                Have an invitation? Set up your workspace.
              </h2>
              <p className="mx-auto mt-4 max-w-lg text-base text-muted-foreground">
                Register with the email address you were invited on, or sign in to pick up where
                you left off.
              </p>
              <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Button asChild size="lg" className="w-full sm:w-auto">
                  <Link href="/auth/register">
                    Create an account <ArrowRight aria-hidden />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
                  <Link href="/auth/login">Sign in</Link>
                </Button>
              </div>
            </div>
          </div>
        </Reveal>
      </Section>
    </>
  );
}
