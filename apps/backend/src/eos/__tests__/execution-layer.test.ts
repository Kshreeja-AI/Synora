/**
 * Execution layer tests.
 *
 * This is the only component that changes anything, so these tests are
 * about what it refuses at least as much as what it does. Every governance
 * boundary the founder set is asserted here: approval is required, protected
 * refs are unreachable, merging and deploying do not exist as capabilities,
 * and a failing test suite never produces a pull request.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { engineeringEventBus } from '../event-bus';
import {
  configureExecution,
  executeProposal,
  resetExecution,
  buildPullRequestBody,
  type GitOperations,
} from '../execution-layer';
import {
  startProposalEngine,
  stopProposalEngine,
  listProposals,
  decideProposal,
} from '../proposal-engine';
import { startPromptIntelligence, stopPromptIntelligence, recordPromptOutcome } from '../prompt-intelligence';

const change = { path: 'prompts/summarize.txt', content: 'a revised prompt' };

function fakeGit(overrides: Partial<GitOperations> = {}): GitOperations {
  return {
    createBranch: vi.fn().mockResolvedValue(undefined),
    applyChange: vi.fn().mockResolvedValue(undefined),
    runTests: vi.fn().mockResolvedValue({ passed: true, output: '270 passed' }),
    openPullRequest: vi.fn().mockResolvedValue({ url: 'https://github.com/org/repo/pull/1' }),
    ...overrides,
  };
}

/** Drives a regression into a proposal and returns its id. */
function pendingProposalId(): string {
  startPromptIntelligence({ windowSize: 4, dropThreshold: 0.3 });
  startProposalEngine();
  for (let i = 0; i < 16; i++) recordPromptOutcome({ promptId: 'p', success: true, latencyMs: 10 });
  for (let i = 0; i < 4; i++) recordPromptOutcome({ promptId: 'p', success: false, latencyMs: 10 });
  return listProposals()[0].id;
}

