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
import { recordAttemptsForTesting } from '../resilience/retry';
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

/**
 * A FAILED CALL IS NOT NECESSARILY A FREE CALL.
 *
 * `withTimeout` bounds how long Synora waits; it cannot cancel the upstream
 * request — its own header says the remote call "may still complete and
 * bill after we have stopped waiting." The retry layer then tries again, up
 * to three times. Recording nothing on failure therefore made a timeout
 * storm free forever as far as the cap was concerned: real money leaving,
 * zero counted, and the limit never binding however long it ran.
 */
describe('spend on failed calls', () => {
  it('charges for a timed-out generation the provider may still have billed', async () => {
    const timeout = new Error('anthropic timeout after 60000ms');
    generateTextMock.mockRejectedValue(timeout);

    await expect(
      instrumentedGenerate('agent.plan', { prompt: 'x'.repeat(400) }, { workspaceId: 'ws1' })
    ).rejects.toThrow(/timeout/);

    // Before the fix this was never called — the whole hole in one line.
    expect(recordMock).toHaveBeenCalledTimes(1);
    expect(recordMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({ workspaceId: 'ws1' })
    );
    expect(recordMock.mock.calls[0][0].fallbackChars).toBeGreaterThan(0);
  });

  it('scales the charge by how many attempts actually ran', async () => {
    // Three attempts against a stalled provider can bill three times while
    // the caller sees one failure.
    const timeout = new Error('anthropic timeout after 60000ms');
    recordAttemptsForTesting(timeout, 3);
    generateTextMock.mockRejectedValue(timeout);

    await expect(
      instrumentedGenerate('agent.plan', { prompt: 'x'.repeat(100) }, { workspaceId: 'ws1' })
    ).rejects.toThrow();

    expect(recordMock.mock.calls[0][0].fallbackChars).toBe(300);
  });

  it('does NOT charge for a failure that never reached a model', async () => {
    // A refused connection bills nothing. Charging it would refuse callers
    // for spend that demonstrably did not happen — the opposite error, and
    // just as dishonest.
    generateTextMock.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:443'));

    await expect(
      instrumentedGenerate('agent.plan', { prompt: 'p' }, { workspaceId: 'ws1' })
    ).rejects.toThrow();

    expect(recordMock).not.toHaveBeenCalled();
  });
});
