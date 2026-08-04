/**
 * Template gallery tests.
 *
 * The assertions that matter are about what the surface must not imply:
 * that a template is doing something clever, and that the tools it
 * mentions are already connected. Both would set an expectation the
 * product cannot meet — the second one produces an agent that looks ready
 * and fails on first use.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TemplateGallery } from '../TemplateGallery';
import * as templatesApi from '@/lib/api/agentTemplates';
import type { AgentTemplate } from '@/lib/api/agentTemplates';

vi.mock('@/lib/api/agentTemplates', async () => {
  const actual = await vi.importActual<typeof templatesApi>('@/lib/api/agentTemplates');
  return {
    ...actual,
    useAgentTemplates: vi.fn(),
    useInstantiateTemplate: vi.fn(),
  };
});

const template: AgentTemplate = {
  id: 'tpl_editor',
  kind: 'agent',
  name: 'Draft editor',
  description: 'Improves a piece of writing without changing what it says.',
  category: 'writing',
  outcome: 'I wrote something and I want it tightened, not rewritten.',
  instructions: 'You edit drafts.',
  suggestedTools: [],
};

function idle(overrides: Record<string, unknown> = {}) {
  return { mutate: vi.fn(), isPending: false, ...overrides };
}

function renderGallery(kind: 'agent' | 'workflow' = 'agent') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TemplateGallery workspaceId="ws_1" kind={kind} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(templatesApi.useAgentTemplates).mockReturnValue({
    data: [template],
    isLoading: false,
  } as never);
  vi.mocked(templatesApi.useInstantiateTemplate).mockReturnValue(idle() as never);
});

describe('TemplateGallery', () => {
  it('leads with the outcome, not the mechanism', () => {
    renderGallery();
    expect(screen.getByText(/I wrote something and I want it tightened/)).toBeInTheDocument();
    expect(screen.getByText('Draft editor')).toBeInTheDocument();
  });

  it('says the created thing is real and editable, not special', () => {
    renderGallery();
    expect(screen.getByText(/creates a real agent you can then edit/)).toBeInTheDocument();
  });

  it('says plainly that templates cannot use tools yet', () => {
    renderGallery();
    // The trap this avoids: a user assuming the template arrives wired up,
    // then discovering on first run that it is not.
    expect(screen.getByText(/None of them can use tools yet/)).toBeInTheDocument();
  });

  it('shows suggested tools as things to connect, never as already connected', () => {
    vi.mocked(templatesApi.useAgentTemplates).mockReturnValue({
      data: [{ ...template, suggestedTools: ['a web search tool'] }],
      isLoading: false,
    } as never);

    renderGallery();
    expect(screen.getByText(/Works better once you connect: a web search tool/)).toBeInTheDocument();
  });

  it('instantiates by id when used', async () => {
    const user = userEvent.setup();
    const instantiate = vi.fn();
    vi.mocked(templatesApi.useInstantiateTemplate).mockReturnValue(
      idle({ mutate: instantiate }) as never,
    );

    renderGallery();
    await user.click(screen.getByRole('button', { name: /use this template/i }));

    expect(instantiate).toHaveBeenCalledWith({ templateId: 'tpl_editor' }, expect.anything());
  });

  it('renders nothing when there are no templates for this kind', () => {
    vi.mocked(templatesApi.useAgentTemplates).mockReturnValue({
      data: [],
      isLoading: false,
    } as never);

    const { container } = renderGallery('workflow');
    expect(container).toBeEmptyDOMElement();
  });

  it('surfaces a server refusal verbatim', async () => {
    const user = userEvent.setup();
    const { toast } = await import('sonner');
    const toastError = vi.spyOn(toast, 'error');
    vi.mocked(templatesApi.useInstantiateTemplate).mockReturnValue(
      idle({
        mutate: vi.fn((_v, opts) => opts?.onError?.(new Error('an agent needs a name'))),
      }) as never,
    );

    renderGallery();
    await user.click(screen.getByRole('button', { name: /use this template/i }));

    expect(toastError).toHaveBeenCalledWith('an agent needs a name');
  });
});