describe('execution-layer', () => {
  beforeEach(() => {
    resetExecution();
    stopProposalEngine();
    stopPromptIntelligence();
  });

  describe('capabilities it does not have', () => {
    it('exposes no way to merge, deploy, or reach production', async () => {
      const module = await import('../execution-layer');

      // Absence, not a guard: there is no call to forget to protect.
      expect(
        Object.keys(module).some((key) => /merge|deploy|release|rollout|production/i.test(key)),
      ).toBe(false);
    });

    it('its git interface offers only branch, change, test, and pull request', () => {
      const ops = fakeGit();
      expect(Object.keys(ops).sort()).toEqual([
        'applyChange',
        'createBranch',
        'openPullRequest',
        'runTests',
      ]);
    });
  });

  describe('approval gate', () => {
    it('refuses a pending proposal', async () => {
      const id = pendingProposalId();
      const git = fakeGit();
      configureExecution(git);

      const record = await executeProposal(id, change);

      expect(record.outcome).toBe('refused');
      expect(record.reason).toMatch(/not approved.*decision you recorded/i);
      // Nothing was touched, not even a branch.
      expect(git.createBranch).not.toHaveBeenCalled();
    });

    it('refuses a rejected proposal', async () => {
      const id = pendingProposalId();
      decideProposal(id, 'rejected');
      const git = fakeGit();
      configureExecution(git);

      const record = await executeProposal(id, change);

      expect(record.outcome).toBe('refused');
      expect(git.createBranch).not.toHaveBeenCalled();
    });

    it('refuses an unknown proposal', async () => {
      configureExecution(fakeGit());
      expect((await executeProposal('nope', change)).outcome).toBe('refused');
    });

    it('cannot approve anything itself', async () => {
      const module = await import('../execution-layer');
      expect(Object.keys(module).some((key) => /approve|decide/i.test(key))).toBe(false);
    });
  });

  describe('branch safety', () => {
    it('names the branch itself, from the proposal id', async () => {
      const id = pendingProposalId();
      decideProposal(id, 'approved');
      const git = fakeGit();
      configureExecution(git);

      const record = await executeProposal(id, change);

      // No text from a detector, a drafter, or a caller reaches the name,
      // so no input can steer a write at a protected ref.
      expect(record.branch).toMatch(/^eos\/proposal-/);
      expect(git.createBranch).toHaveBeenCalledWith(record.branch);
    });

    it('refuses without repository access rather than doing nothing quietly', async () => {
      const id = pendingProposalId();
      decideProposal(id, 'approved');

      const record = await executeProposal(id, change);

      expect(record.outcome).toBe('refused');
      expect(record.reason).toMatch(/No repository access is configured/i);
    });
  });

  describe('a successful run', () => {
    it('branches, applies, tests, and opens a pull request — in that order', async () => {
      const id = pendingProposalId();
      decideProposal(id, 'approved');
      const order: string[] = [];
      const git = fakeGit({
        createBranch: vi.fn().mockImplementation(async () => void order.push('branch')),
        applyChange: vi.fn().mockImplementation(async () => void order.push('apply')),
        runTests: vi.fn().mockImplementation(async () => {
          order.push('test');
          return { passed: true, output: 'ok' };
        }),
        openPullRequest: vi.fn().mockImplementation(async () => {
          order.push('pr');
          return { url: 'https://github.com/org/repo/pull/7' };
        }),
      });
      configureExecution(git);

      const record = await executeProposal(id, change);

      expect(order).toEqual(['branch', 'apply', 'test', 'pr']);
      expect(record.outcome).toBe('pull-request-opened');
      expect(record.pullRequestUrl).toBe('https://github.com/org/repo/pull/7');
    });

    it('stops at the pull request and waits', async () => {
      const id = pendingProposalId();
      decideProposal(id, 'approved');
      const git = fakeGit();
      configureExecution(git);

      const record = await executeProposal(id, change);

      // The terminal state is an open pull request. Nothing merges it, and
      // no capability exists that could.
      expect(record.outcome).toBe('pull-request-opened');
      expect(Object.keys(git)).not.toContain('merge');
    });
  });

  describe('failing tests', () => {
    it('opens no pull request when the suite fails', async () => {
      const id = pendingProposalId();
      decideProposal(id, 'approved');
      const git = fakeGit({
        runTests: vi.fn().mockResolvedValue({ passed: false, output: '3 failed' }),
      });
      configureExecution(git);

      const record = await executeProposal(id, change);

      // A pull request asserts a change is ready for review. Opening one
      // over a failing suite asserts that falsely.
      expect(record.outcome).toBe('tests-failed');
      expect(git.openPullRequest).not.toHaveBeenCalled();
      expect(record.testOutput).toBe('3 failed');
      expect(record.reason).toMatch(/branch is left for inspection/i);
    });
  });

  describe('failures', () => {
    it('records an error rather than throwing at the caller', async () => {
      const id = pendingProposalId();
      decideProposal(id, 'approved');
      configureExecution(fakeGit({ applyChange: vi.fn().mockRejectedValue(new Error('write denied')) }));

      const record = await executeProposal(id, change);

      expect(record.outcome).toBe('error');
      expect(record.reason).toBe('write denied');
    });

    it('emits every outcome, including refusals', async () => {
      const events: Array<{ payload: Record<string, unknown> }> = [];
      const unsub = engineeringEventBus.on('proposal.execution.completed', (e) =>
        events.push(e as { payload: Record<string, unknown> }),
      );
      const id = pendingProposalId();
      configureExecution(fakeGit());

      await executeProposal(id, change); // refused: still pending

      // A refusal must be visible in the founder's history, not swallowed.
      expect(events).toHaveLength(1);
      expect(events[0].payload.outcome).toBe('refused');
      unsub();
    });
  });

  describe('the pull request body', () => {
    it('carries the caveats under a heading that frames them as limits', () => {
      const id = pendingProposalId();
      const proposal = listProposals()[0];

      const body = buildPullRequestBody(proposal);

      // A reviewer arriving from a notification has none of the dashboard's
      // context, so the limits have to travel with the change.
      expect(body).toContain('## What this evidence cannot tell you');
      for (const caveat of proposal.caveats) expect(body).toContain(caveat);
      expect(id).toBeTruthy();
    });

    it('states plainly that nothing has been applied', () => {
      const proposal = (pendingProposalId(), listProposals()[0]);

      const body = buildPullRequestBody(proposal);

      expect(body).toMatch(/has not been merged, deployed, or applied anywhere/i);
      expect(body).toMatch(/waiting for review/i);
    });
  });
});
