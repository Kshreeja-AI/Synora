import OpenAI from 'openai';
import { SDK_CLIENT_OPTIONS } from './providers/sdk-options';
import { OpenAICompatibleTextProvider } from './providers/openaiCompatible.provider';
import { generateWithResilience } from './textResilience';
import { NoProviderConfiguredError } from './types';
import type { TextGenerationRequest, TextGenerationResult } from './types';
import { secretsManager } from '../secrets';
import { getConfig } from '../config';
import { logger } from '../utils/logger';

/**
 * Free-tier fallback chain for the public, unauthenticated assistant.
 *
 * Order comes from config (`ai.freeTier.chain`, env AI_FREE_TIER_CHAIN) and
 * defaults to Groq -> Cloudflare Workers AI -> OpenRouter (':free' models
 * only) -> Mistral -> SambaNova. Every provider here speaks the OpenAI chat
 * protocol, so this reuses the existing `OpenAICompatibleTextProvider` adapter
 * and `generateWithResilience` (per-provider circuit breaker, pacing, timeout)
 * rather than adding a second client stack. Callers never name a vendor; they
 * call `generateWithFreeTierChain()` and get a result or a typed error.
 *
 * What makes this chain FREE-ONLY (the premise of AI_GLOBAL_MAX_COST_PER_DAY_CENTS=0):
 *  - only keys the operator has configured are tried; there is no paid default;
 *  - OpenRouter is used only with a model id ending in ':free';
 *  - the caller records spend with knownCostCents: 0, and tokens still count
 *    against AI_GLOBAL_MAX_TOKENS_PER_DAY.
 * A provider that bills on its free plan is the operator's account setting, not
 * something this code can prove; see SYNORA_OPERATIONS.md.
 *
 * Models and base URLs are configuration. Each model id is additionally looked
 * up in the provider's own model listing (cached) so a retired model is
 * skipped, with a log line naming the provider, instead of failing every call.
 */

type ProviderId = 'groq' | 'cloudflare' | 'openrouter' | 'mistral' | 'sambanova';

interface Target {
  id: ProviderId;
  apiKey: string;
  baseUrl: string;
  model: string;
}

const SECRET_KEYS: Record<ProviderId, string> = {
  groq: 'GROQ_API_KEY',
  cloudflare: 'CLOUDFLARE_API_TOKEN',
  openrouter: 'OPENROUTER_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  sambanova: 'SAMBANOVA_API_KEY',
};

/**
 * Providers whose free plan may train on API prompts (Mistral "Experiment"
 * plan, per its help centre, checked 2026-11-08). They join the chain only
 * after the operator confirms the opt-out in FREE_TIER_TRAINING_OPTOUT_CONFIRMED.
 */
const TRAINS_ON_FREE_PLAN: ReadonlySet<ProviderId> = new Set<ProviderId>(['mistral']);

/** Every configured provider failed (or was skipped) for this request. */
export class FreeTierExhaustedError extends Error {
  constructor(readonly attempted: readonly string[]) {
    super(`All configured free-tier providers failed: ${attempted.join(', ')}.`);
    this.name = 'FreeTierExhaustedError';
  }
}

function isProviderId(id: string): id is ProviderId {
  return id in SECRET_KEYS;
}

async function resolveTarget(id: ProviderId): Promise<Target | null> {
  const { ai } = getConfig();
  const ft = ai.freeTier;
  if (TRAINS_ON_FREE_PLAN.has(id) && !ft.trainingOptOutConfirmed.includes(id)) return null;
  const apiKey = await secretsManager.tryGetReal(SECRET_KEYS[id], `ai:free-tier:${id}`);
  if (!apiKey) return null;

  let baseUrl = ft.baseUrls[id];
  if (id === 'cloudflare') {
    if (!ft.cloudflareAccountId) return null;
    baseUrl = baseUrl.replace('{accountId}', encodeURIComponent(ft.cloudflareAccountId));
  }
  const model = id === 'groq' ? ai.groqModel : ft.models[id];

  // OpenRouter bills non-free models. The chain exists to cost nothing, so a
  // model without the ':free' suffix is refused rather than trusted.
  if (id === 'openrouter' && !model.endsWith(':free')) {
    logger.warn('[FreeTier] OpenRouter model is not a :free model; provider skipped', { provider: id });
    return null;
  }
  return { id, apiKey, baseUrl, model };
}

// ---- runtime model check -------------------------------------------------

