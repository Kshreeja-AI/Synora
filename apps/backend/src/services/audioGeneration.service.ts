import { prisma } from '@synora/database';
import type { GeneratedAudio } from '@prisma/client';
import { resolveTextToSpeechProvider } from '../ai';
import { resolveStorageProvider } from '../storage';
import { logger } from '../utils/logger';
import { recordAiInteraction, declareAiPath } from '../eos/instrumentation';
import { priceMediaUsage } from '../eos/media-pricing';

declareAiPath('audio.generate');

export interface GenerateAudioInput {
  userId: string;
  text: string;
  voice?: string;
  format?: 'mp3' | 'wav' | 'ogg' | 'flac' | 'aac';
  projectId?: string;
}

const EXTENSION_BY_FORMAT: Record<string, string> = {
  mp3: 'mp3',
  wav: 'wav',
  ogg: 'ogg',
  flac: 'flac',
  aac: 'aac',
};

/**
 * Turns text into a stored, durable audio record — the text-to-speech
 * counterpart of imageGeneration.service.ts, following the same honest,
 * synchronous pattern: resolve a real provider (throwing
 * NoProviderConfiguredError when none is configured, never a fabricated
 * clip), generate real bytes, store them in Synora's own object storage,
 * and persist a GeneratedAudio row whose status reflects what actually
 * happened.
 */
export class AudioGenerationService {
  async generate(input: GenerateAudioInput): Promise<GeneratedAudio> {
    const provider = await resolveTextToSpeechProvider(); // throws if unconfigured — caller surfaces 503
    const storage = await resolveStorageProvider();

    const pending = await prisma.generatedAudio.create({
      data: {
        userId: input.userId,
        projectId: input.projectId,
        prompt: input.text,
        audioUrl: '',
        duration: 0,
        model: 'pending',
        status: 'PROCESSING',
      },
    });

    const startedAt = Date.now();

    try {
      const result = await provider.synthesize({
        text: input.text,
        voice: input.voice,
        format: input.format,
      });

      const extension = EXTENSION_BY_FORMAT[input.format ?? 'mp3'] ?? 'mp3';
      const stored = await storage.upload({
        key: `generated-audio/${input.userId}/${pending.id}.${extension}`,
        buffer: result.audio,
        contentType: result.mimeType,
      });

      // Speech synthesis is billed per character of input text — the one
      // unit available here, since the response reports neither cost nor
      // duration. With no published rate on record, nothing is reported
      // rather than a zero that would misread as "free".
      const priced = priceMediaUsage({
        providerId: result.provider,
        modelId: result.model,
        units: input.text.length,
      });

      recordAiInteraction({
        promptId: 'audio.generate',
        providerId: result.provider,
        modelId: result.model,
        success: true,
        latencyMs: Date.now() - startedAt,
        costCents: priced?.costCents,
        pricingBasis: priced?.basis,
        costProvenance: priced?.provenance,
      });

      return await prisma.generatedAudio.update({
        where: { id: pending.id },
        data: {
          audioUrl: stored.url,
          // `duration` is deliberately left at its 0 default: computing it
          // would require decoding the compressed audio bytes (a real MP3/
          // OGG parse), and OpenAI's TTS response doesn't report it.
          // Estimating from text length would be a fabricated number, which
          // is worse than an honest "not computed yet".
          model: `${result.provider}:${result.model}`,
          status: 'COMPLETED',
          completedAt: new Date(),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[AudioGeneration] Generation failed', { audioId: pending.id, error: message });

      recordAiInteraction({
        promptId: 'audio.generate',
        providerId: provider.id,
        modelId: 'unknown',
        success: false,
        latencyMs: Date.now() - startedAt,
        errorCode: error instanceof Error ? error.name : 'unknown',
      });

      await prisma.generatedAudio.update({
        where: { id: pending.id },
        data: { status: 'FAILED' },
      });
      throw error;
    }
  }
}

export const audioGenerationService = new AudioGenerationService();
