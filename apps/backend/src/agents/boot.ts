import { FileKeyedStore, setAgentDefinitionStore, setAgentRunStore } from './agent-stores.js';
import { hydrateAgents } from './agent-registry.js';
import { hydrateRuns } from './run-engine.js';
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
      'Agent stores are in-memory: AGENT_STORE_DIR is not set, so agents and runs will NOT survive a restart.',
    );
    return;
  }

  setAgentDefinitionStore(new FileKeyedStore<AgentDefinition>(`${dir}/agent-definitions.json`));
  setAgentRunStore(new FileKeyedStore<AgentRun>(`${dir}/agent-runs.json`));

  try {
    const definitions = await hydrateAgents();
    const { loaded, orphaned } = await hydrateRuns();

    // Orphans are surfaced, never swallowed. A run refused because its
    // definition did not restore is a real loss of history, and an operator
    // should learn it from a log line rather than from a user asking where
    // their run went.
    if (orphaned > 0) {
      logger.warn('Some agent runs were not restored: their agent definition is missing.', {
        orphaned,
      });
    }
    logger.info('Agent stores hydrated.', { definitions, runs: loaded, orphaned });
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
