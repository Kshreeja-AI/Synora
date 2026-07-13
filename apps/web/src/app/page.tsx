import Link from 'next/link';
import { Button } from '@synora/design-system';

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <nav className="border-b border-gray-200 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div className="text-2xl font-bold text-blue-600">Synora AI</div>
          <div className="flex gap-4">
            <Link href="/auth/login">
              <Button variant="ghost">Sign In</Button>
            </Link>
            <Link href="/auth/register">
              <Button variant="primary">Get Started</Button>
            </Link>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="text-center">
          <h1 className="text-5xl font-bold text-gray-900 mb-6">
            Create Amazing Content with AI
          </h1>
          <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
            Synora AI is the unified platform for creators to generate images, videos, audio, code, and more using powerful AI tools.
          </p>
          <div className="flex gap-4 justify-center">
            <Link href="/auth/register">
              <Button variant="primary" size="lg">
                Start Creating Now
              </Button>
            </Link>
            <a href="https://github.com/kshreeja-ai/synora">
              <Button variant="outline" size="lg">
                View on GitHub
              </Button>
            </a>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-20">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-4xl mb-4">🎨</div>
            <h3 className="text-xl font-bold mb-2">AI Image Generation</h3>
            <p className="text-gray-600">Create stunning images from text descriptions using advanced AI models.</p>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-4xl mb-4">🎬</div>
            <h3 className="text-xl font-bold mb-2">AI Video Generation</h3>
            <p className="text-gray-600">Generate videos automatically from prompts and scripts.</p>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-4xl mb-4">🎵</div>
            <h3 className="text-xl font-bold mb-2">AI Audio & Music</h3>
            <p className="text-gray-600">Create voiceovers, music, and sound effects with AI.</p>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-4xl mb-4">✍️</div>
            <h3 className="text-xl font-bold mb-2">AI Writing Assistant</h3>
            <p className="text-gray-600">Write, edit, and improve content with intelligent suggestions.</p>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-4xl mb-4">💻</div>
            <h3 className="text-xl font-bold mb-2">AI Coding Assistant</h3>
            <p className="text-gray-600">Generate code, debug, and optimize with AI assistance.</p>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-4xl mb-4">🤝</div>
            <h3 className="text-xl font-bold mb-2">Team Collaboration</h3>
            <p className="text-gray-600">Work together on projects with real-time collaboration features.</p>
          </div>
        </div>
      </div>
    </main>
  );
}
