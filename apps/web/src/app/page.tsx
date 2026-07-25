import Link from 'next/link';
import { Button, Card, CardContent } from '@synora/design-system';

const features = [
  {
    icon: '🎨',
    title: 'AI Image Generation',
    description: 'Create stunning images from text descriptions using advanced AI models.',
  },
  {
    icon: '🎬',
    title: 'AI Video Generation',
    description: 'Generate videos automatically from prompts and scripts.',
  },
  {
    icon: '🎵',
    title: 'AI Audio & Music',
    description: 'Create voiceovers, music, and sound effects with AI.',
  },
  {
    icon: '✍️',
    title: 'AI Writing Assistant',
    description: 'Write, edit, and improve content with intelligent suggestions.',
  },
  {
    icon: '💻',
    title: 'AI Coding Assistant',
    description: 'Generate code, debug, and optimize with AI assistance.',
  },
  {
    icon: '🤝',
    title: 'Team Collaboration',
    description: 'Work together on projects with real-time collaboration features.',
  },
];

export default function Home(): React.JSX.Element {
  return (
    <main className="min-h-screen bg-background">
      <nav className="border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div className="text-2xl font-bold text-primary">Synora AI</div>
          <div className="flex gap-4">
            <Button asChild variant="ghost">
              <Link href="/auth/login">Sign In</Link>
            </Button>
            <Button asChild variant="primary">
              <Link href="/auth/register">Get Started</Link>
            </Button>
          </div>
        </div>
      </nav>

      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="text-center animate-fade-up">
          <h1 className="mb-6 text-5xl font-bold tracking-tight text-foreground">
            Create Amazing Content with AI
          </h1>
          <p className="mx-auto mb-8 max-w-2xl text-xl text-muted-foreground">
            Synora AI is the unified platform for creators to generate images, videos, audio,
            code, and more using powerful AI tools.
          </p>
          <div className="flex justify-center gap-4">
            <Button asChild variant="primary" size="lg">
              <Link href="/auth/register">Start Creating Now</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <a href="https://github.com/kshreeja-ai/synora">View on GitHub</a>
            </Button>
          </div>
        </div>

        <div className="mt-20 grid grid-cols-1 gap-8 md:grid-cols-3">
          {features.map((feature) => (
            <Card key={feature.title}>
              <CardContent className="p-6">
                <div className="mb-4 text-4xl">{feature.icon}</div>
                <h3 className="mb-2 text-xl font-bold text-foreground">{feature.title}</h3>
                <p className="text-muted-foreground">{feature.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </main>
  );
}
