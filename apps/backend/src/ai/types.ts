/**
 * Provider-agnostic AI capability contracts.
 *
 * The rest of the application (routes, services) depends only on the types
 * and functions in this module and in `./index.ts` — never on a concrete
 * provider. Adding, removing, or swapping a provider is entirely contained
 * within `./providers/*`; nothing outside this directory should ever import
 * `@anthropic-ai/sdk`, `openai`, `@google/generative-ai`, or
 * `@aws-sdk/client-bedrock-runtime` directly.
 *
 * `AICapability` is deliberately an open-ended union with room already
 * reserved for capabilities beyond Release 1's text/code generation (image,
 * video, audio, speech, embeddings, agents). A provider declares which
 * capabilities it implements via `AIProvider.capabilities`; the resolver
 * (`./resolver.ts`) only ever selects among providers that declare the
 * capability being requested. Adding e.g. image generation later means
 * adding an `ImageGenerationRequest`/`ImageGenerationResult` pair and an
 * `ImageGenerationProvider` interface below, and providers implementing it —
 * it does not require changing `TextGenerationProvider`, the resolver's core
 * selection logic, or any provider that only ever supported text generation.
 */

export type AICapability =
  | 'text-generation'
  | 'code-generation'
  // Reserved for future capabilities — intentionally not implemented in
  // Release 1, but the type is listed here so provider descriptors and the
  // resolver's capability-filtering logic never need to change shape when
  // these are added, only extended.
  | 'image-generation'
  | 'video-generation'
  | 'audio-generation'
  | 'speech-to-text'
  | 'text-to-speech'
  | 'embeddings'
  | 'agent';

/**
 * `text-generation` and `code-generation` share one request/response shape:
 * "code" is not a different wire protocol, it is a different `mode` that
 * providers may use to select a more code-specialized model or system
 * prompt. This matches how every provider in scope actually works — none of
 * them expose a distinct "code" endpoint separate from chat/text completion.
 */
export type TextGenerationMode = 'text' | 'code';

/**
 * A prior conversation turn. `'system'` is accepted here for callers that
 * build history generically, but every provider treats it as equivalent to
 * `systemPrompt` (merged into the provider's dedicated system-prompt
 * mechanism) rather than as a turn in the user/assistant exchange — no
 * provider's wire format allows more than one system instruction.
 */
export type ConversationRole = 'user' | 'assistant' | 'system';

export interface ConversationMessage {
  role: ConversationRole;
  content: string;
}

export interface TextGenerationRequest {
  /** The newest user turn. Always required, even when `messages` is set. */
  prompt: string;
  /**
   * Prior turns, oldest first, NOT including `prompt` itself. Omit for a
   * single-shot completion — every Release 1/2 caller does this today, and
   * every provider's behavior is unchanged when this is absent. A
   * conversational caller (e.g. Release 3's message service) passes the
   * windowed message history here; providers append `prompt` as the final
   * user turn before calling their SDK.
   */
  messages?: readonly ConversationMessage[];
  mode?: TextGenerationMode;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  /** Override the provider's configured default model for this one call. */
  model?: string;
}

export interface TextGenerationUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface TextGenerationResult {
  text: string;
  /** The provider id that actually served this request, e.g. "anthropic". */
  provider: string;
  /** The concrete model name used, e.g. "claude-sonnet-5". */
  model: string;
  usage?: TextGenerationUsage;
  finishReason?: string;
}

/** Implemented by any provider that can serve text/code generation. */
export interface TextGenerationProvider {
  readonly id: string;
  readonly capabilities: readonly AICapability[];
  generateText(request: TextGenerationRequest): Promise<TextGenerationResult>;
}

/**
 * Image generation. A separate provider interface from text (as the module
 * header describes) — the wire shape and result are entirely different, so
 * forcing it through `generateText` would be dishonest. Providers return raw
 * image bytes (base64) rather than a provider-hosted URL: those URLs expire,
 * and Synora stores the bytes in its own object storage so the returned URL
 * is durable and workspace-controlled.
 */
export interface ImageGenerationRequest {
  prompt: string;
  /** `${width}x${height}`, e.g. "1024x1024". Providers validate supported sizes. */
  size?: string;
  /** How many images to generate. Defaults to 1. */
  count?: number;
  /** Override the provider's configured default model for this one call. */
  model?: string;
}

export interface GeneratedImageData {
  /** Raw image bytes, base64-encoded. */
  base64: string;
  mimeType: string;
  width: number;
  height: number;
}

export interface ImageGenerationResult {
  images: readonly GeneratedImageData[];
  /** The provider id that actually served this request, e.g. "openai". */
  provider: string;
  /** The concrete model used, e.g. "gpt-image-1". */
  model: string;
}

/** Implemented by any provider that can serve image generation. */
export interface ImageGenerationProvider {
  readonly id: string;
  readonly capabilities: readonly AICapability[];
  generateImages(request: ImageGenerationRequest): Promise<ImageGenerationResult>;
}

/**
 * Thrown when a provider call fails for a reason the caller can act on
 * (missing configuration, upstream error, invalid response) — never a raw
 * SDK/HTTP error, so route code never needs to know which provider failed or
 * how that provider's SDK shapes its errors.
 */
export class AIProviderError extends Error {
  constructor(
    message: string,
    readonly providerId: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = 'AIProviderError';
  }
}

/** Thrown by the resolver when no provider is configured for a capability. */
export class NoProviderConfiguredError extends Error {
  constructor(capability: AICapability, checkedProviders: readonly string[]) {
    super(
      `No AI provider is configured for capability "${capability}". ` +
        `Checked: ${checkedProviders.join(', ')}. ` +
        `Set one of their API key secrets, or set AI_PROVIDER explicitly. ` +
        `See docs/production/R1-e_AI_PROVIDER_ABSTRACTION.md.`
    );
    this.name = 'NoProviderConfiguredError';
  }
}
