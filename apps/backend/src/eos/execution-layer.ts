import { engineeringEventBus } from './event-bus.js';
import { getProposal, type Proposal } from './proposal-engine.js';

/**
 * Carries out an approved proposal — as far as a pull request, and no
 * further.
 *
 * GOVERNANCE. This is the only component in the platform that changes
 * anything, so its limits are enforced by what it can reach rather than by
 * what it promises.
 *
 * It may: create a feature branch, apply a drafted change, run the test
 * suite, and open a pull request.
 *
 * It may never: touch a protected branch, merge anything, deploy anything,
 * or reach production infrastructure, secrets, or databases. Three
 * structural facts enforce that, in order of strength:
 *
 * 1. `GitOperations` has no merge, no deploy, and no push-to-branch
 *    operation. The capability is absent, not guarded — there is no call to
 *    forget to protect.
 * 2. Branch names are generated here from a fixed prefix. Nothing in a
 *    proposal, a draft, or a caller's input can name the branch, so no
 *    input can steer a write at a protected ref.
 * 3. The generated name is checked against a deny-list before any injected
 *    operation runs. Belt and braces: if a future change ever allowed a
 *    caller-supplied name, this still refuses.
 *
 * APPROVAL IS THE GATE. Execution requires a proposal already marked
 * approved — a decision a human recorded. This module cannot approve
 * anything; it imports only read accessors from the proposal engine.
 *
 * FAILING TESTS DO NOT PRODUCE A PULL REQUEST. A pull request is a claim
 * that a change is ready for review. Opening one over a failing suite makes
 * that claim falsely, so the run stops, records why, and leaves the branch
 * for inspection.
 */

const BRANCH_PREFIX = 'eos/proposal-';

/**
 * Refs this component must never write to under any circumstances. Matched
 * against the branch it generated, before anything is called.
 */
const PROTECTED_REFS = ['main', 'master', 'production', 'prod', 'release', 'develop', 'SYNORA'];

export interface GitOperations {
  createBranch(name: string): Promise<void>;
  /** Applies the drafted change on the current branch. */
  applyChange(change: { path: string; content: string }): Promise<void>;
  /** Returns whether the suite passed, plus its output for the record. */
  runTests(): Promise<{ passed: boolean; output: string }>;
  openPullRequest(pr: { branch: string; title: string; body: string }): Promise<{ url: string }>;
}

export type ExecutionOutcome =
  | 'pull-request-opened'
  | 'tests-failed'
  | 'refused'
  | 'error';

export interface ExecutionRecord {
  proposalId: string;
  outcome: ExecutionOutcome;
  branch?: string;
  pullRequestUrl?: string;
  testOutput?: string;
  /** Why execution was refused or failed, in plain terms. */
  reason?: string;
  startedAt: number;
  finishedAt: number;
}

let git: GitOperations | null = null;

/**
 * Supplies the git capability. Unset, execution refuses — the correct
 * behaviour before any repository access is configured, and the reason
 * every test can exercise this module without touching a real repository.
 */
export function configureExecution(ops: GitOperations | null): void {
  git = ops;
}

export function resetExecution(): void {
  git = null;
}

function branchNameFor(proposal: Proposal): string {
  // Derived here from the proposal's own id, never from any text a
  // detector, a drafter, or a caller supplied.
  const safeId = proposal.id.replace(/[^a-zA-Z0-9_-]/g, '');
  return `${BRANCH_PREFIX}${safeId}`;
}

function refuse(proposalId: string, reason: string, startedAt: number): ExecutionRecord {
  const record: ExecutionRecord = {
    proposalId,
    outcome: 'refused',
    reason,
    startedAt,
    finishedAt: Date.now(),
  };
  emit(record);
  return record;
}

