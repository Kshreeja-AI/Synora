import { FileKeyedStore, setAgentDefinitionStore, setAgentRunStore } from './agent-stores.js';
import { hydrateAgents, hasAgentDefinition } from './agent-registry.js';
import { hydrateRuns } from './run-engine.js';
import {
  createFileWorkflowStore,
  hasWorkflowDefinition,
  hydrateWorkflows,
  setWorkflowStore,
} from '../workflows/workflow-registry.js';
import { createFileScheduleStore, hydrateSchedules, setScheduleStore } from '../workflows/schedule.js';
import { createFileTriggerStore, hydrateTriggers, setTriggerStore } from '../workflows/trigger.js';
import { createFileCanvasStore, hydrateCanvases, setCanvasStore } from '../canvas/canvas-store.js';
import type { AgentDefinition, AgentRun } from './types.js';
import { logger } from '../utils/logger.js';

/**
 * Attaches the durable agent stores and loads what they hold, at boot.
 *
 * WHY THIS MUST BE AWAITED, unlike the judge wiring next to it in
 * `server.ts`. The judge being absent for a few seconds costs an unmeasured
 * gate, which the platform already reports honestly. An unhydrated agent
 * registry is different in kind: a request arriving first would find an
 * empty registry and answer 404 for an agent that genuinely exists, and the
 * caller has no way to tell that apart from deletion. Serving a confident
 * wrong answer is worse than starting a moment later, so boot waits.
 *
 * WHY A FILE STORE RATHER THAN A DATABASE TABLE. Agent definitions and runs
 * are documents with nested plans, step records and append-only logs — they
 * are read whole and written whole, and nothing queries across their
 * internals. A file store matches that access pattern exactly, needs no
 * migration, and keeps the whole subsystem runnable with no external
 * service, which is what the local-first phase requires. The `KeyedStore<T>`
 * seam is the point: moving to Postgres later is one implementation, not a
 * rewrite of the registry or the engine.
 *
 * WHY IT IS OPT-IN VIA PATH. With no path configured the stores stay
 * in-memory, which is correct for tests and for anyone running a throwaway
 * instance. What must never happen is claiming durability that isn't there,
 * so this logs which mode it chose rather than leaving it to be guessed.
 */
export async function bootAgentStores(): Promise<void> {
  const dir = process.env.AGENT_STORE_DIR;
  if (!dir) {
    logger.info(
      'Agent and workflow stores are in-memory: AGENT_STORE_DIR is not set, so agents, workflows and runs will NOT survive a restart.',
    );
    return;
  }

  setAgentDefinitionStore(new FileKeyedStore<AgentDefinition>(`${dir}/agent-definitions.json`));
  setAgentRunStore(new FileKeyedStore<AgentRun>(`${dir}/agent-runs.json`));
  setWorkflowStore(createFileWorkflowStore(`${dir}/workflow-definitions.json`));
  setScheduleStore(createFileScheduleStore(`${dir}/workflow-schedules.json`));
  setTriggerStore(createFileTriggerStore(`${dir}/workflow-triggers.json`));
  setCanvasStore(createFileCanvasStore(`${dir}/canvases.json`));

  try {
    // Definitions before runs, always: a run whose definition has not
    // loaded yet is indistinguishable from one whose definition is gone.
    const definitions = await hydrateAgents();
    const workflows = await hydrateWorkflows();
    // Hydrating schedules records any occurrences that came due while the
    // process was down. They are counted, never replayed — a backlog fired
    // in a burst is how a scheduler turns an outage into an incident.
    const schedules = await hydrateSchedules();
    const triggers = await hydrateTriggers();
    // Canvases keep their good blocks and drop only invalid ones, unlike
    // definitions which are discarded whole — losing one note is better
    // than losing the surface around it.
    const canvasResult = await hydrateCanvases();
    if (canvasResult.droppedBlocks > 0 || canvasResult.droppedConnections > 0) {
      logger.warn('Some canvas blocks or connections were dropped on load.', {
        droppedBlocks: canvasResult.droppedBlocks,
        // A connection whose endpoint did not survive would be a line
        // drawn from nothing to nothing.
        droppedConnections: canvasResult.droppedConnections,
      });
    }
    // The run store holds agent runs and workflow runs alike, so the
    // orphan check must know about both. Passing only the agent check
    // would silently destroy every workflow run on each restart.
    const { loaded, orphaned } = await hydrateRuns(
      (id) => hasAgentDefinition(id) || hasWorkflowDefinition(id),
    );

    // Orphans are surfaced, never swallowed. A run refused because its
    // definition did not restore is a real loss of history, and an operator
    // should learn it from a log line rather than from a user asking where
    // their run went.
    if (orphaned > 0) {
      logger.warn('Some agent runs were not restored: their agent definition is missing.', {
        orphaned,
      });
    }
    logger.info('Agent and workflow stores hydrated.', {
      definitions,
      workflows,
      schedules,
      triggers,
      canvases: canvasResult.loaded,
      runs: loaded,
      orphaned,
    });
  } catch (err) {
    // A corrupt store raises rather than reading empty, and that distinction
    // is the whole point — so it is reported loudly here instead of being
    // turned back into silence. The process continues with whatever loaded,
    // because refusing to boot would take the entire API down over one
    // subsystem's file.
    logger.error('Agent store hydration failed. Agents and runs may be missing this session.', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
