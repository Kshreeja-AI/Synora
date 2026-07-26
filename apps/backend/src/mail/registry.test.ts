import { describe, it, expect } from 'vitest';
import { TRANSPORT_REGISTRY, getTransportDescriptor } from './registry';

describe('mail transport registry', () => {
  it('lists console and smtp transports', () => {
    expect(TRANSPORT_REGISTRY.map((t) => t.id)).toEqual(['console', 'smtp']);
  });

  it('resolves a known transport by id', () => {
    expect(getTransportDescriptor('console')?.displayName).toBe('Console (development)');
  });

  it('returns undefined for an unknown transport id', () => {
    expect(getTransportDescriptor('carrier-pigeon')).toBeUndefined();
  });
});
