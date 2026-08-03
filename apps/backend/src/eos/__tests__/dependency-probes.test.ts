import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRegister, mockQueryRaw } = vi.hoisted(() => ({
  mockRegister: vi.fn(),
  mockQueryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
}));

vi.mock('../health-collector', () => ({
  registerHealthProbe: mockRegister,
}));

vi.mock('@synora/database', () => ({
  prisma: { $queryRaw: mockQueryRaw },
}));

describe('dependency-probes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryRaw.mockResolvedValue([{ '?column?': 1 }]);
    vi.resetModules();
  });

  async function loadAndRegister() {
    const mod = await import('../dependency-probes');
    mod.registerDependencyProbes();
    return mockRegister.mock.calls.find(([p]: any) => p.name === 'postgres')![0];
  }

  it('registers a postgres probe', async () => {
    const probe = await loadAndRegister();
    expect(probe).toBeDefined();
    expect(probe.name).toBe('postgres');
  });

  it('postgres probe returns healthy when query succeeds', async () => {
    const probe = await loadAndRegister();
    const result = await probe.check();
    expect(result).toBe('healthy');
  });

  it('postgres probe returns down when query fails', async () => {
    const probe = await loadAndRegister();
    mockQueryRaw.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await probe.check();
    expect(result).toBe('down');
  });
});
