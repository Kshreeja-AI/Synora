import type { KnowledgeSource } from './types';

/**
 * The source registry.
 *
 * ── WHY THE LIST INCLUDES THINGS THAT ARE BLOCKED ────────────────────────
 *
 * A catalogue of only the permitted sources would be a shorter, more
 * flattering document that fails at its actual job. The interesting entries
 * are the ones marked `blocked`: they are the sources someone will eventually
 * propose, and the reason they were refused needs to exist in writing before
 * that conversation, not during it.
 *
 * Common Crawl is the clearest case. It is enormous, free, and trivially
 * downloadable, and it consists largely of material its publishers still hold
 * copyright in — Common Crawl distributes it, which is not the same as
 * licensing it. It is here, blocked, precisely because "we could just use
 * Common Crawl" is the single most likely future suggestion.
 *
 * ── PER-ITEM LICENCES ────────────────────────────────────────────────────
 *
 * Several entries set `perItemLicenceCheckRequired`. arXiv is the canonical
 * example: the METADATA is CC0, and the papers are not — authors choose from
 * several licences and many retain all rights. Treating "arXiv is open" as a
 * property of the corpus is a mistake that produces a corpus nobody may use.
 *
 * ── REGISTRATION IS DYNAMIC, THE SEED IS STATIC ──────────────────────────
 *
 * The catalogue below is the shipped seed. `registerKnowledgeSource()` adds
 * to a process-local registry so a deployment (or a test) can introduce a
 * source without editing this file — which is what makes the registry an
 * extension point rather than a hardcoded list. Registration validates; it
 * does not fetch, and it does not grant a licence.
 */
