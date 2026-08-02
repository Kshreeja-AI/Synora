import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getPlatformCapabilities } from '../capabilities.service';
import { PROVIDER_REGISTRY } from '../../ai/registry';
import { EMBEDDING_PROVIDER_REGISTRY } from '../../embeddings';
import { VECTORDB_PROVIDER_REGISTRY } from '../../vectordb';
import { STORAGE_REGISTRY } from '../../storage/registry';
import { VIRUS_SCAN_PROVIDER_REGISTRY } from '../../files/virusScanRegistry';
import { getConfig } from '../../config';

/**
 * Capability detection is the operator's post-deployment confirmation
 * that credentials took effect, so its two failure modes both matter:
 * reporting a capability active when it isn't (an operator would launch
 * believing email works), and reporting it unconfigured when it is (an
 * operator would keep debugging a working system).
 */

vi.mock('../../ai/registry', () => ({
  PROVIDER_REGISTRY: [{ id: 'anthropic', isConfigured: vi.fn() }],
}));
vi.mock('../../embeddings', () => ({
  EMBEDDING_PROVIDER_REGISTRY: [{ id: 'openai', isConfigured: vi.fn() }],
}));
vi.mock('../../vectordb', () => ({
  VECTORDB_PROVIDER_REGISTRY: [{ id: 'pgvector', isConfigured: vi.fn() }],
}));
vi.mock('../../storage/registry', () => ({
  STORAGE_REGISTRY: [{ id: 'local', isConfigured: vi.fn() }],
}));
vi.mock('../../files/virusScanRegistry', () => ({
  VIRUS_SCAN_PROVIDER_REGISTRY: [{ id: 'clamav', isConfigured: vi.fn() }],
}));
vi.mock('../../mail/registry', () => ({
  TRANSPORT_REGISTRY: [{ id: 'console' }, { id: 'smtp' }],
}));
vi.mock('../../config', () => ({
  getConfig: vi.fn(),
}));

type Configurable = { isConfigured: ReturnType<typeof vi.fn> };

const ai = PROVIDER_REGISTRY[0] as unknown as Configurable;
const embeddings = EMBEDDING_PROVIDER_REGISTRY[0] as unknown as Configurable;
const vectors = VECTORDB_PROVIDER_REGISTRY[0] as unknown as Configurable;
const storage = STORAGE_REGISTRY[0] as unknown as Configurable;
const virusScan = VIRUS_SCAN_PROVIDER_REGISTRY[0] as unknown as Configurable;

function configure(options: {
  ai?: boolean;
  embeddings?: boolean;
  vectors?: boolean;
  storage?: boolean;
  virusScan?: boolean;
  mailTransport?: string;
}): void {
  ai.isConfigured.mockResolvedValue(options.ai ?? false);
  embeddings.isConfigured.mockResolvedValue(options.embeddings ?? false);
  vectors.isConfigured.mockResolvedValue(options.vectors ?? false);
  storage.isConfigured.mockResolvedValue(options.storage ?? false);
  virusScan.isConfigured.mockResolvedValue(options.virusScan ?? false);
  vi.mocked(getConfig).mockReturnValue({
    mail: { transport: options.mailTransport ?? 'console' },
  } as never);
}

function find(capabilities: Awaited<ReturnType<typeof getPlatformCapabilities>>, id: string) {
  return capabilities.capabilities.find((c) => c.id === id)!;
}

describe('getPlatformCapabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports everything unconfigured on a bare deployment', async () => {
    configure({});

    const result = await getPlatformCapabilities();

    expect(result.allActive).toBe(false);
    expect(result.capabilities.every((c) => c.status === 'unconfigured')).toBe(true);
  });

  it('explains the degraded behavior of each unconfigured capability', async () => {
    configure({});

    const result = await getPlatformCapabilities();

    for (const capability of result.capabilities) {
      expect(capability.degradedBehavior).toBeTruthy();
    }
    expect(find(result, 'semantic-memory').degradedBehavior).toContain('lexical');
  });

  it('activates capabilities whose providers are configured', async () => {
    configure({ ai: true, storage: true });

    const result = await getPlatformCapabilities();

    expect(find(result, 'text-generation').status).toBe('active');
    expect(find(result, 'text-generation').provider).toBe('anthropic');
    expect(find(result, 'object-storage').status).toBe('active');
    expect(find(result, 'semantic-memory').status).toBe('unconfigured');
  });

  it('requires BOTH halves before semantic memory is reported active', async () => {
    configure({ embeddings: true });
    expect(find(await getPlatformCapabilities(), 'semantic-memory').status).toBe('unconfigured');

    configure({ vectors: true });
    expect(find(await getPlatformCapabilities(), 'semantic-memory').status).toBe('unconfigured');

    configure({ embeddings: true, vectors: true });
    const both = find(await getPlatformCapabilities(), 'semantic-memory');
    expect(both.status).toBe('active');
    expect(both.provider).toBe('openai + pgvector');
  });

  it('treats the console mail transport as not production-ready', async () => {
    configure({ mailTransport: 'console' });

    const email = find(await getPlatformCapabilities(), 'email');

    expect(email.status).toBe('unconfigured');
    expect(email.degradedBehavior).toContain('log');
  });

  it('reports a real mail transport as active', async () => {
    configure({ mailTransport: 'smtp' });

    const email = find(await getPlatformCapabilities(), 'email');

    expect(email.status).toBe('active');
    expect(email.provider).toBe('smtp');
    expect(email.degradedBehavior).toBeUndefined();
  });

  it('reports virus scanning as unconfigured with a fail-closed explanation', async () => {
    configure({});

    const scanning = find(await getPlatformCapabilities(), 'virus-scanning');

    expect(scanning.status).toBe('unconfigured');
    expect(scanning.degradedBehavior).toContain('never marked clean');
  });

  it('activates virus scanning when a scanner is configured', async () => {
    configure({ virusScan: true });

    const scanning = find(await getPlatformCapabilities(), 'virus-scanning');

    expect(scanning.status).toBe('active');
    expect(scanning.provider).toBe('clamav');
  });

  it('sets allActive only when every capability is live', async () => {
    configure({
      ai: true,
      embeddings: true,
      vectors: true,
      storage: true,
      virusScan: true,
      mailTransport: 'smtp',
    });

    const result = await getPlatformCapabilities();

    expect(result.allActive).toBe(true);
  });

  it('never exposes a secret value, only provider identifiers', async () => {
    configure({ ai: true, embeddings: true, vectors: true, storage: true, mailTransport: 'smtp' });

    const serialized = JSON.stringify(await getPlatformCapabilities());

    expect(serialized).not.toMatch(/sk-|api[_-]?key|secret|password|token/i);
  });
});
