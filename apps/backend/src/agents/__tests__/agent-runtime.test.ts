import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The runtime resolver decides what kind of intelligence a run gets, and —
 * the part that matters — what the caller is told about it.
 *
 * The failure this guards against is quiet: a deterministic local planner
 * producing plausible-looking output that a UI renders as if a model
 * produced it. That would be fabrication of exactly the kind this platform
 * has removed before. So the mode is asserted on both branches, and the
 * notice is asserted to actually say which one happened.
 */

const resolveTextGenerationProvider = vi.hoisted(() => vi.fn());
const generateText = vi.hoisted(() => vi.fn());

vi.mock('../../ai/resolver.js', () => ({ resolveTextGenerationProvider }));
vi.mock('../../ai/index.js', () => ({ generateText }));
vi.mock('../tool-runner-adapter.js', () => ({
  createWorkspaceToolRunner: vi.fn(() => ({ execute: vi.fn() })),
}));

// A static import is safe despite the mocks above: `vi.mock` and
// `vi.hoisted` are both lifted above imports, so the module under test sees
// the doubles. A dynamic top-level import would need top-level await, which
// this module target does not allow.
import { resolveAgentRuntime } from '../runtime.js';
import { createWorkspaceToolRunner } from '../tool-runner-adapter.js';

describe('agent runtime resolution', () => {
  beforeEach(() => {
    resolveTextGenerationProvider.mockReset();
    generateText.mockReset();
  });

  it('falls back to the local planner when no provider is configured, and says so', async () => {
    resolveTextGenerationProvider.mockRejectedValue(new Error('nothing configured'));

    const runtime = await resolveAgentRuntime('user_1');

    expect(runtime.mode).toBe('local');
    expect(runtime.provider).toBeUndefined();
    // The wording is load-bearing, not decoration: this string reaches the
    // user, and it must state plainly that this is not intelligence.
    expect(runtime.notice).toMatch(/^LOCAL:/);
    expect(runtime.notice).toMatch(/not model intelligence/);

    const plan = await runtime.deps.planner.plan({
      task: 'generate hello',
      instructions: 'x',
      allowedTools: [],
    });
    // The stamp travels with the plan itself, so even a consumer that
    // ignores the notice cannot mistake this for model output.
    expect(plan.origin).toBe('local-deterministic');
    expect(generateText).not.toHaveBeenCalled();
  });

  it('uses the model planner when a provider resolves, and names it', async () => {
    resolveTextGenerationProvider.mockResolvedValue({ id: 'anthropic' });
    generateText.mockResolvedValue({
      text: '[{"kind":"generate","description":"answer","input":"hi"}]',
    });

    const runtime = await resolveAgentRuntime('user_1');

    expect(runtime.mode).toBe('model');
    expect(runtime.provider).toBe('anthropic');
    expect(runtime.notice).toMatch(/^REAL:/);

    const plan = await runtime.deps.planner.plan({
      task: 'say hi',
      instructions: 'x',
      allowedTools: [],
    });
    expect(plan.origin).toBe('model');
    expect(generateText).toHaveBeenCalledOnce();
  });

  it('does not fall back to local when a configured provider fails at call time', async () => {
    // A provider that resolves but then errors is a broken provider, not an
    // absent one. Silently degrading to deterministic output would turn a
    // visible outage into invisible fake intelligence, so the failure
    // propagates and the run fails honestly.
    resolveTextGenerationProvider.mockResolvedValue({ id: 'anthropic' });
    generateText.mockRejectedValue(new Error('401 invalid api key'));

    const runtime = await resolveAgentRuntime('user_1');
    expect(runtime.mode).toBe('model');

    await expect(
      runtime.deps.planner.plan({ task: 'say hi', instructions: 'x', allowedTools: [] }),
    ).rejects.toThrow(/401/);
  });

  it('binds the tool runner to the requesting user, never to ambient authority', async () => {
    resolveTextGenerationProvider.mockRejectedValue(new Error('nothing configured'));

    await resolveAgentRuntime('user_alice');
    await resolveAgentRuntime('user_bob');

    // Resolved per request rather than cached: a cached runner would let one
    // user's run execute tools with another user's permissions.
    expect(createWorkspaceToolRunner).toHaveBeenCalledWith({ requestedBy: 'user_alice' });
    expect(createWorkspaceToolRunner).toHaveBeenCalledWith({ requestedBy: 'user_bob' });
  });
});
