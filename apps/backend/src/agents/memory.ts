import { memoryRetrievalService } from '../services/memoryRetrieval.service.js';
import { memoryService } from '../services/memory.service.js';
import { logger } from '../utils/logger.js';
import type { AgentGenerate, AgentRun, ExecutableDefinition } from './types.js';

/**
 * Agent memory: what a run may recall, and what it may leave behind.
 *
 * THE HONESTY PROBLEM THIS FILE EXISTS TO SOLVE. A run's output becomes a
 * memory; a later run recalls that memory as context. So anything written
 * here is read back later as though it were knowledge the workspace has.
 * When no AI provider is configured, a run's output comes from the
 * deterministic local planner and generator — scaffolding, not thinking.
 * Writing that back unlabelled would seed the memory store with fabricated
 * experience, and a future run would recall it indistinguishably from
 * something a real model produced. That is the fabricated-embeddings
 * mistake in a new costume, and it is prevented by stamping provenance
 * into the memory content itself, not merely into a metadata field a
 * consumer might not read.
 *
 * FAIL CLOSED ON ACCESS. Memory is workspace data — notes, decisions,
 * possibly sensitive. An agent that silently read all of it would be a
 * privacy problem wearing a feature's clothes. So memory access is opt-in
 * per agent and per direction: an agent that does not declare `recall`
 * reads nothing, and one that does not declare `record` writes nothing.
 * Recall also runs under the REQUESTING USER's identity, so an agent can
 * never surface a memory the person who started it could not read.
 */

export type MemoryAccess = 'none' | 'recall' | 'record' | 'both';

export function canRecall(access: MemoryAccess | undefined): boolean {
  return access === 'recall' || access === 'both';
}
export function canRecord(access: MemoryAccess | undefined): boolean {
  return access === 'record' || access === 'both';
}

/** How many memories a single run may pull in. Bounded, like every budget. */
const RECALL_LIMIT = 5;

/**
 * Fetches memories relevant to the task, as the requesting user.
 *
 * Returns empty rather than throwing when retrieval fails: memory is
 * enrichment, and a run that could have proceeded without context should
 * not fail because the memory store was unavailable. The failure is
 * logged so it is not invisible.
 */
export async function recallForTask(params: {
  task: string;
  workspaceId: string;
  requestedBy: string;
}): Promise<string> {
  try {
    const memories = await memoryRetrievalService.retrieveMemories({
      query: params.task,
      workspaceId: params.workspaceId,
      // Access control is applied against this id, so recall can never
      // exceed what the human who started the run may read.
      userId: params.requestedBy,
      limit: RECALL_LIMIT,
    });
    if (memories.length === 0) return '';

    // RetrievedMemory wraps the record under `.memory` alongside its
    // ranking detail; the content is one level in.
    const lines = memories.map((m, i) => `${i + 1}. ${m.memory.content}`);
    return [
      'Relevant context recalled from this workspace’s memory:',
      ...lines,
      '(Recalled context may be incomplete or out of date. Prefer the task instructions where they conflict.)',
    ].join('\n');
  } catch (err) {
    logger.warn('Agent memory recall failed; the run continues without recalled context.', {
      workspaceId: params.workspaceId,
      error: err instanceof Error ? err.message : String(err),
    });
    return '';
  }
}

/**
 * Wraps a generate function so recalled context precedes the agent's own
 * instructions.
 *
 * Recalled material goes BEFORE the instructions deliberately: the agent's
 * configured behaviour is the thing that should win a conflict, and text
 * later in a system prompt is generally the text that dominates. The
 * recalled block also says so in its own words, so the precedence does not
 * depend on prompt-ordering folklore alone.
 */
export function withRecalledContext(generate: AgentGenerate, context: string): AgentGenerate {
  if (!context) return generate;
  return (request) =>
    generate({
      ...request,
      systemPrompt: request.systemPrompt
        ? `${context}\n\n---\n\n${request.systemPrompt}`
        : context,
    });
}

/**
 * Records what a run did, as a memory the workspace can recall later.
 *
 * WHAT IS AND IS NOT WRITTEN. The task and the result are recorded
 * verbatim. No summary is generated and no "learning" is inferred,
 * because inventing an insight the run did not produce is fabrication —
 * and with no model configured there is nothing that could produce one
 * anyway. The plan's origin is written into the content, so a human or a
 * later run reading this memory can tell whether it came from a model, a
 * deterministic script, or a human-authored workflow.
 *
 * Only successful runs are recorded. A failed run's output is not
 * knowledge, and storing it would let a broken run poison future recall.
 */
export async function recordRunOutcome(params: {
  agent: ExecutableDefinition;
  run: AgentRun;
  requestedBy: string;
}): Promise<boolean> {
  const { agent, run, requestedBy } = params;
  if (run.state !== 'completed' || !run.result) return false;

  const origin = run.plan?.origin ?? 'unknown';
  // Stamped into the CONTENT, not just metadata: a consumer that reads
  // only the text must still learn where this came from.
  const provenance =
    origin === 'model'
      ? 'produced by an AI model'
      : origin === 'authored'
        ? 'produced by a human-authored workflow, executed exactly as written'
        : origin === 'local-deterministic'
          ? 'produced by a deterministic local script, NOT by AI — this is scaffolding output, not knowledge'
          : 'of unrecorded origin';

  try {
    await memoryService.createMemory({
      workspaceId: run.workspaceId,
      userId: requestedBy,
      // EPISODIC: this is a record of something that happened, not a fact
      // about the world. The distinction matters when it is recalled.
      type: 'EPISODIC',
      category: 'agent-run',
      tags: ['agent', agent.name, origin],
      content: [
        `Agent "${agent.name}" (v${agent.version}) was asked: ${run.task}`,
        `Result (${provenance}): ${run.result}`,
      ].join('\n'),
    });
    return true;
  } catch (err) {
    // A run that succeeded must not be reported as failed because writing
    // its memory failed. Logged, not thrown.
    logger.warn('Recording an agent run to memory failed; the run itself succeeded.', {
      runId: run.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
