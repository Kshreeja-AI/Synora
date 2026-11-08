import { getConfig } from '../../config';
import {
  AICapability,
  AIProviderError,
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResponse,
  WebSearchResult,
} from '../types';
import type { AIProviderDescriptor } from '../types/descriptor';

const TIMEOUT_MS = 8_000;
const MAX_LIMIT = 10;
const USER_AGENT = 'SynoraBot/0.1 (+https://trysynora.tech)';

type Fetch = typeof fetch;

function clampLimit(limit: number | undefined): number {
  return Math.min(Math.max(Math.trunc(limit ?? 5), 1), MAX_LIMIT);
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

async function getJson(fetchImpl: Fetch, url: string, providerId: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    // Unreachable search is a normal condition: surface it as a typed error
    // the caller can degrade on, never an unhandled rejection or fake result.
    throw new AIProviderError(
      `${providerId} search unreachable: ${error instanceof Error ? error.message : String(error)}`,
      providerId,
      error
    );
  }
  if (!response.ok) {
    throw new AIProviderError(`${providerId} search returned HTTP ${response.status}`, providerId);
  }
  try {
    return await response.json();
  } catch (error) {
    throw new AIProviderError(`${providerId} search returned invalid JSON`, providerId, error);
  }
}

function requireQuery(request: WebSearchRequest, providerId: string): string {
  const query = request.query.trim();
  if (query.length === 0) throw new AIProviderError(`${providerId}: empty search query`, providerId);
  if (query.length > 300) throw new AIProviderError(`${providerId}: query longer than 300 characters`, providerId);
  return query;
}

/** Wikipedia's public search API. Keyless; every result links to its source article. */
export class WikipediaSearchProvider implements WebSearchProvider {
  readonly id = 'wikipedia';
  readonly capabilities: readonly AICapability[] = ['web-search'];

  constructor(private readonly fetchImpl: Fetch = fetch) {}

  async search(request: WebSearchRequest): Promise<WebSearchResponse> {
    const query = requireQuery(request, this.id);
    const lang = /^[a-z]{2,3}$/.test(request.language ?? '') ? (request.language as string) : 'en';
    const url =
      `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&format=json` +
      `&srlimit=${clampLimit(request.limit)}&srsearch=${encodeURIComponent(query)}`;

    const body = (await getJson(this.fetchImpl, url, this.id)) as {
      query?: { search?: Array<{ title?: unknown; snippet?: unknown }> };
    };
    const rows = body.query?.search;
    if (!Array.isArray(rows)) {
      throw new AIProviderError(`${this.id} search response had an unexpected shape`, this.id);
    }

    const results: WebSearchResult[] = [];
    for (const row of rows) {
      if (typeof row.title !== 'string') continue;
      results.push({
        title: row.title,
        url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(row.title.replace(/ /g, '_'))}`,
        snippet: typeof row.snippet === 'string' ? stripTags(row.snippet) : '',
      });
    }
    return { results, provider: this.id, query };
  }
}

/** A self-hosted SearXNG instance with the JSON output format enabled. */
export class SearxngSearchProvider implements WebSearchProvider {
  readonly id = 'searxng';
  readonly capabilities: readonly AICapability[] = ['web-search'];

  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: Fetch = fetch
  ) {}

  async search(request: WebSearchRequest): Promise<WebSearchResponse> {
    const query = requireQuery(request, this.id);
    const params = new URLSearchParams({ q: query, format: 'json' });
    if (request.language) params.set('language', request.language);
    const url = `${this.baseUrl.replace(/\/+$/, '')}/search?${params.toString()}`;

    const body = (await getJson(this.fetchImpl, url, this.id)) as {
      results?: Array<{ title?: unknown; url?: unknown; content?: unknown }>;
    };
    if (!Array.isArray(body.results)) {
      throw new AIProviderError(`${this.id} search response had an unexpected shape`, this.id);
    }

    const results: WebSearchResult[] = [];
    for (const row of body.results) {
      if (typeof row.title !== 'string' || typeof row.url !== 'string') continue;
      // Only http(s) links are citable; anything else is dropped, not rewritten.
      if (!/^https?:\/\//i.test(row.url)) continue;
      results.push({
        title: row.title,
        url: row.url,
        snippet: typeof row.content === 'string' ? row.content : '',
      });
      if (results.length >= clampLimit(request.limit)) break;
    }
    return { results, provider: this.id, query };
  }
}

export const searxngSearchDescriptor: AIProviderDescriptor<WebSearchProvider> = {
  id: 'searxng',
  displayName: 'SearXNG (self-hosted)',
  capabilities: ['web-search'],
  metering: 'unmetered' as const,
  async isConfigured() {
    return Boolean(getConfig().ai.searchSearxngBaseUrl);
  },
  async create() {
    const { searchSearxngBaseUrl } = getConfig().ai;
    if (!searchSearxngBaseUrl) throw new Error('SearXNG search requires SEARCH_SEARXNG_BASE_URL to be set.');
    return new SearxngSearchProvider(searchSearxngBaseUrl);
  },
};

export const wikipediaSearchDescriptor: AIProviderDescriptor<WebSearchProvider> = {
  id: 'wikipedia',
  displayName: 'Wikipedia',
  capabilities: ['web-search'],
  metering: 'unmetered' as const,
  async isConfigured() {
    return getConfig().ai.searchWikipediaEnabled;
  },
  async create() {
    return new WikipediaSearchProvider();
  },
};
