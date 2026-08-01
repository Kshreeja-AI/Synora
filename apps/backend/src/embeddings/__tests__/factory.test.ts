import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import {
  createEmbeddingService,
  getEmbeddingService,
  initEmbeddingService,
  resetEmbeddingServiceForTests,
} from '../factory';
import { EmbeddingService } from '../service';
import { initConfig, __resetConfigForTests } from '../../config';

describe('embeddings factory', () => {
  beforeAll(async () => {
    await initConfig();
  });

  afterAll(() => {
    __resetConfigForTests();
  });

  afterEach(() => {
    resetEmbeddingServiceForTests();
  });

  it('createEmbeddingService builds a fully-wired EmbeddingService from config', () => {
    const service = createEmbeddingService();
    expect(service).toBeInstanceOf(EmbeddingService);
  });

  it('getEmbeddingService returns the same instance on repeated calls (singleton)', () => {
    const first = getEmbeddingService();
    const second = getEmbeddingService();
    expect(first).toBe(second);
  });

  it('initEmbeddingService always builds a fresh instance', () => {
    const first = getEmbeddingService();
    const second = initEmbeddingService();
    expect(second).not.toBe(first);
  });

  it('resetEmbeddingServiceForTests clears the singleton', () => {
    const first = getEmbeddingService();
    resetEmbeddingServiceForTests();
    const second = getEmbeddingService();
    expect(second).not.toBe(first);
  });
});