function emit(record: ExecutionRecord): void {
  engineeringEventBus.emit({
    type: 'proposal.execution.completed',
    timestamp: record.finishedAt,
    source: 'execution-layer',
    payload: {
      proposalId: record.proposalId,
      outcome: record.outcome,
      branch: record.branch,
      pullRequestUrl: record.pullRequestUrl,
      reason: record.reason,
    },
  });
}

/**
 * Executes an approved proposal, stopping at a pull request.
 *
 * Every refusal returns a record explaining itself rather than throwing, so
 * a refusal is visible in the founder's history rather than disappearing
 * into a log.
 */
export async function executeProposal(
  proposalId: string,
  change: { path: string; content: string },
): Promise<ExecutionRecord> {
  const startedAt = Date.now();
  const proposal = getProposal(proposalId);

  if (!proposal) {
    return refuse(proposalId, 'No such proposal.', startedAt);
  }

  // The gate. Not a policy check that could be relaxed — without a recorded
  // human approval there is nothing this module is permitted to act on.
  if (proposal.status !== 'approved') {
    return refuse(
      proposalId,
      `Proposal is ${proposal.status}, not approved. Execution requires a decision you recorded.`,
      startedAt,
    );
  }

  if (!git) {
    return refuse(
      proposalId,
      'No repository access is configured, so nothing could be executed.',
      startedAt,
    );
  }

  const branch = branchNameFor(proposal);

  // Defence in depth: the name was generated above and cannot be a protected
  // ref today. This still checks, so a future change that allowed a supplied
  // name cannot silently become dangerous.
  if (PROTECTED_REFS.some((ref) => branch === ref || branch.endsWith(`/${ref}`))) {
    return refuse(proposalId, `Refusing to write to a protected ref (${branch}).`, startedAt);
  }

  try {
    await git.createBranch(branch);
    await git.applyChange(change);

    const tests = await git.runTests();
    if (!tests.passed) {
      // A pull request asserts a change is ready for review. Opening one
      // over a failing suite would assert that falsely.
      const record: ExecutionRecord = {
        proposalId,
        outcome: 'tests-failed',
        branch,
        testOutput: tests.output,
        reason: 'Tests failed, so no pull request was opened. The branch is left for inspection.',
        startedAt,
        finishedAt: Date.now(),
      };
      emit(record);
      return record;
    }

    const pr = await git.openPullRequest({
      branch,
      title: `[EOS] ${proposal.title}`,
      body: buildPullRequestBody(proposal),
    });

    const record: ExecutionRecord = {
      proposalId,
      outcome: 'pull-request-opened',
      branch,
      pullRequestUrl: pr.url,
      testOutput: tests.output,
      startedAt,
      finishedAt: Date.now(),
    };
    emit(record);
    return record;
  } catch (err) {
    const record: ExecutionRecord = {
      proposalId,
      outcome: 'error',
      branch,
      reason: err instanceof Error ? err.message : String(err),
      startedAt,
      finishedAt: Date.now(),
    };
    emit(record);
    return record;
  }
}

/**
 * The pull request body carries the proposal's caveats as prominently as
 * its findings — a reviewer arriving from a notification has none of the
 * dashboard's context, and the limits of the reasoning must travel with it.
 */
export function buildPullRequestBody(proposal: Proposal): string {
  const caveats = proposal.caveats.map((c) => `- ${c}`).join('\n');
  const metrics = Object.entries(proposal.evidence.metrics)
    .map(([key, value]) => `- ${key}: ${value}`)
    .join('\n');

  return [
    '## Problem',
    proposal.problem,
    '',
    '## What this evidence cannot tell you',
    caveats,
    '',
    '## Evidence',
    metrics,
    '',
    '## Suggested action',
    proposal.suggestedAction,
    '',
    proposal.draft?.summary ? `## Draft measurement\n${proposal.draft.summary}` : '',
    '',
    '---',
    'Opened by the Synora engineering platform against a proposal the founder approved.',
    'It has not been merged, deployed, or applied anywhere. It is waiting for review.',
  ]
    .filter((section) => section !== '')
    .join('\n');
}
