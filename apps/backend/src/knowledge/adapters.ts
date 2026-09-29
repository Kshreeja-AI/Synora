import { logger } from '../utils/logger';
import { safeFetch } from '../net/ssrf';
import { FIXTURE_CORPUS } from './fixtures/corpus';
import { KnowledgeSecurityError, MAX_FETCH_BYTES, assertSafeSourceUrl, redactUrl } from './security';
import type { KnowledgeDocument, KnowledgeIngestionAdapter, KnowledgeSource } from './types';

/**
 * Ingestion adapters — the only place a source's wire format is known.
 *
 * Everything downstream sees `KnowledgeDocument` and nothing else, which is
 * what lets a new source be added without touching the policy gate, the
 * pipeline, the retrieval layer or any test that is not about that source.
 * The same shape the AI, embeddings, vector-DB, mail and storage layers use.
 *
 * BATCHED BY CURSOR, not by returning an array of everything. A source with a
 * million documents cannot be held in memory, and a job that fails at
 * document 900,000 must not re-embed the first 899,999 — that is real money
 * on a metered embedding provider. The cursor is what makes a resume cheap.
 */

/**
 * The deterministic local corpus. No network, no credential, no download.
 *
 * This is the adapter every test uses, and its existence is what keeps the
 * test suite from ever reaching the internet — a suite that fetched a real
 * source would be slow, flaky, and unable to exercise the refusal paths.
 */
export const fixtureAdapter: KnowledgeIngestionAdapter = {
  id: 'fixture',
  displayName: 'Deterministic local fixture corpus',

  async isAvailable() {
    return true;
  },

  async fetchBatch({ source, cursor, batchSize, correlationId }) {
    const offset = cursor === null ? 0 : Number.parseInt(cursor, 10);
    if (!Number.isInteger(offset) || offset < 0) {
      throw new Error(`fixture adapter received an invalid cursor: "${cursor}"`);
    }

    const documents = FIXTURE_CORPUS.slice(offset, offset + batchSize).map((doc) => ({
      ...doc,
      // The corpus is written once and reused by every source that points at
      // this adapter, so the source id is rewritten rather than assumed —
      // otherwise a test registering its own fixture-backed source would get
      // documents attributed to `synora-fixture` and the policy gate would
      // judge the wrong source.
      sourceId: source.id,
    }));

    const next = offset + documents.length;
    logger.debug('[Knowledge] fixture batch', {
      correlationId,
      sourceId: source.id,
      offset,
      returned: documents.length,
    });

    return {
      documents,
      nextCursor: next >= FIXTURE_CORPUS.length ? null : String(next),
      total: FIXTURE_CORPUS.length,
    };
  },
};

/**
 * A JSON-over-HTTP source.
 *
 * ── EVERY REQUEST GOES THROUGH THE SSRF GUARD ────────────────────────────
 *
 * A source URL is operator configuration and a paginated cursor can carry a
 * next-page URL supplied by the REMOTE SIDE — which is a URL Synora did not
 * choose, fetched from inside the production network where `postgres:5432`
 * and the cloud metadata endpoint both resolve. `safeFetch` resolves the name
 * and judges the addresses on every hop, which is the only check that
 * survives `0x7f.1`, `localtest.me` and a redirect.
 *
 * ── AND THE RESPONSE IS BOUNDED BEFORE IT IS READ ────────────────────────
 *
 * The body is streamed with a byte ceiling rather than buffered whole. A
 * source that answers with a 40 GB response should cost Synora 32 MB and an
 * error, not the process.
 */
export const httpJsonAdapter: KnowledgeIngestionAdapter = {
  id: 'http-json',
  displayName: 'JSON over HTTPS',

  async isAvailable() {
    // No credential and no configuration of its own — availability here means
    // "this build can make an HTTPS request", which it always can. Whether a
    // particular SOURCE is reachable is a per-fetch question, not a
    // capability question, and conflating them would report a network outage
    // as a missing feature.
    return true;
  },

  async fetchBatch({ source, cursor, batchSize, correlationId }) {
    const url = cursor ?? buildFirstPageUrl(source, batchSize);
    await assertSafeSourceUrl(url);

    const response = await safeFetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'Synora-Knowledge-Ingestion/1' },
    });
    if (!response.ok) {
      throw new Error(
        `source "${source.id}" answered HTTP ${response.status} for ${redactUrl(url)}`
      );
    }

    const body = await readBounded(response, MAX_FETCH_BYTES);
    const parsed = JSON.parse(body) as {
      documents?: unknown[];
      items?: unknown[];
      next?: string;
      total?: number;
    };

    const raw = parsed.documents ?? parsed.items ?? [];
    const documents = raw.map((entry) => toDocument(entry, source));

    if (parsed.next) {
      // The remote side chose this URL. It is re-validated on the next call
      // by `assertSafeSourceUrl`, and rejected here if it is not even a URL —
      // a cursor that is a shell fragment or a file path never becomes one.
      try {
        // eslint-disable-next-line no-new
        new URL(parsed.next);
      } catch {
        throw new KnowledgeSecurityError(
          `source "${source.id}" returned a next-page cursor that is not a URL`,
          'unsafe-url'
        );
      }
    }

    logger.debug('[Knowledge] http-json batch', {
      correlationId,
      sourceId: source.id,
      url: redactUrl(url),
      returned: documents.length,
    });

    return {
      documents,
      nextCursor: parsed.next ?? null,
      total: typeof parsed.total === 'number' ? parsed.total : null,
    };
  },
};

