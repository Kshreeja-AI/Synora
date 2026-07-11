import { describe, expect, it } from 'vitest';
import { Container, UnresolvedTokenError } from './container.js';
import { createToken } from './token.js';

describe('Container', () => {
  it('resolves singleton registrations to the same instance', () => {
    const token = createToken<{ id: number }>('widget');
    const container = new Container();
    container.register(token, () => ({ id: Math.random() }), 'singleton');

    expect(container.resolve(token)).toBe(container.resolve(token));
  });

  it('resolves transient registrations to a new instance every time', () => {
    const token = createToken<{ id: number }>('widget');
    const container = new Container();
    let counter = 0;
    container.register(token, () => ({ id: counter++ }), 'transient');

    expect(container.resolve(token)).not.toBe(container.resolve(token));
  });

  it('resolves scoped registrations once per scope', () => {
    const token = createToken<{ id: number }>('request-context');
    const root = new Container();
    let counter = 0;
    root.register(token, () => ({ id: counter++ }), 'scoped');

    const scopeA = root.createScope();
    const scopeB = root.createScope();

    expect(scopeA.resolve(token)).toBe(scopeA.resolve(token));
    expect(scopeA.resolve(token)).not.toBe(scopeB.resolve(token));
  });

  it('registerValue always returns the same reference', () => {
    const token = createToken<string>('app-name');
    const container = new Container();
    container.registerValue(token, 'Synora');
    expect(container.resolve(token)).toBe('Synora');
  });

  it('child scopes fall back to parent registrations', () => {
    const token = createToken<string>('shared');
    const root = new Container();
    root.registerValue(token, 'from-root');
    const scope = root.createScope();
    expect(scope.resolve(token)).toBe('from-root');
  });

  it('throws UnresolvedTokenError for unknown tokens', () => {
    const token = createToken<string>('missing');
    const container = new Container();
    expect(() => container.resolve(token)).toThrow(UnresolvedTokenError);
  });

  it('has() reflects registration presence including inherited ones', () => {
    const token = createToken<string>('feature-flag');
    const root = new Container();
    root.registerValue(token, 'on');
    const scope = root.createScope();
    expect(scope.has(token)).toBe(true);
    expect(root.has(createToken('unregistered'))).toBe(false);
  });
});
