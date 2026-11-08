import OpenAI, { toFile } from 'openai';
import { SDK_CLIENT_OPTIONS } from './sdk-options';
import { getConfig } from '../../config';
import {
  AICapability,
  AIProviderError,
  SpeechToTextProvider,
  SpeechToTextRequest,
  SpeechToTextResult,
  TranscriptSegment,
} from '../types';
import type { AIProviderDescriptor } from '../types/descriptor';

/** Upper bound for one request. Larger files must be split by the caller. */
export const MAX_STT_AUDIO_BYTES = 25 * 1024 * 1024;

interface VerboseTranscription {
  text?: unknown;
  language?: unknown;
  duration?: unknown;
  segments?: unknown;
}

function parseSegments(raw: unknown): TranscriptSegment[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: TranscriptSegment[] = [];
  for (const item of raw) {
    const s = item as { start?: unknown; end?: unknown; text?: unknown };
    if (typeof s.start === 'number' && typeof s.end === 'number' && typeof s.text === 'string') {
      out.push({ startSeconds: s.start, endSeconds: s.end, text: s.text.trim() });
    }
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Speech-to-text over the OpenAI-compatible `/v1/audio/transcriptions`
 * wire format. That is deliberately a protocol, not a vendor: the same
 * adapter serves faster-whisper-server on a Kaggle/GPU box, vLLM, and any
 * hosted Whisper endpoint with a free tier. Which one is a config change.
 */
export class OpenAICompatibleTranscriptionProvider implements SpeechToTextProvider {
  readonly capabilities: readonly AICapability[] = ['speech-to-text'];

  constructor(
    readonly id: string,
    private readonly client: OpenAI,
    private readonly defaultModel: string
  ) {}

  async transcribe(request: SpeechToTextRequest): Promise<SpeechToTextResult> {
    if (request.audio.length === 0) {
      throw new AIProviderError(`${this.id}: audio is empty`, this.id);
    }
    if (request.audio.length > MAX_STT_AUDIO_BYTES) {
      throw new AIProviderError(
        `${this.id}: audio is ${request.audio.length} bytes; the limit is ${MAX_STT_AUDIO_BYTES}`,
        this.id
      );
    }
    const model = request.model ?? this.defaultModel;

    try {
      const file = await toFile(request.audio, request.fileName, { type: request.mimeType });
      const response = (await this.client.audio.transcriptions.create({
        file,
        model,
        response_format: 'verbose_json',
        ...(request.language ? { language: request.language } : {}),
      })) as unknown as VerboseTranscription;

      if (typeof response.text !== 'string') {
        throw new AIProviderError(`${this.id} returned no transcript text`, this.id);
      }

      const segments = parseSegments(response.segments);
      return {
        text: response.text.trim(),
        ...(typeof response.language === 'string' ? { language: response.language } : {}),
        ...(typeof response.duration === 'number' ? { durationSeconds: response.duration } : {}),
        ...(segments ? { segments } : {}),
        provider: this.id,
        model,
      };
    } catch (error) {
      if (error instanceof AIProviderError) throw error;
      throw new AIProviderError(
        `${this.id} transcription failed: ${error instanceof Error ? error.message : String(error)}`,
        this.id,
        error
      );
    }
  }
}

export const openaiCompatibleTranscriptionDescriptor: AIProviderDescriptor<SpeechToTextProvider> = {
  id: 'stt-openai-compatible',
  displayName: 'Whisper (OpenAI-compatible endpoint)',
  capabilities: ['speech-to-text'],
  // Whether it costs money depends on the endpoint the operator points it at;
  // the adapter itself cannot know, so it does not claim "unmetered".
  async isConfigured() {
    return Boolean(getConfig().ai.sttBaseUrl);
  },
  async create() {
    const { sttBaseUrl, sttApiKey, sttModel } = getConfig().ai;
    if (!sttBaseUrl) {
      throw new Error('Speech-to-text requires STT_BASE_URL to be set.');
    }
    return new OpenAICompatibleTranscriptionProvider(
      'stt-openai-compatible',
      new OpenAI({
        ...SDK_CLIENT_OPTIONS,
        apiKey: sttApiKey || 'stt-endpoint-does-not-require-an-api-key',
        baseURL: sttBaseUrl,
      }),
      sttModel
    );
  },
};