export const DATASET_CATALOG: readonly KnowledgeSource[] = [
  {
    id: 'arxiv-metadata',
    name: 'arXiv metadata',
    type: 'scientific-literature',
    url: 'https://arxiv.org/help/api',
    domain: 'scientific',
    adapterId: 'http-json',
    licence: 'CC0-1.0',
    licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    allowedUsage: 'Metadata is CC0 and freely reusable. Full texts are licensed per paper.',
    attributionRequired: false,
    updateFrequency: 'daily',
    trustLevel: 'peer-reviewed',
    perItemLicenceCheckRequired: true,
    languages: ['en'],
    approximateSize: '~2.4M records',
    rationale:
      'Titles, abstracts and classifications across physics, mathematics and computer science — ' +
      'the highest-value scientific index that is unambiguously openly licensed.',
    enabled: true,
    status: 'planned',
  },
  {
    id: 'pubmed-central-oa',
    name: 'PubMed Central Open Access Subset',
    type: 'scientific-literature',
    url: 'https://www.ncbi.nlm.nih.gov/pmc/tools/openftlist/',
    domain: 'scientific',
    adapterId: 'http-json',
    licence: 'CC-BY-4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
    allowedUsage: 'Per-article licence; only the CC-BY portion is ingestible under Synora policy.',
    attributionRequired: true,
    updateFrequency: 'daily',
    trustLevel: 'peer-reviewed',
    // The OA subset mixes CC-BY, CC-BY-NC and CC-BY-ND. Only the first is
    // ingestible under `./licences.ts`, so a blanket import would pull in
    // material Synora may not use.
    perItemLicenceCheckRequired: true,
    languages: ['en'],
    approximateSize: '~5M full-text articles',
    rationale: 'Full-text biomedical literature; the largest openly licensed scientific full-text corpus.',
    enabled: true,
    status: 'planned',
  },
  {
    id: 'wikipedia',
    name: 'Wikipedia (all languages)',
    type: 'encyclopaedia',
    url: 'https://dumps.wikimedia.org/',
    domain: 'encyclopaedic',
    adapterId: 'http-archive',
    licence: 'CC-BY-SA-4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    allowedUsage: 'Reuse permitted with attribution; derived works inherit ShareAlike.',
    attributionRequired: true,
    updateFrequency: 'weekly',
    trustLevel: 'community',
    perItemLicenceCheckRequired: false,
    languages: ['en', 'es', 'fr', 'de', 'hi', 'zh', 'ar', 'pt', 'ru', 'ja'],
    approximateSize: '~22 GB (English, current revisions)',
    rationale: 'Broad general knowledge with citations, in a structure that chunks cleanly.',
    enabled: true,
    status: 'planned',
  },
  {
    id: 'wikidata',
    name: 'Wikidata',
    type: 'dataset',
    url: 'https://www.wikidata.org/wiki/Wikidata:Database_download',
    domain: 'encyclopaedic',
    adapterId: 'http-archive',
    licence: 'CC0-1.0',
    allowedUsage: 'Public domain dedication; no attribution obligation.',
    attributionRequired: false,
    updateFrequency: 'daily',
    trustLevel: 'community',
    perItemLicenceCheckRequired: false,
    languages: ['multilingual'],
    approximateSize: '~100M items',
    rationale: 'Structured entity data under CC0 — usable for grounding without attribution obligations.',
    enabled: true,
    status: 'planned',
  },
  {
    id: 'project-gutenberg',
    name: 'Project Gutenberg',
    type: 'public-domain-books',
    url: 'https://www.gutenberg.org/',
    domain: 'literature',
    adapterId: 'http-archive',
    licence: 'public-domain',
    allowedUsage: 'Public domain in the US; status varies by jurisdiction and must be verified.',
    attributionRequired: false,
    updateFrequency: 'monthly',
    trustLevel: 'curated',
    perItemLicenceCheckRequired: true,
    languages: ['en', 'fr', 'de', 'es', 'it'],
    approximateSize: '~70,000 books',
    rationale: 'Long-form public-domain text, useful for language and literary grounding.',
    enabled: true,
    status: 'planned',
  },
  {
    id: 'qm9',
    name: 'QM9 quantum chemistry dataset',
    type: 'dataset',
    url: 'https://doi.org/10.6084/m9.figshare.978904',
    domain: 'quantum-computing',
    adapterId: 'http-archive',
    licence: 'CC-BY-4.0',
    allowedUsage: 'Reuse permitted with attribution.',
    attributionRequired: true,
    updateFrequency: 'static',
    trustLevel: 'peer-reviewed',
    perItemLicenceCheckRequired: false,
    languages: ['n/a'],
    approximateSize: '134k molecules',
    rationale:
      'DFT-computed properties for small organic molecules — the standard benchmark for the ' +
      'ground-state-energy problems VQE actually targets, and therefore the right place to ' +
      'measure whether it helps.',
    enabled: true,
    status: 'planned',
  },
  {
    id: 'qiskit-textbook',
    name: 'Qiskit textbook and documentation',
    type: 'documentation',
    url: 'https://github.com/Qiskit',
    domain: 'quantum-computing',
    adapterId: 'http-archive',
    licence: 'Apache-2.0',
    allowedUsage: 'Permissive reuse with attribution and notice of changes.',
    attributionRequired: true,
    updateFrequency: 'weekly',
    trustLevel: 'authoritative',
    perItemLicenceCheckRequired: false,
    languages: ['en'],
    approximateSize: '~50 MB',
    rationale:
      'Authoritative quantum-computing reference under a permissive licence — and the ' +
      'documentation for the OpenQASM interchange Synora emits.',
    enabled: true,
    status: 'planned',
  },
  {
    id: 'openml',
    name: 'OpenML datasets',
    type: 'benchmark',
    url: 'https://www.openml.org/',
    domain: 'machine-learning',
    adapterId: 'http-json',
    licence: 'CC-BY-4.0',
    allowedUsage: 'Per-dataset licence; verify each before ingestion.',
    attributionRequired: true,
    updateFrequency: 'weekly',
    trustLevel: 'curated',
    perItemLicenceCheckRequired: true,
    languages: ['n/a'],
    approximateSize: '~21,000 datasets',
    rationale:
      'Standard tabular benchmarks — the classical baselines any quantum-kernel claim has to beat.',
    enabled: true,
    status: 'planned',
  },
  {
    id: 'data-gov',
    name: 'data.gov (US federal open data)',
    type: 'government-open-data',
    url: 'https://data.gov/',
    domain: 'government',
    adapterId: 'http-json',
    licence: 'government-open-data',
    allowedUsage: 'Portal-specific terms. Requires human review before ingestion.',
    attributionRequired: true,
    updateFrequency: 'daily',
    trustLevel: 'authoritative',
    perItemLicenceCheckRequired: true,
    languages: ['en'],
    approximateSize: '~300,000 datasets',
    rationale: 'Authoritative public statistics and reference data.',
    enabled: true,
    status: 'planned',
  },
  {
    id: 'eu-open-data',
    name: 'European Union Open Data Portal',
    type: 'government-open-data',
    url: 'https://data.europa.eu/',
    domain: 'government',
    adapterId: 'http-json',
    licence: 'government-open-data',
    allowedUsage: 'Portal-specific terms. Requires human review before ingestion.',
    attributionRequired: true,
    updateFrequency: 'daily',
    trustLevel: 'authoritative',
    perItemLicenceCheckRequired: true,
    languages: ['multilingual'],
    approximateSize: '~1.5M datasets',
    rationale: 'European public-sector data, mostly under CC-BY-equivalent national terms.',
    enabled: true,
    status: 'planned',
  },
  {
    id: 'synora-fixture',
    name: 'Synora deterministic test fixture',
    type: 'internal-fixture',
    url: 'internal://fixtures/knowledge',
    domain: 'test-fixture',
    adapterId: 'fixture',
    licence: 'CC0-1.0',
    allowedUsage: 'Written for this repository; dedicated to the public domain.',
    attributionRequired: false,
    updateFrequency: 'static',
    trustLevel: 'curated',
    perItemLicenceCheckRequired: false,
    languages: ['en'],
    approximateSize: '6 documents, ~8 KB',
    rationale:
      'A tiny, deterministic corpus written for this repository so the whole ingestion and ' +
      'retrieval path is testable on a laptop with no network, no credential and no download. ' +
      'It exists BECAUSE the real sources must never be fetched by a test.',
    enabled: true,
    status: 'ingested',
  },

  /* ── Assessed and refused ───────────────────────────────────────────── */

  {
    id: 'common-crawl',
    name: 'Common Crawl',
    type: 'dataset',
    url: 'https://commoncrawl.org/',
    domain: 'encyclopaedic',
    adapterId: 'http-archive',
    licence: 'UNKNOWN',
    allowedUsage: 'None established.',
    attributionRequired: true,
    updateFrequency: 'monthly',
    trustLevel: 'unverified',
    perItemLicenceCheckRequired: true,
    languages: ['multilingual'],
    approximateSize: '~400 TB',
    rationale: 'The largest freely downloadable web corpus, and the one most often proposed.',
    enabled: false,
    status: 'blocked',
    blockedReason:
      'Common Crawl DISTRIBUTES the crawl; it does not licence the underlying pages, whose ' +
      'publishers retain copyright. Downloadability is not permission, and this entry exists ' +
      'so that stays written down rather than being re-litigated later.',
  },
  {
    id: 'model-outputs',
    name: 'Outputs of other AI models',
    type: 'dataset',
    url: 'n/a',
    domain: 'machine-learning',
    adapterId: 'none',
    licence: 'proprietary',
    allowedUsage: 'None. Prohibited by provider terms.',
    attributionRequired: true,
    updateFrequency: 'continuous',
    trustLevel: 'unverified',
    perItemLicenceCheckRequired: false,
    languages: ['multilingual'],
    approximateSize: 'n/a',
    rationale:
      'Listed only to record the decision — synthetic corpora generated from Claude, GPT or ' +
      'Gemini to train or ground a competing system.',
    enabled: false,
    status: 'blocked',
    blockedReason:
      "Prohibited by every major provider's terms, and it is the \"acquire another model's " +
      'knowledge" shortcut this whole module exists to not take. Synora ingests openly licensed ' +
      'material; it does not distil other people\'s models.',
  },
];

