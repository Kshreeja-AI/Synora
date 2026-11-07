import { getConfig } from '../config';
import { EMBEDDING_PROVIDER_REGISTRY } from '../embeddings/registry';
import { QUANTUM_PROVIDER_REGISTRY } from '../quantum/registry';
import { executableAlgorithms, QUANTUM_ALGORITHM_REGISTRY } from '../quantum/algorithms/registry';
import { VECTORDB_PROVIDER_REGISTRY } from '../vectordb/registry';
import { IMAGE_PROVIDER_REGISTRY } from './imageRegistry';
import { PROVIDER_REGISTRY } from './registry';
import { SEARCH_PROVIDER_REGISTRY } from './searchRegistry';
import { STT_PROVIDER_REGISTRY } from './sttRegistry';
import { TTS_PROVIDER_REGISTRY } from './ttsRegistry';
import { VIDEO_PROVIDER_REGISTRY } from './videoRegistry';

/**
 * One truthful answer to "what can Synora actually do right now?"
 *
 * ── WHY THIS IS NOT A NEW LAYER ──────────────────────────────────────────
 *
 * It reads the registries that already exist and calls the `isConfigured()`
 * each descriptor already publishes. It holds no state, registers nothing,
 * resolves nothing, and has no opinion any registry does not already have.
 * Removing this file would remove a REPORT, not a capability — which is the
 * test of whether something is a layer or a view.
 *
 * ── WHY THE STATES ARE NOT BOOLEANS ──────────────────────────────────────
 *
 * "Does image generation work?" has at least four different useful answers,
 * and a boolean forces three of them into the wrong bucket:
 *
 *   IMPLEMENTED   — the adapter exists and is wired. No credential.
 *   ENABLED       — a credential is present, so it will be selected.
 *   VERIFIED      — it has been exercised end to end and observed to work.
 *   EXPERIMENTAL  — runs, but not validated against anything independent.
 *   RESEARCH_ONLY — described for the record; no executable path.
 *   BLOCKED       — cannot run in this build whatever the operator does.
 *
 * VERIFIED is deliberately never inferred. It is the rung that requires a
 * human or a test to have actually run the thing, so this module reports at
 * most ENABLED from configuration alone — inferring VERIFIED from the
 * presence of a key would be exactly the "configured is not verified"
 * failure `SYNORA_FOUNDER_OS.md` names.
 *
 * ── AND IT NEVER TOUCHES A CREDENTIAL VALUE ──────────────────────────────
 *
 * `isConfigured()` is presence-only and network-free. Nothing here reads,
 * logs, returns or fingerprints a secret, and nothing here spends money: no
 * probe, no test generation, no paid call. Credential VALIDITY is a separate,
 * explicit operation (`checkProviderReadiness` in `./verification.ts`), kept
 * separate precisely because it costs a network round-trip and belongs where
 * a human is waiting for the answer.
 */

export type CapabilityState =
  /** No adapter exists. A code change, not a credential. */
  | 'NOT_IMPLEMENTED'
  | 'IMPLEMENTED'
  | 'ENABLED'
  | 'VERIFIED'
  | 'EXPERIMENTAL'
  | 'RESEARCH_ONLY'
  /** An adapter exists but cannot run in this build whatever is configured. */
  | 'BLOCKED';

export interface CapabilityProviderRow {
  readonly id: string;
  readonly displayName: string;
  /** A secret or endpoint is present. Says NOTHING about whether it works. */
  readonly configured: boolean;
  /** Present only where the descriptor declares it. */
  readonly metering?: 'metered' | 'unmetered';
  /** Set when the provider cannot run in this build regardless of credentials. */
  readonly unsupportedReason?: string;
}

export interface CapabilityRow {
  readonly capability: string;
  readonly state: CapabilityState;
  readonly providers: readonly CapabilityProviderRow[];
  /** Environment variable NAMES only — never values. */
  readonly credentialsRequired: readonly string[];
  /** One line a non-specialist can act on. */
  readonly note: string;
}

/** Minimal shape shared by every capability registry's descriptor. */
interface MinimalDescriptor {
  readonly id: string;
  readonly displayName: string;
  readonly metering?: 'metered' | 'unmetered';
  readonly unsupportedReason?: string;
  isConfigured(): Promise<boolean>;
}

async function rowsFor(registry: readonly MinimalDescriptor[]): Promise<CapabilityProviderRow[]> {
  return Promise.all(
    registry.map(async (descriptor) => ({
      id: descriptor.id,
      displayName: descriptor.displayName,
      // An unsupported provider is never "configured": reporting it as such
      // would put it in a readiness list it can never actually serve from.
      configured: descriptor.unsupportedReason ? false : await descriptor.isConfigured(),
      ...(descriptor.metering ? { metering: descriptor.metering } : {}),
      ...(descriptor.unsupportedReason ? { unsupportedReason: descriptor.unsupportedReason } : {}),
    }))
  );
}

