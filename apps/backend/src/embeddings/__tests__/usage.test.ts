import { describe, it, expect } from 'vitest';
import { UsageAccountant } from '../usage';

describe('UsageAccountant', () => {
  it('returns zeroed usage for a workspace with no recorded calls', () => {
    const accountant = new UsageAccountant();
    const usage = accountant.getWorkspaceUsage('ws-1');

    expect(usage.totalCalls).toBe(0);
    expect(usage.totalTokens).toBe(0);
    expect(usage.totalCostUsd).toBe(0);
    expect(usage.byProvider).toEqual({});
  });

  it('aggregates usage per workspace', () => {
    const accountant = new UsageAccountant();
    accountant.recordUsage('ws-1', 'openai', 100, 0.002);
    accountant.recordUsage('ws-1', 'openai', 50, 0.001);

    const usage = accountant.getWorkspaceUsage('ws-1');
    expect(usage.totalCalls).toBe(2);
    expect(usage.totalTokens).toBe(150);
    expect(usage.totalCostUsd).toBeCloseTo(0.003);
  });

  it('breaks usage down by provider within a workspace', () => {
    const accountant = new UsageAccountant();
    accountant.recordUsage('ws-1', 'openai', 100, 0.002);
    accountant.recordUsage('ws-1', 'voyage', 50, 0.0003);

    const usage = accountant.getWorkspaceUsage('ws-1');
    expect(usage.byProvider.openai).toEqual({ calls: 1, tokens: 100, costUsd: 0.002 });
    expect(usage.byProvider.voyage).toEqual({ calls: 1, tokens: 50, costUsd: 0.0003 });
  });

  it('keeps usage isolated between workspaces', () => {
    const accountant = new UsageAccountant();
    accountant.recordUsage('ws-1', 'openai', 100, 0.002);
    accountant.recordUsage('ws-2', 'openai', 999, 0.999);

    expect(accountant.getWorkspaceUsage('ws-1').totalTokens).toBe(100);
    expect(accountant.getWorkspaceUsage('ws-2').totalTokens).toBe(999);
  });

  it('returns all workspaces via getAllUsage', () => {
    const accountant = new UsageAccountant();
    accountant.recordUsage('ws-1', 'openai', 100, 0.002);
    accountant.recordUsage('ws-2', 'openai', 200, 0.004);

    const all = accountant.getAllUsage();
    expect(all.size).toBe(2);
    expect(all.get('ws-1')?.totalTokens).toBe(100);
    expect(all.get('ws-2')?.totalTokens).toBe(200);
  });
});
