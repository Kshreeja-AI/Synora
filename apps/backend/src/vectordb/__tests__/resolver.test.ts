import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolveVectorDBProvider } from '../resolver';
import { initConfig, __resetConfigForTests } from '../../config';

describe('resolveVectorDBProvider', () => {
  const previousPineconeKey = process.env.PINECONE_API_KEY;
  const previousPineconeHost = process.env.VECTORDB_PINECONE_HOST;

  beforeAll(async () => {
    // No network call is made by resolution itself — descriptor.create()
    // only constructs the provider instance. Fake values are enough to
    // exercise real auto-detection with no network I/O.
    process.env.PINECONE_API_KEY = 'test-key-not-real';
    process.env.VECTORDB_PINECONE_HOST = 'test-index.svc.test.pinecone.io';
    await initConfig();
  });

  afterAll(() => {
    process.env.PINECONE_API_KEY = previousPineconeKey;
    process.env.VECTORDB_PINECONE_HOST = previousPineconeHost;
    __resetConfigForTests();
  });

  it('auto-detects the first configured provider (Pinecone, given its key + host are set)', async () => {
    const provider = await resolveVectorDBProvider();
    expect(provider.id).toBe('pinecone');
  });

  it('honors an explicit provider id, taking priority over auto-detection', async () => {
    process.env.VECTORDB_QDRANT_URL = 'http://localhost:6333';
    await initConfig();
    try {
      const provider = await resolveVectorDBProvider({ explicitProviderId: 'qdrant' });
      expect(provider.id).toBe('qdrant');
    } finally {
      delete process.env.VECTORDB_QDRANT_URL;
      await initConfig();
    }
  });

  it('throws a clear, source-labeled error for an unknown explicit provider id', async () => {
    await expect(resolveVectorDBProvider({ explicitProviderId: 'not-a-real-provider' })).rejects.toThrow(
      /which is not a known vector DB provider/i
    );
  });

  it('throws a clear error when the explicit provider is not configured', async () => {
    // qdrant's isConfigured() checks only a plain config field
    // (VECTORDB_QDRANT_URL), with no secrets-placeholder fallback — it is
    // genuinely unconfigured whenever that env var isn't set.
    await expect(resolveVectorDBProvider({ explicitProviderId: 'qdrant' })).rejects.toThrow(/is not configured/);
  });

  it('throws NoVectorDBProviderConfiguredError listing every provider checked when nothing is configured', async () => {
    delete process.env.PINECONE_API_KEY;
    delete process.env.VECTORDB_PINECONE_HOST;
    await initConfig();
    try {
      await expect(resolveVectorDBProvider()).rejects.toThrow(/No vector database provider is configured/);
    } finally {
      process.env.PINECONE_API_KEY = 'test-key-not-real';
      process.env.VECTORDB_PINECONE_HOST = 'test-index.svc.test.pinecone.io';
      await initConfig();
    }
  });
});
