import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRegister, mockQueryRaw, mockPing } = vi.hoisted(() => ({
  mockRegister: vi.fn(),
  mockQueryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
  mockPing: vi.fn().mockResolvedValue(true),
}));

vi.mock('../health-collector', () => ({
  registerHealthProbe: mockRegister,
}));

vi.mock('@synora/database', () => ({
  prisma: { $queryRaw: mockQueryRaw },
}));

vi.mock('../../queue/redis', () => ({
  getRedis: () => ({ ping: mockPing }),
}));

describe('dependency-probes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryRaw.mockResolvedValue([{ '?column?': 1 }]);
    mockPing.mockResolvedValue(true);
    vi.resetModules();
  });

  async function loadAndRegister() {
    const mod = await import('../dependency-probes');
    mod.registerDependencyProbes();
    return mockRegister.mock.calls;
  }

  function findProbe(calls: any[][], name: string) {
    return calls.find(([p]: any) => p.name === name)![0];
  }

  it('registers postgres and redis probes', async () => {
    const calls = await loadAndRegister();
    expect(calls.length).toBe(2);
    expect(findProbe(calls, 'postgres')).toBeDefined();
    expect(findProbe(calls, 'redis')).toBeDefined();
  });

  it('postgres probe returns healthy when query succeeds', async () => {
    const calls = await loadAndRegister();
    const probe = findProbe(calls, 'postgres');
    const result = await probe.check();
    expect(result).toBe('healthy');
  });

  it('postgres probe returns down when query fails', async () => {
    const calls = await loadAndRegister();
    const probe = findProbe(calls, 'postgres');
    mockQueryRaw.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await probe.check();
    expect(result).toBe('down');
  });

  it('redis probe returns healthy when ping succeeds', async () => {
    const calls = await loadAndRegister();
    const probe = findProbe(calls, 'redis');
    const result = await probe.check();
    expect(result).toBe('healthy');
  });

  it('redis probe returns down when ping returns false', async () => {
    const calls = await loadAndRegister();
    const probe = findProbe(calls, 'redis');
    mockPing.mockResolvedValueOnce(false);
    const result = await probe.check();
    expect(result).toBe('down');
  });

  it('redis probe returns down when ping throws', async () => {
    const calls = await loadAndRegister();
    const probe = findProbe(calls, 'redis');
    mockPing.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await probe.check();
    expect(result).toBe('down');
  });
});