/**
 * Sources registered at runtime, on top of the shipped seed.
 *
 * Process-local and deliberately so: a source registry that persisted would
 * be a second place licences live, and the licence table is already the one
 * place. Registration is how a deployment or a test introduces a source; it
 * confers no permission, and the policy gate judges it exactly like any other.
 */
const runtimeSources = new Map<string, KnowledgeSource>();

export class InvalidKnowledgeSourceError extends Error {
  constructor(field: string, detail: string) {
    super(`Cannot register knowledge source: ${field} ${detail}`);
    this.name = 'InvalidKnowledgeSourceError';
  }
}

/**
 * Register a source. Validates the fields that decide whether ingestion is
 * lawful and traceable, and refuses anything missing one.
 *
 * It does NOT validate that the URL resolves, that the adapter exists, or
 * that the licence is accurate — none of those is knowable here, and
 * pretending otherwise would turn registration into a false assurance.
 */
export function registerKnowledgeSource(source: KnowledgeSource): KnowledgeSource {
  if (!source.id || !/^[a-z0-9][a-z0-9-]*$/.test(source.id)) {
    throw new InvalidKnowledgeSourceError('id', 'must be lower-case kebab-case and non-empty');
  }
  if (getDatasetSource(source.id)) {
    throw new InvalidKnowledgeSourceError('id', `"${source.id}" is already registered`);
  }
  if (!source.name || !source.url || !source.adapterId) {
    throw new InvalidKnowledgeSourceError('name/url/adapterId', 'are all required');
  }
  if (!source.licence) {
    // The field is typed, so this only fires on untyped input crossing the
    // boundary — which is exactly where an unlicensed source would enter.
    throw new InvalidKnowledgeSourceError('licence', 'is required; there is no default');
  }
  if (!source.allowedUsage) {
    throw new InvalidKnowledgeSourceError('allowedUsage', 'is required — state what the terms permit');
  }
  if (source.languages.length === 0) {
    throw new InvalidKnowledgeSourceError('languages', 'must list at least one language');
  }

  runtimeSources.set(source.id, source);
  return source;
}

/** Test seam. Never called by application code. */
export function resetRuntimeSourcesForTests(): void {
  runtimeSources.clear();
}

export function getDatasetSource(id: string): KnowledgeSource | undefined {
  return runtimeSources.get(id) ?? DATASET_CATALOG.find((s) => s.id === id);
}

export function allKnowledgeSources(): readonly KnowledgeSource[] {
  return [...DATASET_CATALOG, ...runtimeSources.values()];
}

/** Sources that are neither blocked nor operationally disabled. */
export function ingestibleSources(): readonly KnowledgeSource[] {
  return allKnowledgeSources().filter((s) => s.status !== 'blocked' && s.enabled);
}