/** ENABLED when something is configured; IMPLEMENTED when the seam exists but nothing is. */
function stateFromProviders(providers: readonly CapabilityProviderRow[]): CapabilityState {
  if (providers.length === 0) return 'BLOCKED';
  if (providers.some((p) => p.configured)) return 'ENABLED';
  if (providers.every((p) => p.unsupportedReason)) return 'BLOCKED';
  return 'IMPLEMENTED';
}

export async function checkCapabilityReadiness(): Promise<readonly CapabilityRow[]> {
  const config = getConfig();

  const text = await rowsFor(PROVIDER_REGISTRY);
  const image = await rowsFor(IMAGE_PROVIDER_REGISTRY);
  const video = await rowsFor(VIDEO_PROVIDER_REGISTRY);
  const speech = await rowsFor(TTS_PROVIDER_REGISTRY);
  const stt = await rowsFor(STT_PROVIDER_REGISTRY);
  const search = await rowsFor(SEARCH_PROVIDER_REGISTRY);
  const embeddings = await rowsFor(EMBEDDING_PROVIDER_REGISTRY);
  const vector = await rowsFor(VECTORDB_PROVIDER_REGISTRY);
  const quantum = await rowsFor(QUANTUM_PROVIDER_REGISTRY);

  const rows: CapabilityRow[] = [
    {
      capability: 'text',
      state: stateFromProviders(text),
      providers: text,
      credentialsRequired: [
        'ANTHROPIC_API_KEY',
        'OPENAI_API_KEY',
        'GOOGLE_AI_API_KEY',
        'GROQ_API_KEY',
        'DEEPSEEK_API_KEY',
        'OPENROUTER_API_KEY',
        'TOGETHER_API_KEY',
        'XAI_API_KEY',
        'AZURE_OPENAI_API_KEY',
        'SELF_HOSTED_TEXT_BASE_URL',
        'SELF_HOSTED_TEXT_MODEL',
        'OLLAMA_BASE_URL',
      ],
      note: 'Any ONE of these is enough. A self-hosted or Ollama endpoint costs nothing per token.',
    },
    {
      capability: 'vision',
      // CORRECTED, and worth being blunt about: an earlier report called this
      // IMPLEMENTED because the vendors support it and because
      // `ai/core/types.ts` contains an `AIContent` union with an image member.
      // But `ai/core/` is dormant scaffolding wired to no route, and the LIVE
      // contract — `TextGenerationRequest`, `ConversationMessage.content` — is
      // `string`. There is no path by which an image reaches a model. A
      // capability whose type system cannot express its input is not
      // implemented, whatever the vendor supports.
      state: 'NOT_IMPLEMENTED',
      providers: [],
      credentialsRequired: [],
      note:
        'No image-input path exists. `ConversationMessage.content` is a string, so a picture ' +
        'cannot reach a model. Adding it means extending the text contract — a code change, ' +
        'not a credential.',
    },
    {
      capability: 'image',
      state: stateFromProviders(image),
      providers: image,
      credentialsRequired: ['OPENAI_API_KEY'],
      note: 'Adapter implemented and unexercised. No local image runtime is present — see the launch report.',
    },
    {
      capability: 'video',
      state: stateFromProviders(video),
      providers: video,
      credentialsRequired: ['REPLICATE_API_KEY'],
      note: 'Adapter implemented and unexercised. Local generation is not practical on this machine.',
    },
    {
      capability: 'text-to-speech',
      state: stateFromProviders(speech),
      providers: speech,
      credentialsRequired: ['OPENAI_API_KEY'],
      note: 'One adapter (OpenAI). Fish Audio and other TTS vendors have no adapter in this build.',
    },
    {
      capability: 'speech-to-text',
      // Its own row rather than folded into "speech", because a combined row
      // would be true of half of it and false of the half a founder is more
      // likely to want. ENABLED only means an endpoint URL is set; no
      // transcription has been run by this report.
      state: stateFromProviders(stt),
      providers: stt,
      credentialsRequired: ['STT_BASE_URL', 'STT_MODEL', 'STT_API_KEY'],
      note:
        'OpenAI-compatible /v1/audio/transcriptions adapter (Whisper). Set STT_BASE_URL to a ' +
        'faster-whisper-server or a hosted Whisper endpoint; STT_API_KEY only if it needs one. ' +
        'Unit-tested against a fake client; not exercised against a real endpoint.',
    },
    {
      capability: 'content-safety',
      // `ai/core/hooks.ts` mentions moderation, but `ai/core/` is dormant
      // scaffolding wired to no route. Reporting it as implemented on the
      // strength of a mention would be the worst possible error in this row:
      // a safety control everyone believes exists.
      state: 'NOT_IMPLEMENTED',
      providers: [],
      credentialsRequired: [],
      note:
        'No moderation or content-safety adapter is wired to any live path. Nothing screens ' +
        'model input or output today. NVIDIA Nemotron Content Safety would need a new adapter.',
    },
    {
      capability: 'embeddings',
      state: stateFromProviders(embeddings),
      providers: embeddings,
      credentialsRequired: [
        'OPENAI_API_KEY',
        'VOYAGE_API_KEY',
        'COHERE_API_KEY',
        'SELF_HOSTED_EMBEDDINGS_BASE_URL',
        'OLLAMA_BASE_URL',
      ],
      note: 'A self-hosted or Ollama embedding endpoint costs nothing per token and is enough for RAG.',
    },
    {
      capability: 'vector-storage',
      state: stateFromProviders(vector),
      providers: vector,
      credentialsRequired: [
        // Listed FIRST because it is the only one that costs nothing and
        // needs no account: pgvector runs inside the PostgreSQL Synora
        // already has. It is opt-in rather than automatic so it cannot
        // silently win auto-detection over a purpose-built vector database
        // in a deployment where both are reachable.
        'VECTORDB_PGVECTOR_ENABLED',
        'PINECONE_API_KEY',
        'QDRANT_URL',
        'WEAVIATE_URL',
        'MILVUS_ADDRESS',
      ],
      note: 'Set VECTORDB_PGVECTOR_ENABLED=true to use the existing PostgreSQL database — no account, no credential, no cost.',
    },
    {
      capability: 'rag',
      // The pipeline is verified by tests; whether it can RUN depends on the
      // two capabilities beneath it, so its state is derived rather than
      // asserted. A "VERIFIED" RAG row above an unconfigured embedder would
      // be true about the code and false about the system.
      state: embeddings.some((p) => p.configured) && vector.some((p) => p.configured) ? 'ENABLED' : 'IMPLEMENTED',
      providers: [],
      credentialsRequired: [],
      note: 'Ingestion, policy gate, chunking, retrieval and citation are implemented and unit-tested. Enabled once an embedding provider and a vector store are both configured.',
    },
    {
      capability: 'search',
      state: stateFromProviders(search),
      providers: search,
      credentialsRequired: ['SEARCH_SEARXNG_BASE_URL'],
      note:
        'Wikipedia (keyless, on by default) plus optional self-hosted SearXNG. ENABLED means a ' +
        'provider is switched on, not that a query has succeeded. Semantic search over ingested ' +
        'knowledge is the `rag` row above.',
    },
    {
      capability: 'document-processing',
      // pdf-parse is a shipped dependency and the documents route uses it —
      // no credential, no network, no provider.
      state: 'ENABLED',
      providers: [],
      credentialsRequired: [],
      note: 'PDF and text extraction run locally with no credential. Chunking is shared with the RAG path.',
    },
    {
      capability: 'tools',
      state: text.some((p) => p.configured) ? 'ENABLED' : 'IMPLEMENTED',
      providers: text.filter((p) => p.configured),
      credentialsRequired: [],
      note: "Provider-native tool calling, plus Synora's own planner. Rides whichever text provider is active.",
    },
    {
      capability: 'quantum',
      // The local simulator always resolves, so this is never worse than
      // ENABLED — and never better, because `VERIFIED` here would mean
      // hardware, which nothing in this build has touched.
      state: 'ENABLED',
      providers: quantum,
      credentialsRequired: ['IBM_QUANTUM_API_TOKEN'],
      note:
        `Local simulator (level 0) always available, ${executableAlgorithms().length} of ` +
        `${QUANTUM_ALGORITHM_REGISTRY.length} algorithms executable. Execution ceiling is level ` +
        `${config.quantum.maxExecutionLevel}; paid QPU ${config.quantum.paidQpuEnabled ? 'ENABLED' : 'disabled'}.`,
    },
  ];

  return rows;
}

