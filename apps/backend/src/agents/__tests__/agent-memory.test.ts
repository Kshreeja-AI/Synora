/**
 * Agent memory tests.
 *
 * The property under test is that memory cannot become a laundering
 * channel for fabricated knowledge. A run's output is written to memory;
 * a later run recalls it as context. So if a deterministic run's output
 * were written unlabelled, a future run would recall scaffolding output
 * indistinguishably from something a model produced — the fabricated
 * embeddings mistake in a new costume. The provenance stamp is asserted on
 * the memory CONTENT, not on a metadata field a consumer might not read.
 *
 * The other property is fail-closed access: memory is workspace data, and
 * an agent reads or writes none of it unless it says so.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const retrieveMemories = vi.hoisted(() => vi.fn());
const createMemory = vi.hoisted(() => vi.fn());
vi.mock('../../services/memoryRetrieval.service.js', () => ({
  memoryRetrievalService: { retrieveMemories },
}));
vi.mock('../../services/memory.service.js', () => ({
  memoryService: { createMemory },
}));

import {
  canRecall,
  canRecord,
  recallForTask,
  recordRunOutcome,
  withRecalledContext,
} from '../memory';
import type { AgentRun, ExecutableDefinition } from '../types';

const agent: ExecutableDefinition = {
  id: 'agent_1',
  workspaceId: 'ws_1',
  name: 'Researcher',
  instructions: 'be brief',
  allowedTools: [],
  approvalPolicy: 'mutations',
  limits: { maxSteps: 20, maxToolCalls: 30, maxDurationMs: 60_000, maxRetriesPerStep: 1 },
  version: 3,
  lineageId: 'lin_1',
  archived: false,
};

/**
 * Mirrors the REAL `RetrievedMemory` shape, which wraps the record under
 * `.memory`. Written out rather than guessed: an earlier version of this
 * file mocked a flat `{ content }`, the tests passed, and the production
 * code was reading a property that does not exist. A mock shaped by
 * assumption tests the assumption, not the code.
 */
function recalled(content: string) {
  return {
    memory: { content },
    relevanceScore: 1,
    rankingDetails: {
      semanticScore: 0,
      lexicalScore: 1,
      importanceScore: 0,
      recencyScore: 0,
      accessScore: 0,
      overallScore: 1,
      semanticSearchUsed: false,
    },
  };
}

function makeRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'run_1',
    agentId: agent.id,
    agentVersion: agent.version,
    lineageId: agent.lineageId,
    workspaceId: 'ws_1',
    requestedBy: 'u1',
    task: 'summarise the quarter',
    state: 'completed',
    plan: { steps: [], origin: 'model' },
    steps: [],
    toolCallsUsed: 0,
    result: 'Revenue grew.',
    log: [],
    createdAt: Date.now(),
    ...overrides,
  };
}

beforeEach(() => {
  retrieveMemories.mockReset();
  createMemory.mockReset();
  retrieveMemories.mockResolvedValue([]);
  createMemory.mockResolvedValue({ id: 'mem_1' });
});

describe('memory access is fail closed', () => {
  it('grants nothing when unspecified', () => {
    expect(canRecall(undefined)).toBe(false);
    expect(canRecord(undefined)).toBe(false);
    expect(canRecall('none')).toBe(false);
    expect(canRecord('none')).toBe(false);
  });

  it('grants each direction only when declared', () => {
    expect(canRecall('recall')).toBe(true);
    expect(canRecord('recall')).toBe(false);
    expect(canRecord('record')).toBe(true);
    expect(canRecall('record')).toBe(false);
    expect(canRecall('both')).toBe(true);
    expect(canRecord('both')).toBe(true);
  });
});

