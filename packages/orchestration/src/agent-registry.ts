import type { AgentDefinition, AgentId } from '@synora/core';

/** Simple in-process registry mapping AgentId -> AgentDefinition, used by the Orchestrator to resolve agent steps and handoff targets. */
export class AgentDefinitionRegistry {
  private readonly definitions = new Map<string, AgentDefinition>();

  register(definition: AgentDefinition): void {
    this.definitions.set(definition.id, definition);
  }

  get(agentId: AgentId): AgentDefinition {
    const definition = this.definitions.get(agentId);
    if (!definition) throw new Error(`Unknown agent "${agentId}"`);
    return definition;
  }

  list(): AgentDefinition[] {
    return Array.from(this.definitions.values());
  }
}