function buildFirstPageUrl(source: KnowledgeSource, batchSize: number): string {
  const url = new URL(source.url);
  url.searchParams.set('limit', String(batchSize));
  return url.toString();
}

/**
 * Read a response body with a hard byte ceiling.
 *
 * `response.text()` would buffer whatever arrives, so a malicious or broken
 * source could exhaust memory with a single reply. Reading chunk by chunk and
 * stopping at the limit turns that into a bounded, reported failure.
 */
async function readBounded(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return response.text();

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new KnowledgeSecurityError(
        `response exceeded ${maxBytes} bytes and was abandoned`,
        'oversized'
      );
    }
    chunks.push(value);
  }

  return new TextDecoder('utf-8').decode(Buffer.concat(chunks.map((c) => Buffer.from(c))));
}

/**
 * Map an untrusted JSON object onto a document.
 *
 * Everything is coerced or dropped; nothing is trusted. In particular the
 * `licence` a remote source claims for an ITEM is accepted only as a
 * candidate — the policy gate still judges it, and a source claiming
 * `CC0-1.0` for material it does not own gets exactly as far as a source
 * claiming nothing.
 */
function toDocument(entry: unknown, source: KnowledgeSource): KnowledgeDocument {
  const record = (entry ?? {}) as Record<string, unknown>;
  const text = typeof record.text === 'string' ? record.text : typeof record.content === 'string' ? record.content : '';

  return {
    id: String(record.id ?? '').slice(0, 255),
    sourceId: source.id,
    title: typeof record.title === 'string' ? record.title.slice(0, 512) : '',
    text,
    language: typeof record.language === 'string' ? record.language.slice(0, 16) : 'en',
    version: typeof record.version === 'string' ? record.version.slice(0, 64) : '1',
    collectedAt: new Date(0).toISOString(),
    ...(typeof record.url === 'string' ? { originalUrl: record.url } : {}),
    ...(typeof record.publisher === 'string' ? { publisher: record.publisher.slice(0, 256) } : {}),
    ...(typeof record.author === 'string' ? { author: record.author.slice(0, 256) } : {}),
    ...(typeof record.publishedAt === 'string' ? { publishedAt: record.publishedAt } : {}),
    ...(typeof record.licence === 'string' ? { itemLicence: record.licence as KnowledgeDocument['itemLicence'] } : {}),
  };
}

/**
 * Compressed archive sources — Wikipedia dumps, Gutenberg mirrors, dataset
 * tarballs.
 *
 * ── STATUS: DECLARED, NOT IMPLEMENTED ────────────────────────────────────
 *
 * Several catalogued sources genuinely need this adapter, so the catalogue
 * names it honestly rather than pointing them at an adapter that could not
 * really read them. It reports `isAvailable() === false`, so
 * `createIngestionJob` refuses at CREATION with a clear message instead of a
 * job that sits in a queue and fails at its first batch.
 *
 * ── WHY IT IS NOT WRITTEN YET ────────────────────────────────────────────
 *
 * Archive ingestion is not a small function. A Wikipedia dump is a multi-
 * gigabyte multistream bzip2 XML file: it must be streamed rather than
 * buffered, decompressed with the bomb guard in `./security.ts` applied to
 * every block, parsed incrementally, and checkpointed at a byte offset so a
 * resume does not restart the download. Each of those is a place to be wrong
 * in a way that costs memory or money.
 *
 * Writing it speculatively — for a source nobody has authorised ingesting,
 * in a release that is mid-deployment — would be a large amount of untested
 * code in the path where untrusted bytes first enter. The seam is cut, the
 * contract is proven by the fixture and JSON adapters, and this is the next
 * piece of real work rather than a gap somebody discovers.
 */
export const httpArchiveAdapter: KnowledgeIngestionAdapter = {
  id: 'http-archive',
  displayName: 'Compressed archive over HTTPS (not implemented in this build)',

  async isAvailable() {
    return false;
  },

  async fetchBatch({ source }) {
    throw new Error(
      `source "${source.id}" needs the http-archive adapter, which is declared but not implemented ` +
        'in this build. Streaming decompression of a multi-gigabyte dump is real work with real ' +
        'memory and cost failure modes; nothing was fetched and no documents were fabricated. ' +
        'See the header of knowledge/adapters.ts.'
    );
  },
};

const ADAPTERS: readonly KnowledgeIngestionAdapter[] = [
  fixtureAdapter,
  httpJsonAdapter,
  httpArchiveAdapter,
];

export function getIngestionAdapter(id: string): KnowledgeIngestionAdapter | undefined {
  return ADAPTERS.find((a) => a.id === id);
}

export function listIngestionAdapters(): readonly KnowledgeIngestionAdapter[] {
  return ADAPTERS;
}
