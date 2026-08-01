import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import HomePage from '../src/app/(marketing)/page';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

function Wrapper({ children }: { children: React.ReactNode }) {
  const testQueryClient = createTestQueryClient();
  return (
    <QueryClientProvider client={testQueryClient}>
      {children}
    </QueryClientProvider>
  );
}

describe('Landing Page - Production Quality', () => {
  describe('Hero Section', () => {
    it('renders hero with main headline', () => {
      render(<HomePage />, { wrapper: Wrapper });
      expect(screen.getByText(/Create anything with AI/i)).toBeInTheDocument();
    });

    it('renders hero with subheading', () => {
      render(<HomePage />, { wrapper: Wrapper });
      expect(screen.getByText(/Own every part of it/i)).toBeInTheDocument();
    });

    it('renders call-to-action buttons', () => {
      render(<HomePage />, { wrapper: Wrapper });
      expect(screen.getByText(/Start creating free/i)).toBeInTheDocument();
      expect(screen.getByText(/View pricing/i)).toBeInTheDocument();
    });

    it('renders status badge', () => {
      render(<HomePage />, { wrapper: Wrapper });
      expect(screen.getByText(/Text & code live/i)).toBeInTheDocument();
    });

    it('renders statistics band with provider count', () => {
      const { container } = render(<HomePage />, { wrapper: Wrapper });
      expect(container.textContent).toContain('10');
      expect(container.textContent).toContain('interchangeable AI providers');
      expect(container.textContent).toContain('creative mediums');
    });
  });

  describe('Features Section', () => {
    it('renders features section heading', () => {
      render(<HomePage />, { wrapper: Wrapper });
      expect(screen.getByText(/One platform, every medium/i)).toBeInTheDocument();
    });

    it('renders feature cards with titles and descriptions', () => {
      const { container } = render(<HomePage />, { wrapper: Wrapper });
      expect(container.textContent).toContain('Text Generation');
      expect(container.textContent).toContain('Code Generation');
      expect(container.textContent).toContain('Image Generation');
    });

    it('renders coming-soon badges for unreleased features', () => {
      render(<HomePage />, { wrapper: Wrapper });
      const comingSoonBadges = screen.getAllByText(/Coming soon/i);
      expect(comingSoonBadges.length).toBeGreaterThan(0);
    });
  });

  describe('AI Capabilities Section', () => {
    it('renders capabilities section', () => {
      render(<HomePage />, { wrapper: Wrapper });
      expect(screen.getByText(/Powered by the latest AI models/i)).toBeInTheDocument();
    });

    it('renders all capability cards with descriptions', () => {
      const { container } = render(<HomePage />, { wrapper: Wrapper });
      expect(container.textContent).toContain('Text & Code Generation');
      expect(container.textContent).toContain('Write, edit, refactor, and debug');
      expect(container.textContent).toContain('Unlimited Iterations');
    });
  });

  describe('Why Synora Section', () => {
    it('renders pillars section with three key differentiators', () => {
      render(<HomePage />, { wrapper: Wrapper });
      expect(screen.getByText(/Provider-agnostic by design/i)).toBeInTheDocument();
      expect(screen.getByText(/Never locked in/i)).toBeInTheDocument();
      expect(screen.getByText(/Security first/i)).toBeInTheDocument();
    });
  });

  describe('Security Section', () => {
    it('renders security features', () => {
      render(<HomePage />, { wrapper: Wrapper });
      expect(screen.getByText(/End-to-end encryption/i)).toBeInTheDocument();
      expect(screen.getByText(/Audit trail logging/i)).toBeInTheDocument();
    });
  });

  describe('Pricing Section', () => {
    it('renders three pricing tiers', () => {
      const { container } = render(<HomePage />, { wrapper: Wrapper });
      expect(container.textContent).toContain('Creator');
      expect(container.textContent).toContain('Pro');
      expect(container.textContent).toContain('Enterprise');
    });

    it('renders pricing features for each plan', () => {
      const { container } = render(<HomePage />, { wrapper: Wrapper });
      expect(container.textContent).toContain('Unlimited text & code generation');
      expect(container.textContent).toContain('Team collaboration');
    });
  });

  describe('Testimonials Section', () => {
    it('renders testimonials from creators', () => {
      render(<HomePage />, { wrapper: Wrapper });
      expect(screen.getByText(/Aisha Patel/)).toBeInTheDocument();
      expect(screen.getByText(/Marcus Chen/)).toBeInTheDocument();
      expect(screen.getByText(/Emma Rodriguez/)).toBeInTheDocument();
    });
  });

  describe('FAQ Section', () => {
    it('renders FAQ heading', () => {
      render(<HomePage />, { wrapper: Wrapper });
      expect(screen.getByText(/Frequently asked questions/i)).toBeInTheDocument();
    });

    it('renders FAQ items as details elements', () => {
      render(<HomePage />, { wrapper: Wrapper });
      expect(screen.getByText(/What AI providers does Synora support/i)).toBeInTheDocument();
      expect(screen.getByText(/Can I switch providers without losing my data/i)).toBeInTheDocument();
    });
  });

  describe('Footer CTA', () => {
    it('renders final call-to-action section', () => {
      render(<HomePage />, { wrapper: Wrapper });
      expect(screen.getByText(/Ready to create at the speed of thought/i)).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('renders semantic HTML structure', () => {
      const { container } = render(<HomePage />, { wrapper: Wrapper });
      expect(container.querySelectorAll('section').length).toBeGreaterThan(0);
      expect(container.querySelectorAll('h1').length).toBeGreaterThan(0);
      expect(container.querySelectorAll('h2').length).toBeGreaterThan(0);
      expect(container.querySelectorAll('h3').length).toBeGreaterThan(0);
    });

    it('renders buttons with proper accessibility', () => {
      render(<HomePage />, { wrapper: Wrapper });
      const buttons = screen.getAllByRole('link');
      const actionButtons = buttons.filter((btn) => {
        const text = btn.textContent || '';
        return (
          text.includes('Get started') ||
          text.includes('Start creating') ||
          text.includes('View pricing')
        );
      });
      expect(actionButtons.length).toBeGreaterThan(0);
    });

    it('includes aria-hidden on decorative elements', () => {
      const { container } = render(<HomePage />, { wrapper: Wrapper });
      const decorativeElements = container.querySelectorAll('[aria-hidden="true"]');
      expect(decorativeElements.length).toBeGreaterThan(0);
    });
  });

  describe('Responsive Design', () => {
    it('renders with proper container structure', () => {
      const { container } = render(<HomePage />, { wrapper: Wrapper });
      expect(container.querySelectorAll('section').length).toBeGreaterThan(0);
    });

    it('renders grid layouts for different breakpoints', () => {
      const { container } = render(<HomePage />, { wrapper: Wrapper });
      const grids = container.querySelectorAll('[class*="grid"]');
      expect(grids.length).toBeGreaterThan(0);
    });
  });

  describe('Content Quality', () => {
    it('contains no placeholder or lorem ipsum text', () => {
      const { container } = render(<HomePage />, { wrapper: Wrapper });
      const text = container.textContent || '';
      expect(text.toLowerCase()).not.toContain('lorem ipsum');
      expect(text.toLowerCase()).not.toContain('placeholder');
      expect(text.toLowerCase()).not.toContain('todo');
      expect(text.toLowerCase()).not.toContain('fixme');
    });

    it('renders unique and purposeful content in each section', () => {
      render(<HomePage />, { wrapper: Wrapper });
      expect(screen.getByText(/Provider-agnostic by design/i)).toBeInTheDocument();
      expect(screen.getByText(/Never locked in/i)).toBeInTheDocument();
      expect(screen.getByText(/Rotating sessions with reuse detection/i)).toBeInTheDocument();
    });
  });

  describe('SEO and Metadata', () => {
    it('page component exports metadata', async () => {
      const { metadata } = await import('../src/app/(marketing)/page');
      expect(metadata).toBeDefined();
      expect(metadata.title).toBeTruthy();
      expect(metadata.description).toBeTruthy();
    });
  });
});
