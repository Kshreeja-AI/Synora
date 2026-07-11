import { describe, expect, it } from 'vitest';
import { createLogger } from './logger.js';
import { getCorrelationId, runWithCorrelationId } from './correlation.js';

describe('createLogger', () => {
  it('exposes level methods and supports child scoping', () => {
    const logger = createLogger({ level: 'silent', name: 'test' });
    expect(typeof logger.info).toBe('function');
    const child = logger.child({ plugin: 'example-task' });
    expect(typeof child.info).toBe('function');
    // silent level, so this must not throw
    child.info('hello', { foo: 'bar' });
  });
});

describe('correlation id', () => {
  it('is scoped to the callback and unset outside of it', () => {
    expect(getCorrelationId()).toBeUndefined();
    const result = runWithCorrelationId('req-123', () => getCorrelationId());
    expect(result).toBe('req-123');
    expect(getCorrelationId()).toBeUndefined();
  });

  it('is visible to nested async calls', async () => {
    const seen = await runWithCorrelationId('req-456', async () => {
      await Promise.resolve();
      return getCorrelationId();
    });
    expect(seen).toBe('req-456');
  });
});
