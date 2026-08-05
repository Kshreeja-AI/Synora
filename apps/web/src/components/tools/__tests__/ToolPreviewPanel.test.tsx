/**
 * The preview panel before a tool sends anything real.
 *
 * The assertions are mostly about restraint: state the destination, the
 * secrets by name, and what would stop it — and never grade the tool
 * "safe" or "risky", because Synora has no system that can judge that.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ToolPreviewPanel } from '../ToolPreviewPanel';
import type { ToolExecutionPreview } from '@/lib/api/tools';

function preview(overrides: Partial<ToolExecutionPreview> = {}): ToolExecutionPreview {
  return {
    toolId: 't1',
    toolName: 'Notify webhook',
    type: 'HTTP',
    executed: false,
    wouldRequireApproval: false,
    destination: { host: 'hooks.example.com', method: 'POST', hostDependsOnSecret: false },
    secretsUsed: [],
    reversibleBySynora: false,
    reversibilityNote:
      'Synora cannot undo this once it runs — the request reaches a system outside Synora.',
    rateLimit: null,
    blockers: [],
    unknowns: ['the remote endpoint is not contacted by a preview, so its response is unknown'],
    wouldRun: true,
    ...overrides,
  };
}

describe('ToolPreviewPanel', () => {
  it('says nothing was sent, and where it would go', () => {
    render(<ToolPreviewPanel preview={preview()} />);
    expect(screen.getByText(/Nothing has been sent/)).toBeInTheDocument();
    expect(screen.getByText(/hooks\.example\.com/)).toBeInTheDocument();
    expect(screen.getByText(/Unknown until it runs:/)).toBeInTheDocument();
    // States what Synora can and cannot do about it afterwards — a
    // capability fact, still not a verdict.
    expect(screen.getByText(/Synora cannot undo this once it runs/)).toBeInTheDocument();
  });

  it('names secrets without implying their values are available', () => {
    render(<ToolPreviewPanel preview={preview({ secretsUsed: ['PARTNER_TOKEN'] })} />);
    expect(screen.getByText(/PARTNER_TOKEN/)).toBeInTheDocument();
    expect(screen.getByText(/values are never shown/)).toBeInTheDocument();
  });

  it('admits when the destination itself is hidden behind a secret', () => {
    render(
      <ToolPreviewPanel
        preview={preview({
          destination: { host: null, method: 'POST', hostDependsOnSecret: true },
        })}
      />,
    );
    // Honest ignorance beats a confident blank or a fabricated host.
    expect(screen.getByText(/address that comes from a stored secret/)).toBeInTheDocument();
  });

  it('states blockers, and never grades the tool safe or risky', () => {
    render(
      <ToolPreviewPanel
        preview={preview({ wouldRun: false, blockers: ['this tool is not active'] })}
      />,
    );
    expect(screen.getByText(/This would not run as-is/)).toBeInTheDocument();
    expect(screen.getByText(/this tool is not active/)).toBeInTheDocument();
    expect(screen.queryByText(/\b(safe|risky|dangerous)\b/i)).not.toBeInTheDocument();
  });
});
