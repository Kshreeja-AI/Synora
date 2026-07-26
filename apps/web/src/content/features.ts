/**
 * Feature page content. One typed module drives /features/[slug] via a
 * single template — adding a feature page is adding an entry here.
 * `status` is honest: capabilities not shipped yet say so on the page.
 */
export type FeatureStatus = 'available' | 'coming-soon';

export interface FeatureSection {
  heading: string;
  body: string;
}

export interface Feature {
  slug: string;
  icon: string;
  title: string;
  tagline: string;
  description: string;
  status: FeatureStatus;
  sections: FeatureSection[];
}

export const FEATURES: Feature[] = [
  {
    slug: 'text-generation',
    icon: '✍️',
    title: 'Text Generation',
    tagline: 'Write, edit, and refine content with AI that keeps your voice.',
    description:
      'Draft articles, docs, and marketing copy with a provider-agnostic engine — swap the model behind your work through configuration, never a rewrite.',
    status: 'available',
    sections: [
      {
        heading: 'Any model, one workflow',
        body: 'Synora routes your prompts through a single abstraction over ten AI providers — Anthropic, OpenAI, Gemini, and more. Change providers in settings; your prompts, history, and projects stay exactly where they are.',
      },
      {
        heading: 'Built for iteration',
        body: 'Control model, temperature, length, and system prompts per request. Every generation is tied to your project so drafts never get lost.',
      },
      {
        heading: 'Private by default',
        body: 'Your API keys are read through an audited secrets layer and never leave the backend. Prompts are never used to train anything.',
      },
    ],
  },
  {
    slug: 'code-generation',
    icon: '💻',
    title: 'Code Generation',
    tagline: 'Generate, debug, and optimize code in any language.',
    description:
      'A code-tuned mode of the same engine: scaffolding, refactors, tests, and explanations, with the model choice always yours.',
    status: 'available',
    sections: [
      {
        heading: 'Code-aware prompting',
        body: 'Code mode applies code-specific defaults so output arrives runnable — not wrapped in prose. Bring your own system prompt when you need house style.',
      },
      {
        heading: 'Model freedom',
        body: 'Point code generation at whichever provider does best for your stack today, and change your mind tomorrow without touching your projects.',
      },
    ],
  },
  {
    slug: 'image-generation',
    icon: '🎨',
    title: 'Image Generation',
    tagline: 'Stunning images from text descriptions.',
    description:
      'Prompt-to-image with durable asset storage and project organization, built on the same provider-agnostic core.',
    status: 'coming-soon',
    sections: [
      {
        heading: 'On the roadmap now',
        body: 'Image generation ships in the current release cycle with an async pipeline: submit a prompt, keep working, and get a durable, organized asset when it completes.',
      },
    ],
  },
  {
    slug: 'video-generation',
    icon: '🎬',
    title: 'Video Generation',
    tagline: 'Generate video from prompts and scripts.',
    description:
      'Script-to-video generation with the same asset management and provider flexibility as everything else in Synora.',
    status: 'coming-soon',
    sections: [
      {
        heading: 'On the roadmap now',
        body: 'Video generation arrives alongside the async media pipeline in the current release cycle.',
      },
    ],
  },
  {
    slug: 'audio-generation',
    icon: '🎵',
    title: 'Audio & Music',
    tagline: 'Voiceovers, music, and sound effects with AI.',
    description:
      'Generate narration and soundscapes for your projects, stored and organized like every other Synora asset.',
    status: 'coming-soon',
    sections: [
      {
        heading: 'On the roadmap now',
        body: 'Audio generation ships with the async media pipeline in the current release cycle.',
      },
    ],
  },
  {
    slug: 'collaboration',
    icon: '🤝',
    title: 'Team Collaboration',
    tagline: 'Workspaces, roles, and shared libraries for teams.',
    description:
      'Invite your team into shared workspaces with granular roles, from owner to viewer, and a shared history of everything created.',
    status: 'coming-soon',
    sections: [
      {
        heading: 'Workspace-native from day one',
        body: 'Synora’s data model is workspace-first — teams, roles, and invitations are core primitives, not bolt-ons. The collaboration UI ships in the current release cycle.',
      },
    ],
  },
];

export function getFeature(slug: string): Feature | undefined {
  return FEATURES.find((f) => f.slug === slug);
}
