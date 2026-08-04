/**
 * Workflow tests.
 *
 * Two properties are under test. First, that a workflow does exactly what
 * was written and nothing else — that is the entire reason someone picks a
 * workflow over an agent. Second, that it inherits the agent engine's
 * safety behaviour rather than a weaker copy of it: forbidden tools,
 * approval gates, budgets and workspace isolation must hold identically,
 * because the day they differ is the day someone routes around a control
 * by choosing the other feature.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryKeyedStore,
  setAgentRunStore,
} from '../../agents/agent-stores';
import {
  approveStep,
  getRun,
  hydrateRuns,
  persistRun,
  rejectStep,
  resetRuns,
  type RunEngineDeps,
} from '../../agents/run-engine';
import { resetAgents } from '../../agents/agent-registry';
import {
  createDeterministicGenerate,
  createDeterministicToolRunner,
} from '../../agents/local-runtime';
import {
  archiveWorkflow,
  createWorkflow,
  getWorkflow,
  getWorkflowHistory,
  hasWorkflowDefinition,
  hydrateWorkflows,
  listWorkflows,
  persistWorkflow,
  resetWorkflows,
  setWorkflowStore,
  updateWorkflow,
} from '../workflow-registry';
import { startWorkflowRun, workflowRunDeps } from '../workflow-engine';
import type { WorkflowDefinition } from '../types';
import type { AgentRun, PlannedStep } from '../../agents/types';

const WS = 'ws_alpha';

const baseDeps: Omit<RunEngineDeps, 'planner'> = {
  toolRunner: createDeterministicToolRunner({
    echo: (i) => `echo:${i}`,
    write: () => 'written',
  }),
  generate: createDeterministicGenerate(),
};

function steps(...s: PlannedStep[]): PlannedStep[] {
  return s;
}

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

function makeWorkflow(overrides: Partial<Parameters<typeof createWorkflow>[0]> = {}) {
  return createWorkflow({
    workspaceId: WS,
    name: 'Nightly report',
    instructions: 'be brief',
    steps: steps(generateStep('s1')),
    createdBy: 'u1',
    ...overrides,
  });
}

beforeEach(() => {
  resetWorkflows();
  resetAgents();
  resetRuns();
  setWorkflowStore(new InMemoryKeyedStore<WorkflowDefinition>());
  setAgentRunStore(new InMemoryKeyedStore<AgentRun>());
});

describe('workflow authoring', () => {
  it('fails closed on tools, exactly as agents do', () => {
    const wf = makeWorkflow();
    expect(wf.allowedTools).toEqual([]);
    expect(wf.approvalPolicy).toBe('mutations');
  });

  it('refuses at SAVE time a workflow that could never run', () => {
    // The point of authoring-time validation. Saving this and discovering
    // it at run time would be building a trap: it looks saved, it looks
    // ready, and it fails the first time it matters.
    expect(() =>
      makeWorkflow({ steps: steps(toolStep('s1', 'forbidden')) }),
    ).toThrow(/not permitted to call/);

    expect(() => makeWorkflow({ steps: [] })).toThrow(/empty plan/);

    expect(() =>
      makeWorkflow({ steps: steps(generateStep('s1'), generateStep('s1')) }),
    ).toThrow(/duplicate id/);
  });

  it('refuses a step that depends on a later step', () => {
    expect(() =>
      makeWorkflow({
        steps: steps({ ...generateStep('s1'), dependsOn: ['s2'] }, generateStep('s2')),
      }),
    ).toThrow();
  });

  it('re-validates on edit, because narrowing tools can invalidate saved steps', () => {
    const wf = makeWorkflow({
      allowedTools: ['echo'],
      steps: steps(toolStep('s1', 'echo', false)),
    });

    // The steps were fine a moment ago. Removing the permission must be
    // refused at save time, not discovered on the next run.
    expect(() => updateWorkflow(wf.id, WS, { allowedTools: [] }, 'u1')).toThrow(
      /not permitted to call/,
    );
  });

  it('editing creates a new version and leaves the old one resolvable', () => {
    const v1 = makeWorkflow();
    const v2 = updateWorkflow(v1.id, WS, { name: 'Weekly report' }, 'u2');

    expect(v2.version).toBe(2);
    expect(v2.previousVersionId).toBe(v1.id);
    expect(getWorkflow(v1.id, WS)!.name).toBe('Nightly report');
    expect(getWorkflowHistory(v1.lineageId, WS).map((w) => w.version)).toEqual([1, 2]);
    // Listing shows the latest of the lineage once, not every version.
    expect(listWorkflows(WS)).toHaveLength(1);
  });

  it('scopes lookups to the workspace', () => {
    const wf = makeWorkflow();
    expect(getWorkflow(wf.id, 'ws_other')).toBeNull();
    expect(listWorkflows('ws_other')).toEqual([]);
  });

  it('archives rather than deletes', () => {
    const wf = makeWorkflow();
    expect(archiveWorkflow(wf.id, WS).archived).toBe(true);
    expect(getWorkflow(wf.id, WS)).not.toBeNull();
    expect(listWorkflows(WS)).toHaveLength(0);
    expect(listWorkflows(WS, { includeArchived: true })).toHaveLength(1);
  });

  it('rejects a zero step budget but accepts zero retries', () => {
    expect(() => makeWorkflow({ limits: { maxSteps: 0 } })).toThrow(/positive number/);
    expect(makeWorkflow({ limits: { maxRetriesPerStep: 0 } }).limits.maxRetriesPerStep).toBe(0);
  });
});

describe('workflow execution', () => {
  it('runs the authored steps and stamps the plan as authored', async () => {
    const wf = makeWorkflow({
      allowedTools: ['echo'],
      approvalPolicy: 'nothing',
      steps: steps(toolStep('s1', 'echo', false), generateStep('s2')),
    });

    const run = await startWorkflowRun(
      { workflowId: wf.id, workspaceId: WS, requestedBy: 'u1', task: 'the monthly one' },
      baseDeps,
    );

    expect(run.state).toBe('completed');
    // Neither 'model' nor 'local-deterministic': a person wrote this, and
    // the record says so.
    expect(run.plan!.origin).toBe('authored');
    expect(run.steps.map((s) => s.step.id)).toEqual(['s1', 's2']);
    expect(run.steps[0].output).toBe('echo:x');
  });

  it('runs the same steps regardless of the task text', async () => {
    const wf = makeWorkflow({
      approvalPolicy: 'nothing',
      steps: steps(generateStep('s1', 'fixed prompt')),
    });

    const a = await startWorkflowRun(
      { workflowId: wf.id, workspaceId: WS, requestedBy: 'u1', task: 'do X' },
      baseDeps,
    );
    const b = await startWorkflowRun(
      { workflowId: wf.id, workspaceId: WS, requestedBy: 'u1', task: 'do something entirely different' },
      baseDeps,
    );

    // This is the property people choose a workflow FOR. The task is
    // recorded as context; it does not change what executes.
    expect(a.steps[0].output).toEqual(b.steps[0].output);
    expect(a.task).toBe('do X');
    expect(b.task).toBe('do something entirely different');
  });

  it('inherits the approval gate, and records who approved', async () => {
    const wf = makeWorkflow({
      allowedTools: ['write'],
      approvalPolicy: 'mutations',
      // Undeclared mutability is treated as mutating — fail closed.
      steps: steps(toolStep('s1', 'write')),
    });

    const parked = await startWorkflowRun(
      { workflowId: wf.id, workspaceId: WS, requestedBy: 'u1', task: 't' },
      baseDeps,
    );
    expect(parked.state).toBe('awaiting_approval');
    expect(parked.pendingApproval!.stepId).toBe('s1');

    const resumed = await approveStep(
      { runId: parked.id, workspaceId: WS, stepId: 's1', approvedBy: 'founder' },
      workflowRunDeps(baseDeps, wf.steps),
    );
    expect(resumed.state).toBe('completed');
    expect(resumed.steps[0].approvedBy).toBe('founder');
  });

  it('a rejected step ends the workflow run rather than skipping it', async () => {
    const wf = makeWorkflow({
      allowedTools: ['write'],
      approvalPolicy: 'mutations',
      steps: steps(toolStep('s1', 'write'), generateStep('s2')),
    });
    const parked = await startWorkflowRun(
      { workflowId: wf.id, workspaceId: WS, requestedBy: 'u1', task: 't' },
      baseDeps,
    );

    const rejected = rejectStep({
      runId: parked.id,
      workspaceId: WS,
      stepId: 's1',
      rejectedBy: 'founder',
    });

    expect(rejected.state).toBe('cancelled');
    // s2 never ran: a refused step is not stepped over.
    expect(rejected.steps[1].state).toBe('pending');
  });

  it('enforces the tool-call budget', async () => {
    const wf = makeWorkflow({
      allowedTools: ['echo'],
      approvalPolicy: 'nothing',
      limits: { maxToolCalls: 1 },
      steps: steps(toolStep('s1', 'echo', false), toolStep('s2', 'echo', false)),
    });

    const run = await startWorkflowRun(
      { workflowId: wf.id, workspaceId: WS, requestedBy: 'u1', task: 't' },
      baseDeps,
    );

    expect(run.state).toBe('failed');
    expect(run.error).toMatch(/tool call budget/);
  });

  it('refuses a run for an archived workflow', async () => {
    const wf = makeWorkflow({ approvalPolicy: 'nothing' });
    archiveWorkflow(wf.id, WS);

    await expect(
      startWorkflowRun(
        { workflowId: wf.id, workspaceId: WS, requestedBy: 'u1', task: 't' },
        baseDeps,
      ),
    ).rejects.toThrow(/archived/);
  });

  it('does not run a workflow from another workspace', async () => {
    const wf = makeWorkflow({ approvalPolicy: 'nothing' });
    await expect(
      startWorkflowRun(
        { workflowId: wf.id, workspaceId: 'ws_other', requestedBy: 'u1', task: 't' },
        baseDeps,
      ),
    ).rejects.toThrow(/not found/);
  });

  it('runs an older version exactly as it was written', async () => {
    const v1 = makeWorkflow({
      approvalPolicy: 'nothing',
      steps: steps(generateStep('s1', 'version one prompt')),
    });
    updateWorkflow(v1.id, WS, { steps: steps(generateStep('s1', 'version two prompt')) }, 'u1');

    const run = await startWorkflowRun(
      { workflowId: v1.id, workspaceId: WS, requestedBy: 'u1', task: 't' },
      baseDeps,
    );

    // Pinning a run to a version is only meaningful if the old version
    // still executes as it did.
    expect(run.steps[0].output).toContain('version one prompt');
    expect(run.agentVersion).toBe(1);
  });
});

describe('workflow durability', () => {
  it('restores definitions and re-validates them on the way in', async () => {
    const wf = makeWorkflow();
    await persistWorkflow(wf.id);

    resetWorkflows();
    expect(getWorkflow(wf.id, WS)).toBeNull();

    expect(await hydrateWorkflows()).toBe(1);
    expect(getWorkflow(wf.id, WS)!.name).toBe('Nightly report');
  });

  it('discards a stored workflow whose steps no longer validate', async () => {
    const store = new InMemoryKeyedStore<WorkflowDefinition>();
    await store.save('wf_bad', {
      id: 'wf_bad',
      lineageId: 'wflin_bad',
      workspaceId: WS,
      name: 'Broken',
      instructions: '',
      // References a tool it is not permitted to call — a definition that
      // an older version might have written before validation existed.
      steps: steps(toolStep('s1', 'forbidden')),
      allowedTools: [],
      approvalPolicy: 'mutations',
      limits: { maxSteps: 20, maxToolCalls: 30, maxDurationMs: 60_000, maxRetriesPerStep: 1 },
      version: 1,
      createdBy: 'u',
      createdAt: Date.now(),
      archived: false,
    });
    setWorkflowStore(store);

    expect(await hydrateWorkflows()).toBe(0);
    expect(getWorkflow('wf_bad', WS)).toBeNull();
  });

  it('does not orphan a workflow run just because it is not an agent', async () => {
    const wf = makeWorkflow({ approvalPolicy: 'nothing' });
    await persistWorkflow(wf.id);
    const run = await startWorkflowRun(
      { workflowId: wf.id, workspaceId: WS, requestedBy: 'u1', task: 't' },
      baseDeps,
    );
    await persistRun(run.id);

    resetWorkflows();
    resetRuns();
    await hydrateWorkflows();

    // The default orphan check only knows agents. A workflow run passed
    // through it would be destroyed on every restart — a guard against
    // corruption becoming a cause of data loss.
    const withAgentCheckOnly = await hydrateRuns();
    expect(withAgentCheckOnly).toEqual({ loaded: 0, orphaned: 1 });

    resetRuns();
    const withBothChecked = await hydrateRuns(hasWorkflowDefinition);
    expect(withBothChecked).toEqual({ loaded: 1, orphaned: 0 });
    expect(getRun(run.id, WS)!.plan!.origin).toBe('authored');
  });

  it('still refuses a run whose workflow genuinely vanished', async () => {
    const wf = makeWorkflow({ approvalPolicy: 'nothing' });
    const run = await startWorkflowRun(
      { workflowId: wf.id, workspaceId: WS, requestedBy: 'u1', task: 't' },
      baseDeps,
    );
    await persistRun(run.id); // run persisted, definition deliberately NOT

    resetWorkflows();
    resetRuns();
    await hydrateWorkflows();

    expect(await hydrateRuns(hasWorkflowDefinition)).toEqual({ loaded: 0, orphaned: 1 });
  });
});
