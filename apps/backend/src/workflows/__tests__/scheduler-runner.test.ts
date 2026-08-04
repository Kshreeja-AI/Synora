/**
 * Scheduler-to-engine wiring.
 *
 * `schedule.ts` decides WHEN; this decides WHAT HAPPENS, and until now it
 * was the untested seam between them — the code that actually starts real
 * runs. The properties that matter are that one due schedule produces
 * exactly one run, that the run carries the schedule creator's identity
 * rather than ambient authority, and that a broken schedule neither stops
 * its siblings in the same tick nor wedges itself into retrying forever.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const resolveTextGenerationProvider = vi.hoisted(() => vi.fn());
vi.mock('../../ai/resolver.js', () => ({ resolveTextGenerationProvider }));
vi.mock('../../ai/index.js', () => ({ generateText: vi.fn() }));

// The tool runner is bound to a user id; capturing it is how we assert
// whose authority a scheduled run executes with.
const createWorkspaceToolRunner = vi.hoisted(() =>
  vi.fn(() => ({ execute: vi.fn(async () => ({ output: 'ok' })) })),
);
vi.mock('../../agents/tool-runner-adapter.js', () => ({ createWorkspaceToolRunner }));

import { InMemoryKeyedStore, setAgentRunStore } from '../../agents/agent-stores';
import { listRuns, resetRuns } from '../../agents/run-engine';
import { resetAgents } from '../../agents/agent-registry';
import {
  createSchedule,
  getSchedule,
  resetSchedules,
  setScheduleStore,
  type WorkflowSchedule,
} from '../schedule';
import { createWorkflow, resetWorkflows, setWorkflowStore, archiveWorkflow } from '../workflow-registry';
import { fireDueSchedules } from '../scheduler-runner';
import type { AgentRun } from '../../agents/types';
import type { WorkflowDefinition } from '../types';

const WS = 'ws_alpha';
const HOUR = 60 * 60_000;
const T0 = Date.UTC(2026, 7, 4, 0, 0, 0);

function makeWorkflow(name = 'Nightly report') {
  return createWorkflow({
    workspaceId: WS,
    name,
    instructions: 'be brief',
    steps: [{ id: 's1', kind: 'generate', description: 'summarise', input: 'go' }],
    approvalPolicy: 'nothing',
    createdBy: 'u_creator',
  });
}

function schedule(workflowId: string, createdBy = 'u_creator') {
  return createSchedule(
    { workspaceId: WS, workflowId, kind: 'interval', intervalMs: HOUR, createdBy },
    T0,
  );
}

beforeEach(() => {
  resetSchedules();
  resetWorkflows();
  resetAgents();
  resetRuns();
  setScheduleStore(new InMemoryKeyedStore<WorkflowSchedule>());
  setWorkflowStore(new InMemoryKeyedStore<WorkflowDefinition>());
  setAgentRunStore(new InMemoryKeyedStore<AgentRun>());
  createWorkspaceToolRunner.mockClear();
  // No provider configured is the expected local state; the run then uses
  // the deterministic generator, which is enough to exercise the wiring.
  resolveTextGenerationProvider.mockRejectedValue(new Error('nothing configured'));
});

describe('firing due schedules', () => {
  it('starts nothing before a schedule is due', async () => {
    schedule(makeWorkflow().id);
    expect(await fireDueSchedules(T0 + 30 * 60_000)).toBe(0);
    expect(listRuns(WS)).toHaveLength(0);
  });

  it('starts exactly one run for one due schedule', async () => {
    const wf = makeWorkflow();
    schedule(wf.id);

    expect(await fireDueSchedules(T0 + HOUR)).toBe(1);

    const runs = listRuns(WS);
    expect(runs).toHaveLength(1);
    expect(runs[0].state).toBe('completed');
    expect(runs[0].plan!.origin).toBe('authored');
    expect(runs[0].task).toMatch(/Scheduled run/);
  });

  it('starts ONE run after a long outage, not one per missed occurrence', async () => {
    const wf = makeWorkflow();
    const s = schedule(wf.id);

    // 48 hours down on an hourly schedule. Firing the backlog here would
    // mean 48 real runs against real tools in a burst.
    await fireDueSchedules(T0 + 48 * HOUR);

    expect(listRuns(WS)).toHaveLength(1);
    expect(getSchedule(s.id, WS)!.missedOccurrences).toBe(47);
  });

  it('runs as the schedule creator, never with ambient authority', async () => {
    const wf = makeWorkflow();
    schedule(wf.id, 'u_alice');

    await fireDueSchedules(T0 + HOUR);

    // A clock must not confer authority nobody has: the tool runner is
    // bound to the person who created the schedule, so if they lose access
    // to a tool their schedule loses it too.
    expect(createWorkspaceToolRunner).toHaveBeenCalledWith({ requestedBy: 'u_alice' });
    expect(listRuns(WS)[0].requestedBy).toBe('u_alice');
  });

  it('one broken schedule does not stop the others in the same tick', async () => {
    const good = makeWorkflow('Good');
    const broken = makeWorkflow('Broken');
    schedule(good.id);
    schedule(broken.id);
    // Archived after scheduling: startWorkflowRun will throw for this one.
    archiveWorkflow(broken.id, WS);

    const started = await fireDueSchedules(T0 + HOUR);

    expect(started).toBe(1);
    expect(listRuns(WS)).toHaveLength(1);
  });

  it('a failing schedule still advances, so it cannot retry one occurrence forever', async () => {
    const wf = makeWorkflow();
    const s = schedule(wf.id);
    archiveWorkflow(wf.id, WS);

    await fireDueSchedules(T0 + HOUR);

    // Advanced despite the failure. Otherwise a permanently broken
    // workflow would pin the scheduler to the same due time on every tick.
    expect(getSchedule(s.id, WS)!.nextFireAt).toBe(T0 + 2 * HOUR);
    expect(await fireDueSchedules(T0 + HOUR)).toBe(0);
  });

  it('skips a disabled schedule entirely', async () => {
    const wf = makeWorkflow();
    const s = schedule(wf.id);
    getSchedule(s.id, WS)!.enabled = false;

    expect(await fireDueSchedules(T0 + 5 * HOUR)).toBe(0);
    expect(listRuns(WS)).toHaveLength(0);
  });

  it('fires several due schedules in one tick', async () => {
    schedule(makeWorkflow('One').id);
    schedule(makeWorkflow('Two').id);

    expect(await fireDueSchedules(T0 + HOUR)).toBe(2);
    expect(listRuns(WS)).toHaveLength(2);
  });
});
