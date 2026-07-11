import { describe, expect, it, vi } from 'vitest';
import { TemporalWorkflowEngine } from './temporal-workflow-engine.js';
import type { TemporalClientLike } from './temporal-client-like.js';

function makeFakeClient(): TemporalClientLike {
  return {
    start: vi.fn(async (_type, options) => ({ workflowId: options.workflowId })),
    signal: vi.fn(async () => undefined),
    query: vi.fn(async () => 'result'),
  };
}

describe('TemporalWorkflowEngine', () => {
  it('starts a workflow with the input wrapped as a single arg', async () => {
    const client = makeFakeClient();
    const engine = new TemporalWorkflowEngine(client);

    const handle = await engine.startWorkflow(
      'onboardUser',
      { userId: 'u1' },
      {
        workflowId: 'onboard-u1',
        taskQueue: 'onboarding',
      },
    );

    expect(handle).toEqual({ workflowId: 'onboard-u1' });
    expect(client.start).toHaveBeenCalledWith('onboardUser', {
      workflowId: 'onboard-u1',
      taskQueue: 'onboarding',
      args: [{ userId: 'u1' }],
    });
  });

  it('signals a workflow', async () => {
    const client = makeFakeClient();
    const engine = new TemporalWorkflowEngine(client);

    await engine.signalWorkflow('onboard-u1', 'cancel', { reason: 'user request' });

    expect(client.signal).toHaveBeenCalledWith('onboard-u1', 'cancel', [
      { reason: 'user request' },
    ]);
  });

  it('queries a workflow', async () => {
    const client = makeFakeClient();
    const engine = new TemporalWorkflowEngine(client);

    const result = await engine.queryWorkflow<string>('onboard-u1', 'status');

    expect(result).toBe('result');
    expect(client.query).toHaveBeenCalledWith('onboard-u1', 'status', []);
  });
});
