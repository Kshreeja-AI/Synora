/**
 * Active health probes for the remote model endpoints.
 *
 * The collector itself is not under test — registerHealthProbe is mocked
 * to CAPTURE the probes, and each captured check() runs against the real
 * mock GPU box, so what is pinned is the probe's own wire behaviour:
 * healthy on 200, down on refusal, down on connection failure, one probe
 * per unique URL however many roles share it.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { getConfigMock, registerMock } = vi.hoisted(() => ({
  getConfigMock: vi.fn(),
  registerMock: vi.fn(),
}));

vi.mock('../config', () => ({ getConfig: getConfigMock }));
vi.mock('./health-collector.js', () => ({ registerHealthProbe: registerMock }));

import {
  registerModelEndpointProbes,
  resetModelEndpointProbesForTests,
} from './model-endpoint-probes';
import { startMockOpenAIServer } from '../test-support/mockOpenAIServer';

type Probe = { name: string; check: () => Promise<'healthy' | 'degraded' | 'down'> };

function capturedProbes(): Probe[] {
  return registerMock.mock.calls.map((call) => call[0] as Probe);
}

function config(overrides: { ai?: Record<string, unknown>; embeddings?: Record<string, unknown> }): void {
  getConfigMock.mockReturnValue({
    ai: { ...overrides.ai },
    embeddings: { ...overrides.embeddings },
  });
}

beforeEach(() => {
  registerMock.mockReset();
  resetModelEndpointProbesForTests();
});

describe('model endpoint probes', () => {
  it('registers nothing when no endpoint is configured', () => {
    config({});
    registerModelEndpointProbes();
    expect(capturedProbes()).toHaveLength(0);
  });

  it('is idempotent — double registration adds no duplicate probes', () => {
    config({ ai: { ollamaBaseUrl: 'http://gpu:11434/v1' } });
    registerModelEndpointProbes();
    registerModelEndpointProbes();
    expect(capturedProbes()).toHaveLength(1);
  });

  it('registers ONE probe when text and embeddings share a GPU box', () => {
    config({
      ai: { ollamaBaseUrl: 'http://gpu:11434/v1' },
      embeddings: { ollamaBaseUrl: 'http://gpu:11434/v1/' }, // trailing slash on purpose
    });
    registerModelEndpointProbes();
    const probes = capturedProbes();
    // Probing one box twice under two names would double-report every
    // outage; the trailing slash must not defeat the dedup.
    expect(probes).toHaveLength(1);
    expect(probes[0].name).toBe('model-endpoint:text:ollama+embeddings:ollama');
  });

  it('registers separate probes for genuinely different endpoints', () => {
    config({
      ai: {
        ollamaBaseUrl: 'http://gpu-a:11434/v1',
        selfHostedTextBaseUrl: 'http://gpu-b:8000/v1',
        selfHostedTextModel: 'm',
      },
    });
    registerModelEndpointProbes();
    expect(capturedProbes()).toHaveLength(2);
  });

  it('answers healthy when the endpoint lists models — and actually asked it to', async () => {
    const server = await startMockOpenAIServer({ requireAuth: 'probe-token' });
    config({ ai: { ollamaBaseUrl: server.baseUrl, ollamaApiKey: 'probe-token' } });
    registerModelEndpointProbes();

    await expect(capturedProbes()[0].check()).resolves.toBe('healthy');
    // Non-vacuity: the verdict came from the wire, not from a default.
    expect(server.requests.some((r) => r.path === '/v1/models')).toBe(true);
    await server.close();
  });

  it('answers down when the endpoint refuses its token', async () => {
    const server = await startMockOpenAIServer({ requireAuth: 'right-token' });
    config({ ai: { ollamaBaseUrl: server.baseUrl, ollamaApiKey: 'rotated-old-token' } });
    registerModelEndpointProbes();

    // Unavailable in every way that matters — the distinct cause goes to
    // the log, pointing the operator at the token rather than the machine.
    await expect(capturedProbes()[0].check()).resolves.toBe('down');
    await server.close();
  });

  it('answers down when nothing is listening at all', async () => {
    const server = await startMockOpenAIServer();
    const url = server.baseUrl;
    await server.close(); // now the port is dead
    config({ ai: { ollamaBaseUrl: url } });
    registerModelEndpointProbes();

    await expect(capturedProbes()[0].check()).resolves.toBe('down');
  });
});
