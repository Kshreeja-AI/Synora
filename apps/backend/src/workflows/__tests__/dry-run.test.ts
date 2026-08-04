/**
 * Dry-run tests.
 *
 * The property under test is honesty: a dry run must report every failure
 * that would actually happen at run time, must never claim a run "would
 * start" when it would not, and must never pretend to know something (like
 * generated text or a remote response) that only a real run can produce.
 * Membership, permission and the tool layer are mocked here because they
 * are exercised elsewhere; what is real is the workflow itself (through
 * the actual registry) and the dry run's own aggregation logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolType } from '@prisma/client';

const assertRunBudget = vi.hoisted(() => vi.fn());
const requireMembership = vi.hoisted(() => vi.fn());
const requirePermission = vi.hoisted(() => vi.fn());
const getTool = vi.hoisted(() => vi.fn());

vi.mock('../../agents/metering.js', () => ({ assertRunBudget }));
vi.mock('../../services/checks.js', () => ({ requireMembership }));
vi.mock('../../services/permissions.js', () => ({ requirePermission }));
vi.mock('../../services/tool.service.js', () => ({ toolService: { getTool } }));

import { dryRunWorkflow } from '../dry-run';
import {
  archiveWorkflow,
  createWorkflow,
  resetWorkflows,
  setWorkflowStore,
} from '../workflow-registry';
import { InMemoryKeyedStore } from '../../agents/agent-stores';
import type { WorkflowDefinition } from '../types';
import type { PlannedStep } from '../../agents/types';

const WS = 'ws_alpha';

const generateStep = (id: string, input = 'do it'): PlannedStep => ({
  id,
  kind: 'generate',
  description: `generate ${id}`,
  input,
});

const toolStep = (id: string, toolId: string, mutating?: boolean): PlannedStep => ({
  id,
  kind: 'tool',
  description: `call ${toolId}`,
  toolId,
  input: 'x',
  ...(mutating === undefined ? {} : { mutating }),
});

function makeWorkflow(overrides: Partial<Parameters<typeof createWorkflow>[0]> = {}): WorkflowDefinition {
  return createWorkflow({
    workspaceId: WS,
    name: 'Nightly report',
    instructions: 'be brief',
    steps: [generateStep('s1')],
    createdBy: 'u1',
    ...overrides,
  });
}

function tool(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tool_1',
    displayName: 'Echo',
    isActive: true,
    type: ToolType.HTTP,
    inputSchema: {},
    requiresApproval: false,
    ...overrides,
  };
}

beforeEach(() => {
  resetWorkflows();
  setWorkflowStore(new InMemoryKeyedStore<WorkflowDefinition>());
  assertRunBudget.mockReset().mockResolvedValue(undefined);
  requireMembership.mockReset().mockResolvedValue({ id: 'mem_1', role: 'OWNER' });
  requirePermission.mockReset();
  getTool.mockReset().mockResolvedValue(tool());
});

describe('dryRunWorkflow', () => {
  it('is honest that nothing executed and reports it would start', async () => {
    const wf = makeWorkflow({ approvalPolicy: 'nothing' });

    const report = await dryRunWorkflow({ workflowId: wf.id, workspaceId: WS, requestedBy: 'u1' });

    expect(report.executed).toBe(false);
    expect(report.wouldStart).toBe(true);
    expect(report.blockers).toEqual([]);
    expect(report.caveats.length).toBeGreaterThan(0);
    expect(report.caveats.join(' ')).toMatch(/no run record exists/);
  });

  it('blocks an archived workflow without pretending to run its steps', async () => {
    const wf = makeWorkflow();
    archiveWorkflow(wf.id, WS);

    const report = await dryRunWorkflow({ workflowId: wf.id, workspaceId: WS, requestedBy: 'u1' });

    expect(report.wouldStart).toBe(false);
    expect(report.blockers.join(' ')).toMatch(/archived/);
  });

  it('flags a step reference that no earlier step produces', async () => {
    const wf = makeWorkflow({
      approvalPolicy: 'nothing',
      steps: [generateStep('s1', 'use {{missing}} here')],
    });

    const report = await dryRunWorkflow({ workflowId: wf.id, workspaceId: WS, requestedBy: 'u1' });

    expect(report.steps[0].unresolvedReferences).toEqual(['missing']);
    expect(report.steps[0].problems.join(' ')).toMatch(/no earlier step produces/);
    expect(report.wouldStart).toBe(false);
    expect(report.blockers.join(' ')).toMatch(/s1/);
  });

  it('does not flag a reference to a step that precedes it', async () => {
    const wf = makeWorkflow({
      approvalPolicy: 'nothing',
      allowedTools: ['echo'],
      steps: [toolStep('s1', 'echo', false), generateStep('s2', 'use {{s1}}')],
    });

    const report = await dryRunWorkflow({ workflowId: wf.id, workspaceId: WS, requestedBy: 'u1' });

    expect(report.steps[1].unresolvedReferences).toEqual([]);
  });

  it('catches an inactive tool before a run would try to call it', async () => {
    getTool.mockResolvedValue(tool({ isActive: false }));
    const wf = makeWorkflow({
      approvalPolicy: 'nothing',
      allowedTools: ['echo'],
      steps: [toolStep('s1', 'echo', false)],
    });

    const report = await dryRunWorkflow({ workflowId: wf.id, workspaceId: WS, requestedBy: 'u1' });

    expect(report.wouldStart).toBe(false);
    expect(report.steps[0].problems.join(' ')).toMatch(/not active/);
  });

  it('catches a tool type the platform cannot execute yet', async () => {
    getTool.mockResolvedValue(tool({ type: ToolType.Python }));
    const wf = makeWorkflow({
      approvalPolicy: 'nothing',
      allowedTools: ['echo'],
      steps: [toolStep('s1', 'echo', false)],
    });

    const report = await dryRunWorkflow({ workflowId: wf.id, workspaceId: WS, requestedBy: 'u1' });

    expect(report.wouldStart).toBe(false);
    expect(report.steps[0].problems.join(' ')).toMatch(/cannot be executed yet/);
  });

  it('treats a tool that requires its own approval as a failure, not a pause', async () => {
    // The tool-runner adapter refuses to wait on a human timescale, so a
    // gated tool ends the run the moment it is reached — the dry run must
    // say the same thing, not describe it as a normal pause.
    getTool.mockResolvedValue(tool({ requiresApproval: true }));
    const wf = makeWorkflow({
      approvalPolicy: 'nothing',
      allowedTools: ['echo'],
      steps: [toolStep('s1', 'echo', false)],
    });

    const report = await dryRunWorkflow({ workflowId: wf.id, workspaceId: WS, requestedBy: 'u1' });

    expect(report.wouldStart).toBe(false);
    expect(report.steps[0].problems.join(' ')).toMatch(/requires its own approval/);
  });

  it('reports a workflow-level approval pause as a projection, not a blocker', async () => {
    const wf = makeWorkflow({
      approvalPolicy: 'mutations',
      allowedTools: ['echo'],
      // Undeclared mutability defaults to mutating — fail closed — which
      // means this step pauses under 'mutations'.
      steps: [toolStep('s1', 'echo')],
    });

    const report = await dryRunWorkflow({ workflowId: wf.id, workspaceId: WS, requestedBy: 'u1' });

    expect(report.steps[0].pausesForApproval).toBe(true);
    expect(report.steps[0].treatedAsMutating).toBe(true);
    expect(report.projected.approvalPauses).toBe(1);
    // A pause is an expected stop for a human, not a reason to say the run
    // would fail.
    expect(report.wouldStart).toBe(true);
    expect(report.blockers).toEqual([]);
  });

  it('surfaces an exhausted budget as a blocker without hiding the rest of the report', async () => {
    assertRunBudget.mockRejectedValue(
      new Error('this workspace has a credits account with no remaining balance'),
    );
    const wf = makeWorkflow({ approvalPolicy: 'nothing' });

    const report = await dryRunWorkflow({ workflowId: wf.id, workspaceId: WS, requestedBy: 'u1' });

    expect(report.wouldStart).toBe(false);
    expect(report.blockers.join(' ')).toMatch(/no remaining balance/);
    // The rest of the report is still produced — a dry run costs nothing,
    // so withholding it here would hide exactly what someone in this
    // position needs to see.
    expect(report.steps).toHaveLength(1);
  });

  it('blocks when the requester lacks tool:execute, naming every tool step as at risk', async () => {
    requirePermission.mockImplementation(() => {
      throw new Error('forbidden');
    });
    const wf = makeWorkflow({
      approvalPolicy: 'nothing',
      allowedTools: ['echo'],
      steps: [toolStep('s1', 'echo', false)],
    });

    const report = await dryRunWorkflow({ workflowId: wf.id, workspaceId: WS, requestedBy: 'u1' });

    expect(report.wouldStart).toBe(false);
    expect(report.blockers.join(' ')).toMatch(/do not have permission/);
  });

  it('skips the permission check entirely for a generate-only workflow', async () => {
    const wf = makeWorkflow({ approvalPolicy: 'nothing', steps: [generateStep('s1')] });

    await dryRunWorkflow({ workflowId: wf.id, workspaceId: WS, requestedBy: 'u1' });

    expect(requireMembership).not.toHaveBeenCalled();
  });

  it('projects tool-call count against the workflow budget as a blocker when it would be exceeded', async () => {
    const wf = makeWorkflow({
      approvalPolicy: 'nothing',
      allowedTools: ['echo'],
      limits: { maxSteps: 5, maxToolCalls: 1, maxDurationMs: 60_000, maxRetriesPerStep: 0 },
      steps: [toolStep('s1', 'echo', false), toolStep('s2', 'echo', false)],
    });

    const report = await dryRunWorkflow({ workflowId: wf.id, workspaceId: WS, requestedBy: 'u1' });

    expect(report.projected.toolCalls).toBe(2);
    expect(report.wouldStart).toBe(false);
    expect(report.blockers.join(' ')).toMatch(/exceed this workflow's budget/);
  });

  it('marks a generate step\'s output as unknowable in advance', async () => {
    const wf = makeWorkflow({ approvalPolicy: 'nothing', steps: [generateStep('s1')] });

    const report = await dryRunWorkflow({ workflowId: wf.id, workspaceId: WS, requestedBy: 'u1' });

    expect(report.steps[0].unknowns.join(' ')).toMatch(/only knowable by running/);
  });

  it('throws the same not-found for a nonexistent or cross-workspace workflow', async () => {
    const wf = makeWorkflow();

    await expect(
      dryRunWorkflow({ workflowId: 'wf_missing', workspaceId: WS, requestedBy: 'u1' }),
    ).rejects.toThrow('workflow not found');
    await expect(
      dryRunWorkflow({ workflowId: wf.id, workspaceId: 'ws_other', requestedBy: 'u1' }),
    ).rejects.toThrow('workflow not found');
  });
});
