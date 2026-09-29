import { secretsManager } from '../../secrets';
import { getConfig } from '../../config';
import { safeFetch, SsrfBlockedError } from '../../net/ssrf';
import {
  AICapability,
  AIProviderError,
  VideoGenerationProvider,
  VideoGenerationRequest,
  VideoJobHandle,
  VideoJobPollResult,
} from '../types';
import type { AIProviderDescriptor } from '../types/descriptor';

const DEFAULT_MODEL = 'minimax/video-01';

interface ReplicatePrediction {
  id: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output?: string | string[];
  error?: string;
  metrics?: { predict_time?: number };
}

export class ReplicateVideoProvider implements VideoGenerationProvider {
  readonly capabilities: readonly AICapability[] = ['video-generation'];

  constructor(
    readonly id: string,
    private readonly apiToken: string,
    private readonly defaultModel: string
  ) {}

  async startGeneration(request: VideoGenerationRequest): Promise<VideoJobHandle> {
    const model = request.model ?? this.defaultModel;
    try {
      const response = await fetch('https://api.replicate.com/v1/predictions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
          Prefer: 'respond-async',
        },
        body: JSON.stringify({
          model,
          input: {
            prompt: request.prompt,
            ...(request.duration != null ? { duration: request.duration } : {}),
          },
        }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new AIProviderError(
          `Replicate API error ${response.status}: ${body.slice(0, 500)}`,
          this.id
        );
      }

      const prediction = (await response.json()) as ReplicatePrediction;
      return { providerJobId: prediction.id, provider: this.id, model };
    } catch (error) {
      if (error instanceof AIProviderError) throw error;
      throw new AIProviderError(
        `${this.id} video generation failed to start: ${error instanceof Error ? error.message : String(error)}`,
        this.id,
        error
      );
    }
  }

  async pollJob(handle: VideoJobHandle): Promise<VideoJobPollResult> {
    try {
      const response = await fetch(
        `https://api.replicate.com/v1/predictions/${handle.providerJobId}`,
        {
          headers: { Authorization: `Bearer ${this.apiToken}` },
        }
      );

      if (!response.ok) {
        throw new AIProviderError(
          `Replicate poll error ${response.status}`,
          this.id
        );
      }

      const prediction = (await response.json()) as ReplicatePrediction;

      switch (prediction.status) {
        case 'starting':
        case 'processing':
          return { status: 'processing' };
        case 'succeeded': {
          const output = Array.isArray(prediction.output)
            ? prediction.output[0]
            : prediction.output;
          if (!output) {
            return { status: 'failed', errorMessage: 'Provider returned no output URL' };
          }
          return { status: 'completed', videoUrl: output };
        }
        case 'failed':
        case 'canceled':
          return { status: 'failed', errorMessage: prediction.error ?? 'Generation failed' };
        default:
          return { status: 'processing' };
      }
    } catch (error) {
      if (error instanceof AIProviderError) throw error;
      throw new AIProviderError(
        `${this.id} poll failed: ${error instanceof Error ? error.message : String(error)}`,
        this.id,
        error
      );
    }
  }

  /**
   * `url` arrives inside the provider's own JSON response, so it is the one
   * value on this path Synora did not choose. Fetched through `safeFetch`
   * rather than `fetch`: from inside the production network this call can
   * reach `postgres:5432`, `redis:6379` and the cloud metadata endpoint, none
   * of which are reachable from the internet. A compromised provider response
   * would otherwise borrow Synora's network position.
   */
  async downloadVideo(url: string): Promise<Buffer> {
    let response: Response;
    try {
      response = await safeFetch(url);
    } catch (error) {
      if (error instanceof SsrfBlockedError) {
        // Deliberately does not echo the blocked URL back to the caller: the
        // response is the one place an attacker reliably reads, and confirming
        // which internal addresses are refused is itself a probe result.
        throw new AIProviderError(
          `Refused to download video from a non-public address (${error.reason})`,
          this.id,
          error
        );
      }
      throw error;
    }
    if (!response.ok) {
      throw new AIProviderError(`Failed to download video: HTTP ${response.status}`, this.id);
    }
    return Buffer.from(await response.arrayBuffer());
  }
}

export const replicateVideoDescriptor: AIProviderDescriptor<VideoGenerationProvider> = {
  id: 'replicate',
  displayName: 'Replicate Video',
  capabilities: ['video-generation'],
  metering: 'metered' as const,
  async isConfigured() {
    // hasReal, not tryGet: a generated placeholder is not a credential.
    return secretsManager.hasReal('REPLICATE_API_KEY', 'ai:replicate-video');
  },
  async create() {
    const apiToken = await secretsManager.get('REPLICATE_API_KEY', 'ai:replicate-video');
    // Model from config, matching every other provider in this directory.
    // It was hardcoded, which meant running a different Replicate-hosted
    // model — Seedance, Wan, anything else — required editing this file.
    // `DEFAULT_MODEL` remains the fallback so behaviour is unchanged for a
    // deployment that sets nothing.
    return new ReplicateVideoProvider(
      'replicate',
      apiToken,
      getConfig().ai.replicateVideoModel || DEFAULT_MODEL
    );
  },
};
