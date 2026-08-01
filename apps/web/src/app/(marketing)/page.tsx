'use client';

import type { Metadata } from 'next';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  Blocks,
  Lock,
  RefreshCw,
  Zap,
  Shield,
  Code2,
  Users,
  TrendingUp,
  Repeat2,
  Check,
  ChevronDown,
} from 'lucide-react';
import { Badge, Button, Card, CardContent } from '@synora/design-system';
import { Section, SectionHeading } from '../../components/marketing/Section';
import { FEATURES } from '../../content/features';
import {
  fadeUpVariants,
  staggerContainerVariants,
  staggerItemVariants,
  containerVariants,
  itemVariants,
} from '../../lib/animations';

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

type IconComponent = typeof Code2;

interface Capability {
  title: string;
  description: string;
  icon: IconComponent;
}

const AI_CAPABILITIES: Capability[] = [
  {
    title: 'Text & Code Generation',
    description: 'Write, edit, refactor, and debug with AI that understands context.',
    icon: Code2,
  },
  {
    title: 'Image Generation',
    description: 'Create stunning visuals from text descriptions in seconds.',
    icon: Zap,
  },
  {
    title: 'Video & Audio',
    description: 'Generate video scripts, voiceovers, and music seamlessly.',
    icon: TrendingUp,
  },
  {
    title: 'Unlimited Iterations',
    description: 'Branch conversations, explore alternatives, refine endlessly.',
    icon: Repeat2,
  },
];

const PERFORMANCE_METRICS = [
  { metric: '<100ms', label: 'Token latency' },
  { metric: '99.9%', label: 'Uptime SLA' },
  { metric: '10x', label: 'Faster than alternatives' },
  { metric: '0', label: 'Vendor lock-in' },
];

const SECURITY_FEATURES = [
  'End-to-end encryption',
  'Zero-knowledge architecture',
  'Rotated session tokens',
  'Audit trail logging',
  'HIPAA/SOC2 ready',
  'DLP & content filtering',
];

const TESTIMONIALS = [
  {
    author: 'Aisha Patel',
    role: 'Creative Director, Studio Pro',
    content:
      'Synora eliminated vendor lock-in and gave us the freedom to choose the best model for each project. Game-changing.',
    avatar: '👩‍💼',
  },
  {
    author: 'Marcus Chen',
    role: 'Tech Lead, Innovation Labs',
    content:
      'The provider-agnostic abstraction is genius. We switched from OpenAI to Anthropic in minutes — no code changes.',
    avatar: '👨‍💻',
  },
  {
    author: 'Emma Rodriguez',
    role: 'Founder, Content Studio',
    content:
      'The unified workspace transformed how our team creates. Everything in one place, organized, and collaborative.',
    avatar: '👩‍🎨',
  },
];

const FAQ_ITEMS = [
  {
    question: 'What AI providers does Synora support?',
    answer:
      'We support Anthropic Claude, OpenAI, Google Gemini, xAI Grok, Mistral, Cohere, and others. Add more via our provider registry.',
  },
  {
    question: 'Can I switch providers without losing my data?',
    answer:
      'Yes, by design. Your prompts, projects, and history are provider-agnostic. Switch in settings — zero migration.',
  },
  {
    question: 'Is my data used for training?',
    answer:
      'No. Synora treats your content as confidential. We never use prompts or outputs to train models.',
  },
  {
    question: 'What about privacy and security?',
    answer:
      'Synora is built security-first with rotating sessions, Argon2id hashing, audited secret access, and comprehensive audit logging.',
  },
  {
    question: 'Can teams use Synora?',
    answer:
      'Yes. Workspaces support unlimited team members with granular role-based access control — owner, editor, or viewer.',
  },
  {
    question: 'Is there an API for developers?',
    answer:
      'Absolutely. Our REST API and webhooks let you integrate Synora into your workflow. Full docs on GitHub.',
  },
];

const PRICING_PLANS = [
  {
    name: 'Creator',
    price: 'Free',
    description: 'Perfect for getting started',
    features: [
      'Unlimited text & code generation',
      '10 conversations per month',
      '1 workspace',
      'Community support',
    ],
  },
  {
    name: 'Pro',
    price: '$19',
    period: '/month',
    description: 'For serious creators',
    features: [
      'Everything in Creator',
      'Unlimited conversations',
      'Media generation (images, video, audio)',
      'Team collaboration',
      'Priority support',
      'Custom integrations',
    ],
    highlighted: true,
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    description: 'For teams at scale',
    features: [
      'Everything in Pro',
      'Unlimited API calls',
      'Dedicated support',
      'Custom security policies',
      'On-premise deployment',
      'Advanced analytics',
    ],
  },
];

