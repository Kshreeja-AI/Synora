/**
 * The generic OpenAI-compatible text descriptor — the seam that makes
 * "replace Ollama with vLLM" a config change instead of a code change.
 *
 * The property under test is the refusal to guess: a generic endpoint's
 * model id genuinely cannot be inferred, so BOTH the URL and the model
 * are required before this provider counts as configured. A provider that
 * looked ready with half its configuration would fail on first use — the
 * placeholder dishonesty slice 13 eliminated, reintroduced through a
 * different door.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { getConfigMock } = vi.hoisted(() => ({ getConfigMock: vi.fn() }));

vi.mock('../../config', () => ({ getConfig: getConfigMock }));
vi.mock('openai', () => ({
  default: class {
    apiKey: string;
    baseURL: string;
    constructor(opts: { apiKey: string; baseURL: string }) {
      this.apiKey = opts.apiKey;
      this.baseURL = opts.baseURL;
    }
  },
}));

import { selfHostedTextDescriptor } from './selfHostedText.provider';

function config(ai: {
  selfHostedTextBaseUrl?: string;
  selfHostedTextApiKey?: string;
  selfHostedTextModel?: string;
}): void {
  getConfigMock.mockReturnValue({ ai });
}

describe('self-hosted text descriptor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('identifies itself as the generic OpenAI-compatible seam', () => {
    expect(selfHostedTextDescriptor.id).toBe('self-hosted');
    expect(selfHostedTextDescriptor.capabilities).toContain('text-generation');
    // Deliberately NOT advertised: an unknown server with an unknown model
    // has not demonstrated reliable tool calls.
    expect(selfHostedTextDescriptor.capabilities).not.toContain('tool-calling');
  });

  it('requires BOTH url and model — half a configuration is not configured', async () => {
    config({ selfHostedTextBaseUrl: 'https://vllm.example.com/v1' });
    await expect(selfHostedTextDescriptor.isConfigured()).resolves.toBe(false);

    config({ selfHostedTextModel: 'meta-llama/Llama-3.1-8B-Instruct' });
    await expect(selfHostedTextDescriptor.isConfigured()).resolves.toBe(false);

    config({
      selfHostedTextBaseUrl: 'https://vllm.example.com/v1',
      selfHostedTextModel: 'meta-llama/Llama-3.1-8B-Instruct',
    });
    await expect(selfHostedTextDescriptor.isConfigured()).resolves.toBe(true);
  });

  it('sends the optional Bearer token to a protected endpoint', async () => {
    config({
      selfHostedTextBaseUrl: 'https://vllm.example.com/v1',
      selfHostedTextModel: 'm',
      selfHostedTextApiKey: 'vllm-proxy-token',
    });
    const provider = await selfHostedTextDescriptor.create();
    const client = (provider as unknown as { client: { apiKey: string; baseURL: string } }).client;
    expect(client.apiKey).toBe('vllm-proxy-token');
    expect(client.baseURL).toBe('https://vllm.example.com/v1');
  });

  it('keeps the ignored placeholder for an unprotected endpoint', async () => {
    config({ selfHostedTextBaseUrl: 'http://10.0.0.5:8000/v1', selfHostedTextModel: 'm' });
    const provider = await selfHostedTextDescriptor.create();
    const client = (provider as unknown as { client: { apiKey: string } }).client;
    expect(client.apiKey).toBe('self-hosted-does-not-require-an-api-key');
  });

  it('refuses creation without its configuration rather than guessing', async () => {
    config({});
    await expect(selfHostedTextDescriptor.create()).rejects.toThrow(/SELF_HOSTED_TEXT_BASE_URL/);
  });
});

describe('metering is declared by configuration, not assumed', () => {
  // Regression for a spend-safety hole found by running a REAL generation:
  // this descriptor answered `unmetered` unconditionally, so a deployment
  // pointed at a PAID OpenAI-compatible router recorded 0 cents on every
  // request and AI_GLOBAL_MAX_COST_PER_DAY_CENTS could never trigger. The
  // operator had configured a spending limit the code silently ignored.
  const configure = (selfHostedTextMetered: boolean) =>
    getConfigMock.mockReturnValue({
      ai: {
        selfHostedTextBaseUrl: 'https://router.example/v1',
        selfHostedTextModel: 'some-model',
        selfHostedTextApiKey: 'irrelevant-for-this-assertion',
        selfHostedTextMetered,
      },
    });

  it('reports metered when configuration says the endpoint bills', () => {
    configure(true);
    expect(selfHostedTextDescriptor.metering).toBe('metered');
  });

  it('reports unmetered only when explicitly told the runtime is free', () => {
    configure(false);
    expect(selfHostedTextDescriptor.metering).toBe('unmetered');
  });

  it('is read per call, so it cannot be frozen at module load', () => {
    // The value is a getter rather than a literal precisely so a descriptor
    // imported before config initialises still answers correctly afterwards.
    configure(true);
    expect(selfHostedTextDescriptor.metering).toBe('metered');
    configure(false);
    expect(selfHostedTextDescriptor.metering).toBe('unmetered');
  });
});
