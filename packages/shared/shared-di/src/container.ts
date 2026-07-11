import type { Token } from './token.js';

export type Lifecycle = 'singleton' | 'transient' | 'scoped';
export type Factory<T> = (container: Container) => T;

interface Registration<T> {
  factory: Factory<T>;
  lifecycle: Lifecycle;
  instance?: T;
}

/** Thrown when resolve() is called for a token nothing has registered. */
export class UnresolvedTokenError extends Error {
  constructor(description: string) {
    super(`No registration found for token "${description}"`);
    this.name = 'UnresolvedTokenError';
  }
}

/**
 * Minimal DI container — see @synora/di README and docs/architecture/04-dependency-injection.md.
 */
export class Container {
  private readonly registrations = new Map<Token<unknown>, Registration<unknown>>();
  private readonly scopedInstances = new Map<Token<unknown>, unknown>();

  constructor(private readonly parent?: Container) {}

  register<T>(token: Token<T>, factory: Factory<T>, lifecycle: Lifecycle = 'singleton'): void {
    this.registrations.set(token as Token<unknown>, {
      factory: factory as Factory<unknown>,
      lifecycle,
    });
  }

  registerValue<T>(token: Token<T>, value: T): void {
    this.registrations.set(token as Token<unknown>, {
      factory: () => value,
      lifecycle: 'singleton',
      instance: value,
    });
  }

  resolve<T>(token: Token<T>): T {
    const owner = this.findOwner(token);
    if (!owner) {
      throw new UnresolvedTokenError(token.description);
    }
    const registration = owner.registrations.get(token as Token<unknown>) as Registration<T>;

    if (registration.lifecycle === 'transient') {
      return registration.factory(this);
    }

    if (registration.lifecycle === 'scoped') {
      if (this.scopedInstances.has(token as Token<unknown>)) {
        return this.scopedInstances.get(token as Token<unknown>) as T;
      }
      const instance = registration.factory(this);
      this.scopedInstances.set(token as Token<unknown>, instance);
      return instance;
    }

    // singleton — cached on the container that owns the registration, shared by all scopes.
    if (registration.instance === undefined) {
      registration.instance = registration.factory(this);
    }
    return registration.instance;
  }

  has(token: Token<unknown>): boolean {
    return this.findOwner(token) !== undefined;
  }

  /** Creates a child container for scoped lifecycles (e.g. one per request/plugin). */
  createScope(): Container {
    return new Container(this);
  }

  private findOwner(token: Token<unknown>): Container | undefined {
    if (this.registrations.has(token)) return this;
    return this.parent?.findOwner(token);
  }
}
