import { describe, expect, it } from 'vitest';
import { loadConfig, parseApiKeys, resetConfigCache } from './index.js';

describe('loadConfig', () => {
  it('applies defaults for a minimal environment', () => {
    resetConfigCache();
    const config = loadConfig({});
    expect(config.GATEWAY_PORT).toBe(8080);
    expect(config.EVENT_BUS_DRIVER).toBe('in-memory');
  });

  it('rejects an invalid enum value', () => {
    resetConfigCache();
    expect(() => loadConfig({ EVENT_BUS_DRIVER: 'kafka' })).toThrow(/Invalid environment/);
  });
});

describe('parseApiKeys', () => {
  it('parses multiple keys with scopes', () => {
    const keys = parseApiKeys('dev-key:dev-secret:admin|agent:invoke,other:sec2:memory:read');
    expect(keys).toHaveLength(2);
    expect(keys[0]).toEqual({
      keyId: 'dev-key',
      secret: 'dev-secret',
      scopes: ['admin', 'agent:invoke'],
    });
  });

  it('returns an empty array for blank input', () => {
    expect(parseApiKeys('')).toEqual([]);
  });
});
