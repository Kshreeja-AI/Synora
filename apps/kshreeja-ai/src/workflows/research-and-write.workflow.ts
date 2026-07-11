import type { WorkflowDefinition } from '@synora/core';
import { AgentIds } from '../agents/agent-ids.js';

/**
 * A deterministic alternative to letting the coordinator decide: run
 * research then writing every time, useful for batch/API callers that
 * don't want conversational routing. Same agents the coordinator would
 * hand off to, composed declaratively instead.
 */
export const researchAndWriteWorkflow: WorkflowDefinition = {
  id: 'kshreeja.research-and-write',
  name: 'Research then write',
  description: 'Runs the researcher agent, then feeds its notes to the writer agent.',
  entry: {
    kind: 'sequence',
    id: 'root',
    steps: [
      { kind: 'agent', id: 'research', agentId: AgentIds.Researcher },
      { kind: 'agent', id: 'write', agentId: AgentIds.Writer },
    ],
  },
};
