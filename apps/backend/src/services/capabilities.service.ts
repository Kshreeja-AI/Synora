import { PROVIDER_REGISTRY } from '../ai/registry';
import { IMAGE_PROVIDER_REGISTRY } from '../ai/imageRegistry';
import { EMBEDDING_PROVIDER_REGISTRY } from '../embeddings';
import { VECTORDB_PROVIDER_REGISTRY } from '../vectordb';
import { TRANSPORT_REGISTRY } from '../mail/registry';
import { STORAGE_REGISTRY } from '../storage/registry';
import { VIRUS_SCAN_PROVIDER_REGISTRY } from '../files/virusScanRegistry';
import { getConfig } from '../config';

/**
 * Platform capability detection.
 *
 * Several Synora capabilities depend on credentials that are supplied per
 * deployment (AI providers, embedding providers, vector databases, mail
 * transports, object storage). Each subsystem already degrades honestly
 * when its credentials are absent — this service is the single read-only
 * place that answers "which of them are actually live right now, and what
 * is missing for the rest".
 *
 * It exists for operational truth: after credentials are added to an
 * environment, this is how an operator confirms the platform picked them
 * up, without reading logs or inferring from behavior. Every check is the
 * subsystem's own `isConfigured()` — no network calls, no duplicated
 * knowledge of which env var belongs to which provider, and no secret
 * values are ever read or returned.
 */

export type CapabilityStatus = 'active' | 'unconfigured';

export interface CapabilityReport {
  /** Stable machine-readable id, e.g. "semantic-memory". */
  id: string;
  /** Human-readable name for dashboards. */
  name: string;
  status: CapabilityStatus;
  /** The provider serving this capability, when one is configured. */
  provider: string | null;
  /**
   * Providers this deployment could use for the capability. Names only —
   * useful for "you could configure any one of these".
   */
  availableProviders: readonly string[];
  /** What the platform does while this capability is unconfigured. */
  degradedBehavior?: string;
}

export interface PlatformCapabilities {
  /** True when every capability required for a full production launch is live. */
  allActive: boolean;
  capabilities: readonly CapabilityReport[];
}

interface ConfigurableDescriptor {
  readonly id: string;
  isConfigured(): Promise<boolean>;
}

/**
 * First configured provider wins, mirroring each subsystem's own resolver
 * order. Returns null when none of them have credentials.
 */
async function firstConfigured(
  descriptors: readonly ConfigurableDescriptor[]
): Promise<string | null> {
  for (const descriptor of descriptors) {
    if (await descriptor.isConfigured()) {
      return descriptor.id;
    }
  }
  return null;
}

function report(
  id: string,
  name: string,
  provider: string | null,
  descriptors: readonly ConfigurableDescriptor[],
  degradedBehavior: string
): CapabilityReport {
  return {
    id,
    name,
    status: provider ? 'active' : 'unconfigured',
    provider,
    availableProviders: descriptors.map((d) => d.id),
    ...(provider ? {} : { degradedBehavior }),
  };
}

export async function getPlatformCapabilities(): Promise<PlatformCapabilities> {
  const [
    aiProvider,
    imageProvider,
    embeddingProvider,
    vectorProvider,
    storageProvider,
    virusScanProvider,
  ] = await Promise.all([
    firstConfigured(PROVIDER_REGISTRY),
    firstConfigured(IMAGE_PROVIDER_REGISTRY),
    firstConfigured(EMBEDDING_PROVIDER_REGISTRY),
    firstConfigured(VECTORDB_PROVIDER_REGISTRY),
    firstConfigured(STORAGE_REGISTRY),
    firstConfigured(VIRUS_SCAN_PROVIDER_REGISTRY),
  ]);

  // Mail is the one subsystem that is never auto-detected: `console` is
  // always valid, so the configured transport is an explicit choice rather
  // than "whichever has credentials" (see mail/registry.ts). Reporting the
  // resolved transport — and treating the console transport as not
  // production-ready — matches how it actually behaves.
  const mailTransportId = getConfig().mail.transport;
  const mailIsReal = mailTransportId !== 'console';

  const capabilities: CapabilityReport[] = [
    report(
      'text-generation',
      'AI text & code generation',
      aiProvider,
      PROVIDER_REGISTRY,
      'Chat and generation endpoints return a "no provider configured" error instead of a response.'
    ),
    {
      ...report(
        'semantic-memory',
        'Semantic memory search',
        embeddingProvider && vectorProvider ? `${embeddingProvider} + ${vectorProvider}` : null,
        EMBEDDING_PROVIDER_REGISTRY,
        'Memory retrieval ranks on lexical term overlap, importance, recency and access frequency; the semantic search endpoint returns 503. No approximate vectors are ever generated.'
      ),
      availableProviders: [
        ...EMBEDDING_PROVIDER_REGISTRY.map((d) => d.id),
        ...VECTORDB_PROVIDER_REGISTRY.map((d) => d.id),
      ],
    },
    report(
      'image-generation',
      'AI image generation',
      imageProvider,
      IMAGE_PROVIDER_REGISTRY,
      'The image generation endpoint returns 503 rather than a placeholder image; no fabricated image is ever produced.'
    ),
    report(
      'embeddings',
      'Embedding generation',
      embeddingProvider,
      EMBEDDING_PROVIDER_REGISTRY,
      'Any feature requiring embeddings fails with a clear "not configured" error rather than a fabricated vector.'
    ),
    report(
      'vector-database',
      'Vector storage',
      vectorProvider,
      VECTORDB_PROVIDER_REGISTRY,
      'Vectors cannot be stored or queried; semantic features stay disabled.'
    ),
    report(
      'object-storage',
      'File & asset storage',
      storageProvider,
      STORAGE_REGISTRY,
      'Uploads have nowhere to be stored.'
    ),
    report(
      'virus-scanning',
      'Upload malware scanning',
      virusScanProvider,
      VIRUS_SCAN_PROVIDER_REGISTRY,
      'Uploaded files are not scanned and are recorded as unscanned (never marked clean). In production they cannot be downloaded until a scanner is configured; other stages allow download unless VIRUS_SCAN_FORCE_BLOCK_UNSCANNED is set. Infected files are always blocked.'
    ),
    {
      id: 'email',
      name: 'Transactional email',
      status: mailIsReal ? 'active' : 'unconfigured',
      provider: mailIsReal ? mailTransportId : null,
      availableProviders: TRANSPORT_REGISTRY.map((t) => t.id),
      ...(mailIsReal
        ? {}
        : {
            degradedBehavior:
              'Emails (verification, password reset, invitations) are written to the server log instead of being delivered. Set MAIL_TRANSPORT to a real transport before launch.',
          }),
    },
  ];

  return {
    allActive: capabilities.every((c) => c.status === 'active'),
    capabilities,
  };
}
