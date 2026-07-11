import type { Plugin, PluginContext } from './plugin.js';

export class DuplicatePluginError extends Error {
  constructor(id: string) {
    super(`Plugin "${id}" is already registered`);
    this.name = 'DuplicatePluginError';
  }
}

export class MissingPluginDependencyError extends Error {
  constructor(pluginId: string, missingDependencyId: string) {
    super(`Plugin "${pluginId}" depends on unregistered plugin "${missingDependencyId}"`);
    this.name = 'MissingPluginDependencyError';
  }
}

export class PluginDependencyCycleError extends Error {
  constructor(cycle: readonly string[]) {
    super(`Plugin dependency cycle detected: ${cycle.join(' -> ')}`);
    this.name = 'PluginDependencyCycleError';
  }
}

/**
 * Holds registered plugins and resolves the order to activate them in, based on
 * `dependsOn`. See docs/architecture/06-plugin-architecture.md and ADR-0005.
 */
export class PluginRegistry {
  private readonly plugins = new Map<string, Plugin>();

  register(plugin: Plugin): void {
    if (this.plugins.has(plugin.id)) {
      throw new DuplicatePluginError(plugin.id);
    }
    this.plugins.set(plugin.id, plugin);
  }

  /** Registers every plugin's dependencies, in dependency order, then calls `register(context)` on each. */
  async loadAll(context: PluginContext): Promise<void> {
    for (const plugin of this.resolveLoadOrder()) {
      await plugin.register(context);
    }
  }

  private resolveLoadOrder(): Plugin[] {
    const ordered: Plugin[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (plugin: Plugin, path: string[]): void => {
      if (visited.has(plugin.id)) return;
      if (visiting.has(plugin.id)) {
        throw new PluginDependencyCycleError([...path, plugin.id]);
      }

      visiting.add(plugin.id);
      for (const dependencyId of plugin.dependsOn ?? []) {
        const dependency = this.plugins.get(dependencyId);
        if (!dependency) {
          throw new MissingPluginDependencyError(plugin.id, dependencyId);
        }
        visit(dependency, [...path, plugin.id]);
      }
      visiting.delete(plugin.id);

      visited.add(plugin.id);
      ordered.push(plugin);
    };

    for (const plugin of this.plugins.values()) {
      visit(plugin, []);
    }

    return ordered;
  }
}