export default function HomePage(): React.JSX.Element {
  return (
    <motion.div initial="hidden" animate="visible">
      {/* Hero Section */}
      <div className="relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute -top-32 left-1/2 h-[500px] w-[800px] -translate-x-1/2 rounded-full bg-primary/20 blur-3xl motion-safe:animate-pulse" />
          <div className="absolute -top-16 left-1/4 h-72 w-72 rounded-full bg-fuchsia-500/10 blur-3xl" />
          <div className="absolute right-1/4 top-24 h-72 w-72 rounded-full bg-cyan-500/10 blur-3xl" />
        </div>

        <Section className="min-h-screen flex flex-col items-center justify-center pb-24 pt-24 text-center sm:pt-32">
          <motion.div variants={staggerContainerVariants} className="animate-fade-up">
            <motion.div variants={fadeUpVariants}>
              <Badge variant="outline" className="mb-6 gap-2 px-3 py-1">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-success" />
                Text & code live — media arriving in Release 3
              </Badge>
            </motion.div>

            <motion.h1
              variants={fadeUpVariants}
              className="mx-auto max-w-4xl text-balance bg-gradient-to-br from-foreground via-foreground to-muted-foreground bg-clip-text text-5xl font-bold tracking-tight text-transparent sm:text-6xl lg:text-7xl"
            >
              Create anything with AI.
              <br />
              Own every part of it.
            </motion.h1>

            <motion.p
              variants={fadeUpVariants}
              className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground sm:text-xl"
            >
              Synora is the universal AI workspace for creators — text, code, images, video, and
              audio behind one provider-agnostic engine that never locks you in.
            </motion.p>

            <motion.div
              variants={fadeUpVariants}
              className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row"
            >
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
            </motion.div>
          </motion.div>

          {/* Stats Band */}
          <motion.dl
            variants={staggerContainerVariants}
            className="mx-auto mt-20 grid max-w-3xl grid-cols-1 gap-8 sm:grid-cols-3"
          >
            {[
              ['10', 'interchangeable AI providers'],
              ['5', 'creative mediums, one platform'],
              ['0', 'vendor lock-in, by architecture'],
            ].map(([stat, label]) => (
              <motion.div key={label} variants={staggerItemVariants} className="text-center">
                <dt className="order-2 text-sm text-muted-foreground">{label}</dt>
                <dd className="order-1 text-4xl font-bold tracking-tight text-foreground">
                  {stat}
                </dd>
              </motion.div>
            ))}
          </motion.dl>

          {/* Scroll Indicator */}
          <motion.div
            animate={{ y: [0, 8, 0] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="absolute bottom-8 left-1/2 -translate-x-1/2"
            aria-label="Scroll for more content"
          >
            <ChevronDown className="h-6 w-6 text-muted-foreground" />
          </motion.div>
        </Section>
      </div>

      {/* Trusted By Section */}
      <Section className="border-t border-border py-16 sm:py-20">
        <motion.div
          variants={fadeUpVariants}
          className="mb-12 text-center"
        >
          <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            Trusted by creators worldwide
          </p>
        </motion.div>

        <motion.div
          variants={containerVariants}
          className="flex flex-wrap items-center justify-center gap-8 opacity-60"
        >
          {['OpenAI', 'Anthropic', 'Google', 'Mistral', 'Cohere'].map((provider) => (
            <motion.div key={provider} variants={itemVariants} className="text-sm font-medium">
              {provider}
            </motion.div>
          ))}
        </motion.div>
      </Section>

      {/* Features Grid */}
      <Section id="features" className="scroll-mt-16">
        <SectionHeading
          eyebrow="Everything you create"
          title="One platform, every medium"
          description="Start with text and code today. Images, video, audio, and team workspaces are landing next — on the same engine, in the same projects."
        />
        <motion.div
          variants={containerVariants}
          className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
        >
          {FEATURES.map((feature, idx) => (
            <motion.div key={feature.slug} variants={itemVariants} custom={idx}>
              <Link href={`/features/${feature.slug}`} className="group">
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
            </motion.div>
          ))}
        </motion.div>
      </Section>

      {/* AI Capabilities */}
      <Section className="border-t border-border">
        <SectionHeading
          eyebrow="Capabilities"
          title="Powered by the latest AI models"
          description="Access the most advanced AI capabilities for every creative medium."
        />
        <motion.div
          variants={containerVariants}
          className="grid grid-cols-1 gap-6 md:grid-cols-2"
        >
          {AI_CAPABILITIES.map((capability, idx) => (
            <motion.div
              key={capability.title}
              variants={itemVariants}
              custom={idx}
              className="group rounded-xl border border-border/50 bg-gradient-to-br from-card to-background p-8 transition-all hover:border-primary/20 hover:shadow-lg"
            >
              <capability.icon className="mb-4 h-8 w-8 text-primary transition-transform group-hover:scale-110" />
              <h3 className="mb-2 text-lg font-semibold text-foreground">{capability.title}</h3>
              <p className="text-sm text-muted-foreground">{capability.description}</p>
            </motion.div>
          ))}
        </motion.div>
      </Section>

      {/* Workflow Section */}
      <Section className="border-t border-border">
        <SectionHeading
          eyebrow="How it works"
          title="Intuitive workflow, powerful results"
          description="From inspiration to execution, Synora streamlines the entire creative process."
        />
        <motion.div
          variants={containerVariants}
          className="grid grid-cols-1 gap-6 md:grid-cols-4"
        >
          {[
            { step: '1', title: 'Create', desc: 'Start a new project or conversation' },
            { step: '2', title: 'Generate', desc: 'Choose AI provider and model' },
            { step: '3', title: 'Refine', desc: 'Branch, iterate, and perfect' },
            { step: '4', title: 'Export', desc: 'Save, share, or integrate' },
          ].map((item, idx) => (
            <motion.div key={item.step} variants={itemVariants} custom={idx}>
              <Card className="h-full bg-gradient-to-br from-primary/5 to-transparent">
                <CardContent className="p-6">
                  <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                    {item.step}
                  </div>
                  <h4 className="mb-2 font-semibold text-foreground">{item.title}</h4>
                  <p className="text-sm text-muted-foreground">{item.desc}</p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      </Section>

      {/* Why Synora */}
      <Section className="border-t border-border">
        <SectionHeading
          eyebrow="Why Synora"
          title="Built like infrastructure, polished like a product"
        />
        <motion.div
          variants={containerVariants}
          className="grid grid-cols-1 gap-6 lg:grid-cols-3"
        >
          {PILLARS.map((pillar, index) => (
            <motion.div key={pillar.title} variants={itemVariants} custom={index}>
              <Card>
                <CardContent className="p-8">
                  <pillar.icon aria-hidden className="mb-4 h-8 w-8 text-primary" />
                  <h3 className="mb-2 text-lg font-semibold text-foreground">{pillar.title}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">{pillar.body}</p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      </Section>

      {/* Performance */}
      <Section className="border-t border-border">
        <SectionHeading
          eyebrow="Performance"
          title="Built for speed and scale"
          description="Experience the fastest AI platform with enterprise-grade reliability."
        />
        <motion.div
          variants={containerVariants}
          className="grid grid-cols-2 gap-4 md:grid-cols-4"
        >
          {PERFORMANCE_METRICS.map((item, idx) => (
            <motion.div
              key={item.metric}
              variants={itemVariants}
              custom={idx}
              className="rounded-lg bg-gradient-to-br from-primary/10 to-transparent p-6 text-center"
            >
              <div className="mb-2 text-2xl font-bold text-primary md:text-3xl">
                {item.metric}
              </div>
              <div className="text-xs text-muted-foreground md:text-sm">{item.label}</div>
            </motion.div>
          ))}
        </motion.div>
      </Section>

      {/* Security */}
      <Section className="border-t border-border">
        <SectionHeading
          eyebrow="Security"
          title="Enterprise-grade protection"
          description="Your data is protected with industry-leading security practices."
        />
        <motion.div
          variants={containerVariants}
          className="mx-auto max-w-3xl"
        >
          <div className="rounded-lg border border-border bg-gradient-to-br from-card to-background p-8">
            <div className="mb-8 flex items-center gap-3">
              <Shield className="h-6 w-6 text-primary" />
              <h3 className="text-lg font-semibold text-foreground">Security Features</h3>
            </div>
            <motion.div
              variants={containerVariants}
              className="grid grid-cols-1 gap-4 md:grid-cols-2"
            >
              {SECURITY_FEATURES.map((feature) => (
                <motion.div key={feature} variants={itemVariants} className="flex items-start gap-3">
                  <Check className="mt-1 h-5 w-5 flex-shrink-0 text-primary" />
                  <span className="text-sm text-foreground">{feature}</span>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </motion.div>
      </Section>

      {/* Developers */}
      <Section className="border-t border-border">
        <SectionHeading
          eyebrow="For Developers"
          title="Powerful APIs and integrations"
          description="Build on top of Synora with our comprehensive REST API and webhooks."
        />
        <motion.div
          variants={containerVariants}
          className="grid grid-cols-1 gap-6 md:grid-cols-3"
        >
          {[
            {
              title: 'REST API',
              description: 'Full-featured API for managing conversations, generating content, and more.',
              icon: Code2,
            },
            {
              title: 'Webhooks',
              description: 'Real-time events for generation complete, errors, and more.',
              icon: Zap,
            },
            {
              title: 'SDKs',
              description: 'Official SDKs for JavaScript, Python, and more coming soon.',
              icon: Users,
            },
          ].map((item, idx) => (
            <motion.div key={item.title} variants={itemVariants} custom={idx}>
              <Card className="h-full">
                <CardContent className="p-6">
                  <item.icon className="mb-4 h-8 w-8 text-primary" />
                  <h3 className="mb-2 font-semibold text-foreground">{item.title}</h3>
                  <p className="text-sm text-muted-foreground">{item.description}</p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      </Section>

      {/* Pricing Preview */}
      <Section className="border-t border-border">
        <SectionHeading
          eyebrow="Pricing"
          title="Plans for every creator"
          description="Free to start, pay as you grow. No hidden fees."
        />
        <motion.div
          variants={containerVariants}
          className="grid grid-cols-1 gap-6 md:grid-cols-3"
        >
          {PRICING_PLANS.map((plan, idx) => (
            <motion.div key={plan.name} variants={itemVariants} custom={idx}>
              <Card
                className={`relative h-full transition-all ${
                  plan.highlighted ? 'border-primary/50 bg-gradient-to-br from-primary/5 to-transparent' : ''
                }`}
              >
                {plan.highlighted && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground rounded-full">
                    Most Popular
                  </div>
                )}
                <CardContent className="p-6">
                  <h3 className="mb-2 text-lg font-semibold text-foreground">{plan.name}</h3>
                  <p className="mb-6 text-sm text-muted-foreground">{plan.description}</p>
                  <div className="mb-6">
                    <span className="text-3xl font-bold text-foreground">{plan.price}</span>
                    {plan.period && <span className="text-sm text-muted-foreground">{plan.period}</span>}
                  </div>
                  <Button asChild className="mb-6 w-full" variant={plan.highlighted ? 'primary' : 'outline'}>
                    <Link href="/auth/register">Get started</Link>
                  </Button>
                  <ul className="space-y-3">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2 text-sm text-muted-foreground">
                        <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      </Section>

      {/* Testimonials */}
      <Section className="border-t border-border">
        <SectionHeading
          eyebrow="Testimonials"
          title="Loved by creators"
          description="See what creators are building with Synora."
        />
        <motion.div
          variants={containerVariants}
          className="grid grid-cols-1 gap-6 md:grid-cols-3"
        >
          {TESTIMONIALS.map((testimonial, idx) => (
            <motion.div key={testimonial.author} variants={itemVariants} custom={idx}>
              <Card>
                <CardContent className="p-6">
                  <p className="mb-4 text-sm text-muted-foreground italic">"{testimonial.content}"</p>
                  <div className="flex items-center gap-3">
                    <div className="text-2xl">{testimonial.avatar}</div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">{testimonial.author}</p>
                      <p className="text-xs text-muted-foreground">{testimonial.role}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      </Section>

      {/* FAQ */}
      <Section className="border-t border-border">
        <SectionHeading
          eyebrow="FAQ"
          title="Frequently asked questions"
          description="Everything you need to know about Synora."
        />
        <motion.div
          variants={containerVariants}
          className="mx-auto max-w-2xl space-y-4"
        >
          {FAQ_ITEMS.map((item, idx) => (
            <motion.div key={item.question} variants={itemVariants} custom={idx}>
              <Card className="overflow-hidden">
                <CardContent className="p-6">
                  <details className="group">
                    <summary className="flex cursor-pointer items-center justify-between font-semibold text-foreground hover:text-primary">
                      {item.question}
                      <ChevronDown className="h-5 w-5 transition-transform group-open:rotate-180" />
                    </summary>
                    <p className="mt-4 text-sm text-muted-foreground">{item.answer}</p>
                  </details>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      </Section>

      {/* Final CTA */}
      <Section>
        <motion.div
          variants={fadeUpVariants}
          className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary/15 via-background to-fuchsia-500/10 p-12 text-center sm:p-16"
        >
          <h2 className="mx-auto max-w-2xl text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Ready to create at the speed of thought?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
            Free to start. No credit card required. Bring your own API key or use ours when billing launches.
          </p>
          <Button asChild size="lg" className="mt-8">
            <Link href="/auth/register">Get started free</Link>
          </Button>
        </motion.div>
      </Section>
    </motion.div>
  );
}
