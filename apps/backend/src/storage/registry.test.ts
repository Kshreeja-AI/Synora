import { describe, it, expect } from 'vitest';
import { STORAGE_REGISTRY, getStorageDescriptor } from './registry';

describe('storage provider registry', () => {
  it('lists the local provider', () => {
    expect(STORAGE_REGISTRY.map((p) => p.id)).toEqual(['local']);
  });

  it('resolves a known provider by id', () => {
    expect(getStorageDescriptor('local')?.displayName).toBe('Local filesystem');
  });

  it('returns undefined for an unknown provider id', () => {
    expect(getStorageDescriptor('s3')).toBeUndefined();
  });
});
