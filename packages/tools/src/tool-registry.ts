import type { ToolDefinition, ToolHandler } from '@synora/core';

/**
 * Name-keyed registry of tool handlers. Agents declare which tool
 * names they're allowed to use (AgentDefinition.tools); the
 * orchestration layer resolves those names against a registry built
 * per-product, so two products can register a tool with the same name
 * but different behavior without colliding.
 */
export class ToolRegistry {
  private readonly handlers = new Map<string, ToolHandler>();

  register(handler: ToolHandler): void {
    if (this.handlers.has(handler.definition.name)) {
      throw new Error(`Tool "${handler.definition.name}" is already registered`);
    }
    this.handlers.set(handler.definition.name, handler);
  }

  get(name: string): ToolHandler | undefined {
    return this.handlers.get(name);
  }

  require(name: string): ToolHandler {
    const handler = this.get(name);
    if (!handler) throw new Error(`Unknown tool "${name}"`);
    return handler;
  }

  list(): ToolHandler[] {
    return Array.from(this.handlers.values());
  }

  definitions(names?: string[]): ToolDefinition[] {
    const handlers = names ? names.map((n) => this.require(n)) : this.list();
    return handlers.map((h) => h.definition);
  }
}
