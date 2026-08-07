/**
 * The budget gate's position inside instrumentedGenerate.
 *
 * Separate from instrumentedGenerate.test.ts on purpose: that file runs
 * the REAL spend guard (proving the no-caps default changes nothing);
 * this one mocks the guard to pin the wiring itself — refusal happens
 * BEFORE the provider is called, and raw usage crosses the boundary
 * untouched.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { generateTextMock, assertMock, recordMock } = vi.hoisted(() => ({
  generateTextMock: vi.fn(),
  assertMock: vi.fn(),
  recordMock: vi.fn(),
}));

vi.mock('./index', () => ({ generateText: generateTextMock }));
vi.mock('./spend-guard', async (importOriginal) => {
  const original = await importOriginal<typeof import('./spend-guard')>();
  return {
    ...original,
    assertAiBudget: assertMock,
    recordAiSpend: recordMock,
  };
});

import { instrumentedGenerate } from './instrumentedGenerate';
import { AiBudgetExceededError } from './spend-guard';
import { resetAiPathCoverage } from '../eos/instrumentation';

beforeEach(() => {
  generateTextMock.mockReset();
  assertMock.mockReset().mockResolvedValue(undefined);
  recordMock.mockReset().mockResolvedValue({ tokens: 0, costCents: 0, estimated: false });
  resetAiPathCoverage();
});

describe('instrumentedGenerate budget wiring', () => {
  it('refuses over-budget BEFORE the provider is ever called', async () => {
    assertMock.mockRejectedValue(
      new AiBudgetExceededError('workspace', 'daily-cost', 'limit reached')
    );

    await expect(
      instrumentedGenerate('agent.plan', { prompt: 'p' }, { workspaceId: 'ws1' })
    ).rejects.toBeInstanceOf(AiBudgetExceededError);

    // THE assertion of this file. A gate that runs after the call is a
    // receipt, not a gate.
    expect(generateTextMock).not.toHaveBeenCalled();
    expect(recordMock).not.toHaveBeenCalled();
  });

  it('passes the caller workspace to both the gate and the ledger', async () => {
    generateTextMock.mockResolvedValue({
      text: 'out',
      provider: 'ollama',
      model: 'llama3.1',
      usage: { inputTokens: 3, outputTokens: 4 },
    });

    await instrumentedGenerate('agent.plan', { prompt: 'p' }, { workspaceId: 'ws1' });

    expect(assertMock).toHaveBeenCalledWith({ workspaceId: 'ws1' });
    expect(recordMock).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws1', inputTokens: 3, outputTokens: 4 })
    );
  });

  it('passes ABSENT usage through as undefined — never coerced to zero', async () => {
    generateTextMock.mockResolvedValue({
      text: 'out',
      provider: 'ollama',
      model: 'llama3.1',
      // No usage at all — the self-hosted reality.
    });

    await instrumentedGenerate('agent.plan', { prompt: '12345678' });

    const recorded = recordMock.mock.calls[0][0];
    expect(recorded.inputTokens).toBeUndefined();
    expect(recorded.outputTokens).toBeUndefined();
    // The floor estimate has something to stand on: prompt + output chars.
    expect(recorded.fallbackChars).toBe('12345678'.length + 'out'.length);
  });
});
