import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const SECRET_VALUE = 'test-secret-value-that-must-never-be-logged';

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  tryGetReal: vi.fn(),
  generateText: vi.fn(),
  loggerWarn: vi.fn(),
}));

vi.mock('../../config', () => ({ getConfig: mocks.getConfig }));
vi.mock('../../secrets', () => ({ secretsManager: { tryGetReal: mocks.tryGetReal } }));
vi.mock('../../utils/logger', () => ({
  logger: { warn: mocks.loggerWarn, error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
// The real adapter is replaced by a fake that records which provider/model was called.
vi.mock('../providers/openaiCompatible.provider', () => ({
  OpenAICompatibleTextProvider: class {
    readonly capabilities = ['text-generation'];
    constructor(
      readonly id: string,
      _client: unknown,
      private readonly model: string
    ) {}
    generateText(request: unknown) {
      return mocks.generateText(this.id, this.model, request);
    }
  },
}));
vi.mock('openai', () => ({ default: class {} }));

import { generateWithFreeTierChain, resetFreeTierChainForTests, FreeTierExhaustedError } from '../freeTierChain';
import { resetTextResilienceForTests } from '../textResilience';
import { NoProviderConfiguredError } from '../types';

const baseConfig = {
  ai: {
    groqModel: 'groq-model',
    rateLimit: { backend: 'memory', requestsPerSecond: 1000 },
    freeTier: {
      chain: ['groq', 'cloudflare', 'openrouter', 'mistral', 'sambanova'],
      baseUrls: {
        groq: 'https://groq.example/openai/v1',
        cloudflare: 'https://cf.example/client/v4/accounts/{accountId}/ai/v1',
        openrouter: 'https://or.example/api/v1',
        mistral: 'https://mistral.example/v1',
        sambanova: 'https://samba.example/v1',
      },
      models: {
        cloudflare: 'cf-model',
        openrouter: 'vendor/model:free',
        mistral: 'mistral-model',
        sambanova: 'samba-model',
      },
      cloudflareAccountId: 'acct123',
      trainingOptOutConfirmed: [] as string[],
      modelCheckTtlMs: 60_000,
      callTimeoutMs: 5_000,
      dailyRequestsGlobal: 500,
      dailyRequestsPerIp: 25,
    },
  },
};

function useKeys(present: string[]) {
  mocks.tryGetReal.mockImplementation(async (key: string) =>
    present.some((p) => key.startsWith(p)) ? SECRET_VALUE : undefined
  );
}

const okResult = (provider: string) => ({ text: `answer from ${provider}`, provider, model: 'm' });

describe('generateWithFreeTierChain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetFreeTierChainForTests();
    resetTextResilienceForTests();
    mocks.getConfig.mockReturnValue(structuredClone(baseConfig));
    // Model listings: unreachable by default -> availability "unknown" -> provider is tried.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    mocks.generateText.mockImplementation(async (id: string) => okResult(id));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the first configured provider in chain order', async () => {
    useKeys(['GROQ', 'CLOUDFLARE', 'OPENROUTER']);
    const result = await generateWithFreeTierChain({ prompt: 'hi' });
    expect(result.provider).toBe('groq');
    expect(mocks.generateText).toHaveBeenCalledTimes(1);
  });

  it('falls back to the next provider when the first fails', async () => {
    useKeys(['GROQ', 'CLOUDFLARE']);
    mocks.generateText.mockImplementation(async (id: string) => {
      if (id === 'groq') throw new Error('upstream 500');
      return okResult(id);
    });
    const result = await generateWithFreeTierChain({ prompt: 'hi' });
    expect(result.provider).toBe('cloudflare');
  });

  it('walks the whole documented chain: groq -> cloudflare -> openrouter -> mistral -> sambanova', async () => {
    useKeys(['GROQ', 'CLOUDFLARE', 'OPENROUTER', 'MISTRAL', 'SAMBANOVA']);
    mocks.getConfig.mockReturnValue({
      ai: { ...baseConfig.ai, freeTier: { ...baseConfig.ai.freeTier, trainingOptOutConfirmed: ['mistral'] } },
    });
    mocks.generateText.mockImplementation(async (id: string) => {
      if (id !== 'sambanova') throw new Error('down');
      return okResult(id);
    });
    const result = await generateWithFreeTierChain({ prompt: 'hi' });
    expect(result.provider).toBe('sambanova');
    expect(mocks.generateText.mock.calls.map((c) => c[0])).toEqual([
      'groq',
      'cloudflare',
      'openrouter',
      'mistral',
      'sambanova',
    ]);
  });

  it('skips providers with no key configured', async () => {
    useKeys(['SAMBANOVA']);
    const result = await generateWithFreeTierChain({ prompt: 'hi' });
    expect(result.provider).toBe('sambanova');
    expect(mocks.generateText).toHaveBeenCalledTimes(1);
  });

  it('throws NoProviderConfiguredError when nothing is configured (route maps this to 503)', async () => {
    useKeys([]);
    await expect(generateWithFreeTierChain({ prompt: 'hi' })).rejects.toBeInstanceOf(NoProviderConfiguredError);
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it('throws FreeTierExhaustedError when every configured provider fails', async () => {
    useKeys(['GROQ', 'CLOUDFLARE']);
    mocks.generateText.mockRejectedValue(new Error('down'));
    const error = await generateWithFreeTierChain({ prompt: 'hi' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FreeTierExhaustedError);
    expect((error as FreeTierExhaustedError).attempted).toEqual(['groq', 'cloudflare']);
  });

  it('opens the circuit breaker after repeated failures and then fails over without calling the provider', async () => {
    useKeys(['GROQ', 'CLOUDFLARE']);
    mocks.generateText.mockImplementation(async (id: string) => {
      if (id === 'groq') throw new Error('upstream 500');
      return okResult(id);
    });
    for (let i = 0; i < 5; i++) await generateWithFreeTierChain({ prompt: 'hi' });
    const groqCallsBefore = mocks.generateText.mock.calls.filter((c) => c[0] === 'groq').length;
    expect(groqCallsBefore).toBe(5);

    const result = await generateWithFreeTierChain({ prompt: 'hi' });
    expect(result.provider).toBe('cloudflare');
    const groqCallsAfter = mocks.generateText.mock.calls.filter((c) => c[0] === 'groq').length;
    expect(groqCallsAfter).toBe(5); // breaker refused the 6th call before it reached the provider
  });

  it('skips a provider whose configured model is absent from its listing', async () => {
    useKeys(['GROQ', 'CLOUDFLARE']);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) => {
        const body = String(url).includes('groq.example')
          ? { data: [{ id: 'some-other-model' }] }
          : { result: [{ name: 'cf-model' }] };
        return { ok: true, status: 200, json: async () => body };
      })
    );
    const result = await generateWithFreeTierChain({ prompt: 'hi' });
    expect(result.provider).toBe('cloudflare');
    expect(mocks.generateText.mock.calls.some((c) => c[0] === 'groq')).toBe(false);
  });

  it('still tries a provider when its listing endpoint errors', async () => {
    useKeys(['GROQ']);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));
    const result = await generateWithFreeTierChain({ prompt: 'hi' });
    expect(result.provider).toBe('groq');
  });

  it('refuses an OpenRouter model that is not a :free model', async () => {
    useKeys(['OPENROUTER']);
    const cfg = structuredClone(baseConfig);
    cfg.ai.freeTier.models.openrouter = 'anthropic/claude-3.5-sonnet';
    mocks.getConfig.mockReturnValue(cfg);
    await expect(generateWithFreeTierChain({ prompt: 'hi' })).rejects.toBeInstanceOf(NoProviderConfiguredError);
  });

  it('skips Cloudflare when no account id is configured', async () => {
    useKeys(['CLOUDFLARE']);
    const cfg = structuredClone(baseConfig);
    cfg.ai.freeTier.cloudflareAccountId = undefined as unknown as string;
    mocks.getConfig.mockReturnValue(cfg);
    await expect(generateWithFreeTierChain({ prompt: 'hi' })).rejects.toBeInstanceOf(NoProviderConfiguredError);
  });

  it('skips Mistral (trains on free-plan prompts) until the opt-out is confirmed', async () => {
    useKeys(['MISTRAL']);
    await expect(generateWithFreeTierChain({ prompt: 'hi' })).rejects.toBeInstanceOf(NoProviderConfiguredError);

    const cfg = structuredClone(baseConfig);
    cfg.ai.freeTier.trainingOptOutConfirmed = ['mistral'];
    mocks.getConfig.mockReturnValue(cfg);
    const result = await generateWithFreeTierChain({ prompt: 'hi' });
    expect(result.provider).toBe('mistral');
  });

  it('passes the per-provider model, not a caller-supplied one', async () => {
    useKeys(['CLOUDFLARE']);
    await generateWithFreeTierChain({ prompt: 'hi', model: 'caller-chose-this' });
    expect(mocks.generateText.mock.calls[0][1]).toBe('cf-model');
  });

  it('never logs a secret value or a provider error message', async () => {
    useKeys(['GROQ', 'CLOUDFLARE']);
    mocks.generateText.mockImplementation(async (id: string) => {
      if (id === 'groq') throw new Error(`401 invalid key ${SECRET_VALUE}`);
      return okResult(id);
    });
    await generateWithFreeTierChain({ prompt: 'hi' });
    const logged = JSON.stringify(mocks.loggerWarn.mock.calls);
    expect(logged).not.toContain(SECRET_VALUE);
  });
});
