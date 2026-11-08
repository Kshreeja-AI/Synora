import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getPlatformCapabilities } from '../capabilities.service';
import { PROVIDER_REGISTRY } from '../../ai/registry';
import { IMAGE_PROVIDER_REGISTRY } from '../../ai/imageRegistry';
import { VIDEO_PROVIDER_REGISTRY } from '../../ai/videoRegistry';
import { TTS_PROVIDER_REGISTRY } from '../../ai/ttsRegistry';
import { STT_PROVIDER_REGISTRY } from '../../ai/sttRegistry';
import { SEARCH_PROVIDER_REGISTRY } from '../../ai/searchRegistry';
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
vi.mock('../../ai/imageRegistry', () => ({
  IMAGE_PROVIDER_REGISTRY: [{ id: 'openai', isConfigured: vi.fn() }],
}));
vi.mock('../../ai/videoRegistry', () => ({
  VIDEO_PROVIDER_REGISTRY: [{ id: 'replicate', isConfigured: vi.fn() }],
}));
vi.mock('../../ai/ttsRegistry', () => ({
  TTS_PROVIDER_REGISTRY: [{ id: 'openai', isConfigured: vi.fn() }],
}));
vi.mock('../../ai/sttRegistry', () => ({
  STT_PROVIDER_REGISTRY: [{ id: 'openai-compatible', isConfigured: vi.fn() }],
}));
vi.mock('../../ai/searchRegistry', () => ({
  SEARCH_PROVIDER_REGISTRY: [{ id: 'wikipedia', isConfigured: vi.fn() }],
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
const image = IMAGE_PROVIDER_REGISTRY[0] as unknown as Configurable;
const video = VIDEO_PROVIDER_REGISTRY[0] as unknown as Configurable;
const tts = TTS_PROVIDER_REGISTRY[0] as unknown as Configurable;
const stt = STT_PROVIDER_REGISTRY[0] as unknown as Configurable;
const search = SEARCH_PROVIDER_REGISTRY[0] as unknown as Configurable;
const embeddings = EMBEDDING_PROVIDER_REGISTRY[0] as unknown as Configurable;
const vectors = VECTORDB_PROVIDER_REGISTRY[0] as unknown as Configurable;
const storage = STORAGE_REGISTRY[0] as unknown as Configurable;
const virusScan = VIRUS_SCAN_PROVIDER_REGISTRY[0] as unknown as Configurable;

function configure(options: {
  ai?: boolean;
  image?: boolean;
  video?: boolean;
  tts?: boolean;
  stt?: boolean;
  search?: boolean;
  embeddings?: boolean;
  vectors?: boolean;
  storage?: boolean;
  virusScan?: boolean;
  mailTransport?: string;
}): void {
  ai.isConfigured.mockResolvedValue(options.ai ?? false);
  image.isConfigured.mockResolvedValue(options.image ?? false);
  video.isConfigured.mockResolvedValue(options.video ?? false);
  tts.isConfigured.mockResolvedValue(options.tts ?? false);
  stt.isConfigured.mockResolvedValue(options.stt ?? false);
  search.isConfigured.mockResolvedValue(options.search ?? false);
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

  it('reports speech-to-text as unconfigured without fabricating a transcript', async () => {
    configure({});

    const transcription = find(await getPlatformCapabilities(), 'speech-to-text');

    expect(transcription.status).toBe('unconfigured');
    expect(transcription.degradedBehavior).toContain('no transcript is ever fabricated');
  });

  it('activates speech-to-text and web search when their providers are configured', async () => {
    configure({ stt: true, search: true });

    const result = await getPlatformCapabilities();

    expect(find(result, 'speech-to-text').status).toBe('active');
    expect(find(result, 'speech-to-text').provider).toBe('openai-compatible');
    expect(find(result, 'web-search').status).toBe('active');
    expect(find(result, 'web-search').provider).toBe('wikipedia');
  });

  it('reports web search as unconfigured without fabricating results', async () => {
    configure({});

    const webSearch = find(await getPlatformCapabilities(), 'web-search');

    expect(webSearch.status).toBe('unconfigured');
    expect(webSearch.degradedBehavior).toContain('never fabricated');
  });

  it('reports image generation as unconfigured with an honest degradation message', async () => {
    configure({});

    const img = find(await getPlatformCapabilities(), 'image-generation');

    expect(img.status).toBe('unconfigured');
    expect(img.degradedBehavior).toMatch(/503|placeholder/i);
  });

  it('activates image generation when an image provider is configured', async () => {
    configure({ image: true });

    const img = find(await getPlatformCapabilities(), 'image-generation');

    expect(img.status).toBe('active');
    expect(img.provider).toBe('openai');
  });

  it('reports video generation as unconfigured with an honest degradation message', async () => {
    configure({});

    const vid = find(await getPlatformCapabilities(), 'video-generation');

    expect(vid.status).toBe('unconfigured');
    expect(vid.degradedBehavior).toMatch(/503|placeholder/i);
  });

  it('activates video generation when a video provider is configured', async () => {
    configure({ video: true });

    const vid = find(await getPlatformCapabilities(), 'video-generation');

    expect(vid.status).toBe('active');
    expect(vid.provider).toBe('replicate');
  });

  it('sets allActive only when every capability is live', async () => {
    configure({
      ai: true,
      image: true,
      video: true,
      tts: true,
      stt: true,
      search: true,
      embeddings: true,
      vectors: true,
      storage: true,
      virusScan: true,
      mailTransport: 'smtp',
    });

    const result = await getPlatformCapabilities();

    expect(result.allActive).toBe(true);

    configure({
      ai: true,
      image: true,
      video: true,
      tts: true,
      stt: false,
      search: true,
      embeddings: true,
      vectors: true,
      storage: true,
      virusScan: true,
      mailTransport: 'smtp',
    });

    expect((await getPlatformCapabilities()).allActive).toBe(false);
  });

  it('never exposes a secret value, only provider identifiers', async () => {
    configure({ ai: true, embeddings: true, vectors: true, storage: true, mailTransport: 'smtp' });

    const serialized = JSON.stringify(await getPlatformCapabilities());

    expect(serialized).not.toMatch(/sk-|api[_-]?key|secret|password|token/i);
  });
});
