/**
 * Agent persistence tests.
 *
 * The property under test is what survives a restart and — more
 * importantly — what must NOT. Restoring a run whose agent definition is
 * gone would look like recovery and behave like corruption: the run could
 * not be resumed, explained, or (if parked) approved, because approveStep
 * resolves the agent before continuing. That is the benchmark-registry
 * deadlock generalised, and it is guarded here rather than rediscovered.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FileKeyedStore,
  InMemoryKeyedStore,
  setAgentDefinitionStore,
  setAgentRunStore,
} from '../agent-stores';
import {
  createAgent,
  getAgent,
  hydrateAgents,
  persistAgent,
  resetAgents,
  updateAgent,
} from '../agent-registry';
import {
  approveStep,
  getRun,
  hydrateRuns,
  persistRun,
  resetRuns,
  startRun,
  type RunEngineDeps,
} from '../run-engine';
import {
  createDeterministicGenerate,
  createDeterministicPlanner,
  createDeterministicToolRunner,
} from '../local-runtime';
import type { AgentDefinition, AgentRun } from '../types';

const WS = 'ws_alpha';

const deps: RunEngineDeps = {
  planner: createDeterministicPlanner(),
  toolRunner: createDeterministicToolRunner({ echo: (i) => `echo:${i}` }),
  generate: createDeterministicGenerate(),
};

async function tempFile(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'synora-agents-'));
  return join(dir, name);
}

describe('agent persistence', () => {
  beforeEach(() => {
    resetAgents();
    resetRuns();
    setAgentDefinitionStore(new InMemoryKeyedStore<AgentDefinition>());
    setAgentRunStore(new InMemoryKeyedStore<AgentRun>());
  });

  it('restores a definition after a restart', async () => {
    const agent = createAgent({
      workspaceId: WS,
      name: 'Researcher',
      instructions: 'be brief',
      allowedTools: ['echo'],
      createdBy: 'u',
    });
    await persistAgent(agent.id);

    resetAgents(); // the restart
    expect(getAgent(agent.id, WS)).toBeNull();

    expect(await hydrateAgents()).toBe(1);
    const restored = getAgent(agent.id, WS)!;
    expect(restored.name).toBe('Researcher');
    expect(restored.allowedTools).toEqual(['echo']);
    expect(restored.approvalPolicy).toBe('mutations');
  });

  it('restores every version in a lineage, so run references stay resolvable', async () => {
    const v1 = createAgent({ workspaceId: WS, name: 'A', instructions: 'x', createdBy: 'u' });
    const v2 = updateAgent(v1.id, WS, { instructions: 'y' }, 'u');
    await persistAgent(v1.id);
    await persistAgent(v2.id);

    resetAgents();
    await hydrateAgents();

    // A run recorded against v1 must still resolve v1 as it was.
    expect(getAgent(v1.id, WS)!.instructions).toBe('x');
    expect(getAgent(v2.id, WS)!.instructions).toBe('y');
  });

  it('re-validates on the way in rather than trusting the file', async () => {
    const path = await tempFile('defs.json');
    await writeFile(
      path,
      JSON.stringify({
        good: {
          id: 'agent_ok',
          lineageId: 'lin_1',
          workspaceId: WS,
          name: 'Fine',
          instructions: 'ok',
          allowedTools: [],
          approvalPolicy: 'mutations',
          limits: { maxSteps: 5, maxToolCalls: 5, maxDurationMs: 1000, maxRetriesPerStep: 0 },
          version: 1,
          createdBy: 'u',
          createdAt: Date.now(),
          archived: false,
        },
        // Written by some earlier version, or corrupted: no instructions.
        bad: { id: 'agent_bad', lineageId: 'lin_2', workspaceId: WS, name: 'X', instructions: '  ' },
      }),
      'utf8',
    );
    setAgentDefinitionStore(new FileKeyedStore<AgentDefinition>(path));

    expect(await hydrateAgents()).toBe(1);
    expect(getAgent('agent_ok', WS)).not.toBeNull();
    // Discarded, not repaired: guessing would hand an executor a
    // configuration nobody wrote.
    expect(getAgent('agent_bad', WS)).toBeNull();
  });

  it('a corrupt file raises rather than reading as empty', async () => {
    const path = await tempFile('defs.json');
    await writeFile(path, 'not json at all', 'utf8');
    setAgentDefinitionStore(new FileKeyedStore<AgentDefinition>(path));

    // Silently discarding every definition while looking normal is the
    // worst thing a store can do.
    await expect(hydrateAgents()).rejects.toThrow();
  });

  it('a missing file is an empty store, not an error', async () => {
    setAgentDefinitionStore(new FileKeyedStore<AgentDefinition>(await tempFile('absent.json')));
    expect(await hydrateAgents()).toBe(0);
  });

  it('writes through to a real file that survives a new store instance', async () => {
    const path = await tempFile('defs.json');
    setAgentDefinitionStore(new FileKeyedStore<AgentDefinition>(path));

    const agent = createAgent({ workspaceId: WS, name: 'Persisted', instructions: 'x', createdBy: 'u' });
    await persistAgent(agent.id);

    expect(JSON.parse(await readFile(path, 'utf8'))[agent.id].name).toBe('Persisted');

    resetAgents();
    setAgentDefinitionStore(new FileKeyedStore<AgentDefinition>(path));
    await hydrateAgents();
    expect(getAgent(agent.id, WS)!.name).toBe('Persisted');
  });
});

describe('run persistence and the orphan guard', () => {
  beforeEach(() => {
    resetAgents();
    resetRuns();
    setAgentDefinitionStore(new InMemoryKeyedStore<AgentDefinition>());
    setAgentRunStore(new InMemoryKeyedStore<AgentRun>());
  });

  it('restores a completed run with its full history', async () => {
    const agent = createAgent({
      workspaceId: WS,
      name: 'A',
      instructions: 'x',
      allowedTools: ['echo'],
      approvalPolicy: 'nothing',
      createdBy: 'u',
    });
    await persistAgent(agent.id);
    const run = await startRun(
      { agentId: agent.id, workspaceId: WS, requestedBy: 'u', task: 'tool!:echo hi' },
      deps,
    );
    await persistRun(run.id);

    resetAgents();
    resetRuns();
    await hydrateAgents();

    const result = await hydrateRuns();
    expect(result).toEqual({ loaded: 1, orphaned: 0 });
    const restored = getRun(run.id, WS)!;
    expect(restored.state).toBe('completed');
    expect(restored.steps[0].output).toBe('echo:hi');
    expect(restored.log.length).toBeGreaterThan(0);
  });

  it('refuses a run whose agent definition was not restored', async () => {
    const agent = createAgent({
      workspaceId: WS,
      name: 'A',
      instructions: 'x',
      approvalPolicy: 'nothing',
      createdBy: 'u',
    });
    const run = await startRun(
      { agentId: agent.id, workspaceId: WS, requestedBy: 'u', task: 'generate hi' },
      deps,
    );
    await persistRun(run.id); // run persisted, definition deliberately NOT

    resetAgents();
    resetRuns();
    await hydrateAgents();

    const result = await hydrateRuns();

    // Counted, not silently dropped: the loss is visible.
    expect(result).toEqual({ loaded: 0, orphaned: 1 });
    expect(getRun(run.id, WS)).toBeNull();
  });

  it('a run interrupted mid-flight is restored as failed, never as still running', async () => {
    const agent = createAgent({
      workspaceId: WS,
      name: 'A',
      instructions: 'x',
      approvalPolicy: 'nothing',
      createdBy: 'u',
    });
    await persistAgent(agent.id);

    // A record the way a crash would leave it.
    const store = new InMemoryKeyedStore<AgentRun>();
    await store.save('run_x', {
      id: 'run_x',
      agentId: agent.id,
      agentVersion: 1,
      lineageId: agent.lineageId,
      workspaceId: WS,
      requestedBy: 'u',
      task: 't',
      state: 'running',
      steps: [],
      toolCallsUsed: 0,
      log: [],
      createdAt: Date.now(),
    });
    setAgentRunStore(store);

    await hydrateRuns();

    const restored = getRun('run_x', WS)!;
    // The process that owned its loop is gone; nothing may pretend
    // otherwise, and history is preserved rather than deleted.
    expect(restored.state).toBe('failed');
    expect(restored.error).toMatch(/interrupted by a restart/);
    expect(restored.finishedAt).toBeGreaterThan(0);
  });

  it('a parked run survives a restart and can still be approved', async () => {
    const agent = createAgent({
      workspaceId: WS,
      name: 'A',
      instructions: 'x',
      allowedTools: ['echo'],
      approvalPolicy: 'everything',
      createdBy: 'u',
    });
    await persistAgent(agent.id);
    const parked = await startRun(
      { agentId: agent.id, workspaceId: WS, requestedBy: 'u', task: 'tool!:echo later' },
      deps,
    );
    expect(parked.state).toBe('awaiting_approval');
    await persistRun(parked.id);

    resetAgents();
    resetRuns();
    await hydrateAgents();
    await hydrateRuns();

    // awaiting_approval is deliberately NOT rewritten to failed: nothing
    // is executing, so nothing was interrupted — the human is still the
    // thing being waited on, and that survives a restart.
    const restored = getRun(parked.id, WS)!;
    expect(restored.state).toBe('awaiting_approval');

    const resumed = await approveStep(
      { runId: parked.id, workspaceId: WS, stepId: 's1', approvedBy: 'founder' },
      deps,
    );
    expect(resumed.state).toBe('completed');
    expect(resumed.steps[0].approvedBy).toBe('founder');
  });

  it('restored runs keep workspace scoping', async () => {
    const agent = createAgent({
      workspaceId: WS,
      name: 'A',
      instructions: 'x',
      approvalPolicy: 'nothing',
      createdBy: 'u',
    });
    await persistAgent(agent.id);
    const run = await startRun(
      { agentId: agent.id, workspaceId: WS, requestedBy: 'u', task: 'generate hi' },
      deps,
    );
    await persistRun(run.id);

    resetAgents();
    resetRuns();
    await hydrateAgents();
    await hydrateRuns();

    expect(getRun(run.id, 'ws_other')).toBeNull();
  });
});
