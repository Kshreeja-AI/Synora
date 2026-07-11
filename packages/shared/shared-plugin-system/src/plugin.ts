import type { AppConfig } from '@synora/config';
import type { Container } from '@synora/di';
import type { EventBus } from '@synora/event-bus';
import type { Logger } from '@synora/logger';
import type { RouteRegistrar } from './route-registrar.js';

export interface PluginContext {
  readonly container: Container;
  readonly eventBus: EventBus;
  readonly logger: Logger;
  readonly config: AppConfig;
  readonly routes: RouteRegistrar;
}

/**
 * A self-contained unit of product functionality composed on top of the platform kernel.
 * See docs/architecture/06-plugin-architecture.md.
 */
export interface Plugin {
  readonly id: string;
  readonly version: string;
  /** Plugin ids that must be registered before this one. */
  readonly dependsOn?: readonly string[];
  register(context: PluginContext): void | Promise<void>;
}
