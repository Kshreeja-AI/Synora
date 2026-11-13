import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import HomePage from '../src/app/(marketing)/page';
import { FEATURES } from '../src/content/features';

describe('Landing page', () => {
  describe('hero', () => {
    it('states what the product is, in one headline', () => {
      render(<HomePage />);
      expect(
        screen.getByRole('heading', { level: 1, name: /one workspace for every model/i })
      ).toBeInTheDocument();
    });

    it('offers account creation and sign-in, and says registration is by invitation', () => {
      render(<HomePage />);
      const create = screen.getAllByRole('link', { name: /create an account/i });
      expect(create.length).toBeGreaterThan(0);
      create.forEach((link) => expect(link).toHaveAttribute('href', '/auth/register'));
      const signIn = screen.getAllByRole('link', { name: /^sign in$/i });
      signIn.forEach((link) => expect(link).toHaveAttribute('href', '/auth/login'));
      expect(screen.getByText(/registration is by invitation/i)).toBeInTheDocument();
    });

    it('labels the release honestly as a private beta', () => {
      render(<HomePage />);
      expect(screen.getAllByText(/private beta/i).length).toBeGreaterThan(0);
    });
  });

  describe('content is truthful', () => {
    /*
     * The previous page carried invented testimonials, an uptime SLA, a
     * latency figure, a "10x faster" claim and compliance badges. None were
     * measured or earned. This test exists so they cannot quietly return.
     */
    it('carries no invented testimonials, metrics or compliance claims', () => {
      const { container } = render(<HomePage />);
      const text = container.textContent ?? '';
      for (const fabricated of [
        'Aisha Patel',
        'Marcus Chen',
        'Emma Rodriguez',
        '99.9%',
        '<100ms',
        '10x',
        'SOC 2',
        'SOC2',
        'HIPAA',
        'End-to-end encryption',
        'Zero-knowledge',
        'No credit card required',
      ]) {
        expect(text).not.toContain(fabricated);
      }
    });

    it('lists every capability with its real status from the content module', () => {
      render(<HomePage />);
      for (const feature of FEATURES) {
        expect(screen.getByText(feature.title)).toBeInTheDocument();
      }
      const available = FEATURES.filter((f) => f.status === 'available').length;
      const comingSoon = FEATURES.filter((f) => f.status === 'coming-soon').length;
      expect(screen.getAllByText('Available')).toHaveLength(available);
      expect(screen.getAllByText('Coming soon')).toHaveLength(comingSoon);
    });

    it('links each capability to its feature page', () => {
      render(<HomePage />);
      for (const feature of FEATURES) {
        expect(screen.getByRole('link', { name: new RegExp(feature.title, 'i') })).toHaveAttribute(
          'href',
          `/features/${feature.slug}`
        );
      }
    });
  });

  describe('sections', () => {
    it('describes the workspace surfaces', () => {
      render(<HomePage />);
      for (const title of ['Conversations', 'Ask Synora', 'Agents', 'Workflows']) {
        expect(screen.getByRole('heading', { level: 3, name: title })).toBeInTheDocument();
      }
    });

    it('names the supported providers', () => {
      render(<HomePage />);
      const list = screen.getByRole('list', { name: /supported providers/i });
      for (const provider of ['Anthropic', 'OpenAI', 'Google Gemini', 'Groq', 'Ollama']) {
        expect(list.textContent).toContain(provider);
      }
    });

    it('lists implemented security controls', () => {
      render(<HomePage />);
      expect(screen.getByText(/passwords hashed with bcrypt/i)).toBeInTheDocument();
      expect(screen.getByText(/two-factor authentication with recovery codes/i)).toBeInTheDocument();
    });

    it('renders the FAQ as native disclosure elements', () => {
      const { container } = render(<HomePage />);
      expect(screen.getByRole('heading', { name: /frequently asked questions/i })).toBeInTheDocument();
      expect(container.querySelectorAll('details').length).toBeGreaterThanOrEqual(4);
      expect(screen.getByText(/how do i get access/i)).toBeInTheDocument();
    });
  });

  describe('structure', () => {
    it('has exactly one h1 and anchors for the in-page nav links', () => {
      const { container } = render(<HomePage />);
      expect(container.querySelectorAll('h1')).toHaveLength(1);
      for (const id of ['features', 'providers', 'security']) {
        expect(container.querySelector(`#${id}`)).not.toBeNull();
      }
    });

    it('renders all content without waiting for an animation to reveal it', () => {
      const { container } = render(<HomePage />);
      const hidden = Array.from(container.querySelectorAll<HTMLElement>('*')).filter(
        (el) => el.style.opacity === '0'
      );
      expect(hidden).toHaveLength(0);
    });
  });
});
