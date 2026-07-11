import { describe, expect, it } from 'vitest';
import { loadConfig } from './load-config.js';

describe('loadConfig', () => {
  it('applies defaults matching .env.example when env vars are absent', () => {
    const config = loadConfig({ env: {}, loadDotenvFile: false });
    expect(config.app.name).toBe('Synora');
    expect(config.providers.database).toBe('postgres');
    expect(config.providers.vectorDatabase).toBe('qdrant');
    expect(config.features.multiAgent).toBe(false);
  });

  it('coerces ENABLE_* string flags to booleans', () => {
    const config = loadConfig({
      env: { ENABLE_MULTI_AGENT: 'true', ENABLE_ANALYTICS: 'false' },
      loadDotenvFile: false,
    });
    expect(config.features.multiAgent).toBe(true);
    expect(config.features.analytics).toBe(false);
  });

  it('reads provider overrides from env', () => {
    const config = loadConfig({
      env: { DEFAULT_LLM_PROVIDER: 'anthropic' },
      loadDotenvFile: false,
    });
    expect(config.providers.llm).toBe('anthropic');
  });
});
