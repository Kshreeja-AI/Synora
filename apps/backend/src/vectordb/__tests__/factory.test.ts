import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import {
  createVectorDBService,
  getVectorDBService,
  initVectorDBService,
  resetVectorDBServiceForTests,
} from '../factory';
import { VectorDBService } from '../service';
import { initConfig, __resetConfigForTests } from '../../config';

describe('vectordb factory', () => {
  beforeAll(async () => {
    await initConfig();
  });

  afterAll(() => {
    __resetConfigForTests();
  });

  afterEach(() => {
    resetVectorDBServiceForTests();
  });

  it('createVectorDBService builds a fully-wired VectorDBService from config', () => {
    const service = createVectorDBService();
    expect(service).toBeInstanceOf(VectorDBService);
  });

  it('getVectorDBService returns the same instance on repeated calls (singleton)', () => {
    const first = getVectorDBService();
    const second = getVectorDBService();
    expect(first).toBe(second);
  });

  it('initVectorDBService always builds a fresh instance', () => {
    const first = getVectorDBService();
    const second = initVectorDBService();
    expect(second).not.toBe(first);
  });

  it('resetVectorDBServiceForTests clears the singleton', () => {
    const first = getVectorDBService();
    resetVectorDBServiceForTests();
    const second = getVectorDBService();
    expect(second).not.toBe(first);
  });
});