type Availability = 'listed' | 'absent' | 'unknown';

const LIST_TIMEOUT_MS = 5_000;
const CLOUDFLARE_PAGE_SIZE = 100;
const listingCache = new Map<string, { at: number; ids: Set<string> | null; truncated: boolean }>();

function listingUrl(target: Target): string {
  if (target.id === 'cloudflare') {
    // Workers AI lists models under /ai/models/search, not under the OpenAI-compat /ai/v1.
    const base = target.baseUrl.replace(/\/ai\/v1\/?$/, '');
    return `${base}/ai/models/search?task=Text%20Generation&per_page=${CLOUDFLARE_PAGE_SIZE}`;
  }
  return `${target.baseUrl.replace(/\/+$/, '')}/models`;
}

function extractIds(body: unknown): Set<string> {
  const ids = new Set<string>();
  const root = body as { data?: unknown; result?: unknown } | null;
  const rows = Array.isArray(root?.data) ? root.data : Array.isArray(root?.result) ? root.result : [];
  for (const row of rows as Array<{ id?: unknown; name?: unknown }>) {
    if (typeof row?.id === 'string') ids.add(row.id);
    if (typeof row?.name === 'string') ids.add(row.name);
  }
  return ids;
}

async function modelAvailability(target: Target): Promise<Availability> {
  const ttl = getConfig().ai.freeTier.modelCheckTtlMs;
  const cacheKey = `${target.id}:${target.model}`;
  const cached = listingCache.get(cacheKey);
  let entry = cached && Date.now() - cached.at < ttl ? cached : undefined;

  if (!entry) {
    try {
      const res = await fetch(listingUrl(target), {
        headers: { Authorization: `Bearer ${target.apiKey}` },
        signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
      });
      if (!res.ok) {
        // A listing outage must not take the provider down with it; log status only.
        logger.warn('[FreeTier] model listing unavailable; trying the provider anyway', {
          provider: target.id,
          status: res.status,
        });
        entry = { at: Date.now(), ids: null, truncated: false };
      } else {
        const ids = extractIds(await res.json());
        entry = { at: Date.now(), ids, truncated: target.id === 'cloudflare' && ids.size >= CLOUDFLARE_PAGE_SIZE };
      }
    } catch {
      entry = { at: Date.now(), ids: null, truncated: false };
    }
    listingCache.set(cacheKey, entry);
  }

  if (!entry.ids || entry.ids.size === 0) return 'unknown';
  if (entry.ids.has(target.model)) return 'listed';
  return entry.truncated ? 'unknown' : 'absent';
}

export function resetFreeTierChainForTests(): void {
  listingCache.clear();
}

// ---- the chain -------------------------------------------------------------

export async function generateWithFreeTierChain(
  request: TextGenerationRequest
): Promise<TextGenerationResult> {
  const ft = getConfig().ai.freeTier;
  const attempted: string[] = [];

  for (const rawId of ft.chain) {
    if (!isProviderId(rawId)) {
      logger.warn('[FreeTier] unknown provider id in AI_FREE_TIER_CHAIN; skipped');
      continue;
    }
    const target = await resolveTarget(rawId);
    if (!target) continue;

    if ((await modelAvailability(target)) === 'absent') {
      logger.warn('[FreeTier] configured model is not in the provider listing; provider skipped', {
        provider: target.id,
      });
      attempted.push(target.id);
      continue;
    }

    attempted.push(target.id);
    try {
      const provider = new OpenAICompatibleTextProvider(
        target.id,
        new OpenAI({
          ...SDK_CLIENT_OPTIONS,
          timeout: ft.callTimeoutMs,
          apiKey: target.apiKey,
          baseURL: target.baseUrl,
        }),
        target.model
      );
      // One attempt per provider: failing over is the retry. The per-provider
      // circuit breaker still counts the failure.
      return await generateWithResilience(
        provider,
        { ...request, model: target.model },
        { timeoutMs: ft.callTimeoutMs, retry: { attempts: 1, backoffMs: 0, backoffStrategy: 'fixed' } }
      );
    } catch (error) {
      // Class name only: a provider's message has been seen to echo credentials.
      logger.warn('[FreeTier] provider failed; trying the next one', {
        provider: target.id,
        errorType: error instanceof Error ? error.name : typeof error,
      });
    }
  }

  if (attempted.length === 0) {
    throw new NoProviderConfiguredError('text-generation', ft.chain);
  }
  throw new FreeTierExhaustedError(attempted);
}
