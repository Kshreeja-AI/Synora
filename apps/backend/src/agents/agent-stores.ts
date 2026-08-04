import { InMemoryKeyedStore, type KeyedStore } from '../persistence/keyed-store.js';
import type { AgentDefinition, AgentRun } from './types.js';

/**
 * The agent subsystem's store bindings.
 *
 * The generic keyed store this is built on now lives in
 * `persistence/keyed-store.ts`. It started here — extracted when agent
 * definitions and runs became the third and fourth instances of the shape
 * `gate-store.ts` had flagged — and moved out once workflows, schedules,
 * canvases and the two EOS stores adopted it too. A module half the
 * platform depends on should not sit inside one feature's folder.
 *
 * The re-exports below keep every existing import working, so the move was
 * a change of address rather than a change of API.
 */

export {
  type KeyedStore,
  InMemoryKeyedStore,
  FileKeyedStore,
} from '../persistence/keyed-store.js';

let definitionStore: KeyedStore<AgentDefinition> = new InMemoryKeyedStore();
let runStore: KeyedStore<AgentRun> = new InMemoryKeyedStore();

export function setAgentDefinitionStore(next: KeyedStore<AgentDefinition>): void {
  definitionStore = next;
}
export function getAgentDefinitionStore(): KeyedStore<AgentDefinition> {
  return definitionStore;
}
export function setAgentRunStore(next: KeyedStore<AgentRun>): void {
  runStore = next;
}
export function getAgentRunStore(): KeyedStore<AgentRun> {
  return runStore;
}