/**
 * The quantum sub-report, which has questions no other capability has: is the
 * simulator reachable, is a cloud provider configured, and — the one that
 * costs money — is paid execution switched on.
 */
export interface QuantumReadiness {
  readonly simulatorAvailable: boolean;
  readonly localMaxQubits: number;
  readonly cloudConfigured: readonly string[];
  readonly maxExecutionLevel: number;
  readonly paidQpuEnabled: boolean;
  readonly maxCostPerExecutionCents: number;
  readonly executableAlgorithms: readonly string[];
  readonly describedAlgorithms: number;
}

export async function checkQuantumReadiness(): Promise<QuantumReadiness> {
  const config = getConfig().quantum;
  const configured: string[] = [];
  for (const descriptor of QUANTUM_PROVIDER_REGISTRY) {
    if (descriptor.id === 'local-simulator' || descriptor.unsupportedReason) continue;
    if (await descriptor.isConfigured()) configured.push(descriptor.id);
  }

  return {
    simulatorAvailable: true,
    localMaxQubits: config.localMaxQubits,
    cloudConfigured: configured,
    maxExecutionLevel: config.maxExecutionLevel,
    paidQpuEnabled: config.paidQpuEnabled,
    maxCostPerExecutionCents: config.maxCostPerExecutionCents,
    executableAlgorithms: executableAlgorithms().map((a) => a.id),
    describedAlgorithms: QUANTUM_ALGORITHM_REGISTRY.length,
  };
}