describe('recall', () => {
  it('retrieves as the requesting user, never with ambient authority', async () => {
    retrieveMemories.mockResolvedValue([recalled('Q3 revenue was flat.')]);

    await recallForTask({ task: 'summarise', workspaceId: 'ws_1', requestedBy: 'u_alice' });

    // Access control is applied against this id, so an agent can never
    // surface a memory the person who started it could not read.
    expect(retrieveMemories).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws_1', userId: 'u_alice' }),
    );
  });

  it('returns empty when there is nothing to recall', async () => {
    expect(await recallForTask({ task: 't', workspaceId: 'ws_1', requestedBy: 'u1' })).toBe('');
  });

  it('warns that recalled context may be stale rather than presenting it as fact', async () => {
    retrieveMemories.mockResolvedValue([recalled('Q3 revenue was flat.')]);

    const context = await recallForTask({
      task: 't',
      workspaceId: 'ws_1',
      requestedBy: 'u1',
    });

    expect(context).toContain('Q3 revenue was flat.');
    expect(context).toMatch(/may be incomplete or out of date/);
  });

  it('does not fail the run when the memory store is unavailable', async () => {
    retrieveMemories.mockRejectedValue(new Error('store down'));

    // Memory is enrichment. A run that could have proceeded without
    // context must not fail because retrieval broke.
    await expect(
      recallForTask({ task: 't', workspaceId: 'ws_1', requestedBy: 'u1' }),
    ).resolves.toBe('');
  });

  it('places recalled context before the instructions, which win a conflict', async () => {
    const generate = vi.fn(async () => ({ text: 'ok' }));
    const wrapped = withRecalledContext(generate, 'RECALLED');

    await wrapped({ prompt: 'p', systemPrompt: 'INSTRUCTIONS' });

    const passed = (generate.mock.calls[0] as unknown as [{ systemPrompt?: string }])[0]
      .systemPrompt!;
    expect(passed.indexOf('RECALLED')).toBeLessThan(passed.indexOf('INSTRUCTIONS'));
  });

  it('is a no-op wrapper when there is no context', async () => {
    const generate = vi.fn(async () => ({ text: 'ok' }));
    expect(withRecalledContext(generate, '')).toBe(generate);
  });
});

describe('recording a run to memory', () => {
  it('labels a deterministic run as NOT AI, in the content itself', async () => {
    await recordRunOutcome({
      agent,
      run: makeRun({ plan: { steps: [], origin: 'local-deterministic' } }),
      requestedBy: 'u1',
    });

    const written = createMemory.mock.calls[0][0].content as string;
    // The stamp is in the text, not only in a tag, because a consumer that
    // reads only the content must still learn where this came from.
    expect(written).toMatch(/NOT by AI/);
    expect(written).toMatch(/scaffolding output, not knowledge/);
  });

  it('labels a model run as model-produced', async () => {
    await recordRunOutcome({ agent, run: makeRun(), requestedBy: 'u1' });

    expect(createMemory.mock.calls[0][0].content).toMatch(/produced by an AI model/);
  });

  it('labels an authored workflow run as executed exactly as written', async () => {
    await recordRunOutcome({
      agent,
      run: makeRun({ plan: { steps: [], origin: 'authored' } }),
      requestedBy: 'u1',
    });

    expect(createMemory.mock.calls[0][0].content).toMatch(/human-authored workflow/);
  });

  it('records the task and result verbatim without inventing a summary', async () => {
    await recordRunOutcome({ agent, run: makeRun(), requestedBy: 'u1' });

    const written = createMemory.mock.calls[0][0].content as string;
    expect(written).toContain('summarise the quarter');
    expect(written).toContain('Revenue grew.');
  });

  it('files the memory as an event, not as a fact about the world', async () => {
    await recordRunOutcome({ agent, run: makeRun(), requestedBy: 'u1' });

    // EPISODIC: this is a record of something that happened. Filing it as
    // SEMANTIC would assert the result is true.
    expect(createMemory.mock.calls[0][0].type).toBe('EPISODIC');
    expect(createMemory.mock.calls[0][0].tags).toContain('model');
  });

  it('records nothing for a failed run', async () => {
    const recorded = await recordRunOutcome({
      agent,
      run: makeRun({ state: 'failed', result: undefined, error: 'boom' }),
      requestedBy: 'u1',
    });

    // A failed run's output is not knowledge, and storing it would let a
    // broken run poison future recall.
    expect(recorded).toBe(false);
    expect(createMemory).not.toHaveBeenCalled();
  });

  it('records nothing for a cancelled run', async () => {
    const recorded = await recordRunOutcome({
      agent,
      run: makeRun({ state: 'cancelled', result: undefined }),
      requestedBy: 'u1',
    });
    expect(recorded).toBe(false);
    expect(createMemory).not.toHaveBeenCalled();
  });

  it('does not report a successful run as failed when writing memory fails', async () => {
    createMemory.mockRejectedValue(new Error('store down'));

    await expect(
      recordRunOutcome({ agent, run: makeRun(), requestedBy: 'u1' }),
    ).resolves.toBe(false);
  });
});
