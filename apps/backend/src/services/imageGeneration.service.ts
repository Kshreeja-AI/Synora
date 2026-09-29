import { prisma } from '@synora/database';
import type { GeneratedImage } from '@prisma/client';
import { resolveImageProvider } from '../ai';
import { resolveStorageProvider } from '../storage';
import { logger } from '../utils/logger';
import { recordAiInteraction, declareAiPath } from '../eos/instrumentation';
import { mediaCostCentsForCap, priceMediaUsage } from '../eos/media-pricing';
import { assertAiBudget, recordAiSpend } from '../ai/spend-guard';

declareAiPath('image.generate');

export interface GenerateImageInput {
  userId: string;
  /**
   * Optional because the image routes are not workspace-scoped yet. Absent
   * means the GLOBAL spend caps still bind (a system path is not a free
   * path); present binds the workspace's own budget too.
   */
  workspaceId?: string;
  prompt: string;
  size?: string;
  projectId?: string;
}

/**
 * Turns a prompt into a stored, durable image record.
 *
 * The whole flow is honest end-to-end: it resolves a real image provider
 * (throwing NoProviderConfiguredError when none is configured — the route
 * turns that into a 503, never a fake placeholder), generates real bytes,
 * stores them in Synora's own object storage so the URL doesn't expire, and
 * persists a GeneratedImage row whose status reflects what actually
 * happened. If generation or storage fails, the row is recorded FAILED with
 * the reason — never COMPLETED with a fabricated URL.
 *
 * Runs synchronously against the provider (a bounded, awaited HTTP call, not
 * event-loop-blocking). Moving it to the background queue is a
 * drop-in change behind this same service boundary if image volume ever
 * makes request-scoped latency a problem.
 */
export class ImageGenerationService {
  async generate(input: GenerateImageInput): Promise<GeneratedImage> {
    const provider = await resolveImageProvider(); // throws if unconfigured — caller surfaces 503
    const storage = await resolveStorageProvider();

    // Record intent first so a failure is visible as a real FAILED row
    // rather than a silently-dropped request.
    const pending = await prisma.generatedImage.create({
      data: {
        userId: input.userId,
        projectId: input.projectId,
        prompt: input.prompt,
        imageUrl: '',
        width: 0,
        height: 0,
        model: 'pending',
        status: 'PROCESSING',
      },
    });

    const startedAt = Date.now();

    // The budget gate, BEFORE the provider call. Image generation was one
    // of the paths that could spend with no cap consulted at all.
    await assertAiBudget({ workspaceId: input.workspaceId });

    try {
      const result = await provider.generateImages({
        prompt: input.prompt,
        size: input.size,
        count: 1,
      });
      const image = result.images[0];
      const buffer = Buffer.from(image.base64, 'base64');

      const stored = await storage.upload({
        key: `generated-images/${input.userId}/${pending.id}.png`,
        buffer,
        contentType: image.mimeType,
      });

      // Image generation is billed per image, not per token. The provider
      // reports no cost, so the figure comes from a published price if one
      // is on record. `priced` being null means no rate is recorded, and in
      // that case nothing is reported — a zero would misread as "free".
      const priced = priceMediaUsage({
        providerId: result.provider,
        modelId: result.model,
        units: result.images.length,
      });

      recordAiInteraction({
        promptId: 'image.generate',
        providerId: result.provider,
        modelId: result.model,
        success: true,
        latencyMs: Date.now() - startedAt,
        costCents: priced?.costCents,
        pricingBasis: priced?.basis,
        costProvenance: priced?.provenance,
      });

      // The CAP's ledger. Reporting above may honestly show nothing for an
      // unpriced model; the cap must charge SOMETHING for every metered
      // call, so an unpriced image charges the documented per-image
      // ceiling. Real published prices win when on record.
      const capped = mediaCostCentsForCap({
        providerId: result.provider,
        modelId: result.model,
        basis: 'per-image',
        units: result.images.length,
      });
      await recordAiSpend({
        workspaceId: input.workspaceId,
        provider: result.provider,
        model: result.model,
        knownCostCents: capped.costCents,
      });

      return await prisma.generatedImage.update({
        where: { id: pending.id },
        data: {
          imageUrl: stored.url,
          width: image.width,
          height: image.height,
          model: `${result.provider}:${result.model}`,
          status: 'COMPLETED',
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[ImageGeneration] Generation failed', { imageId: pending.id, error: message });

      recordAiInteraction({
        promptId: 'image.generate',
        providerId: provider.id,
        modelId: 'unknown',
        success: false,
        latencyMs: Date.now() - startedAt,
        errorCode: error instanceof Error ? error.name : 'unknown',
      });

      await prisma.generatedImage.update({
        where: { id: pending.id },
        data: { status: 'FAILED' },
      });
      throw error;
    }
  }
}

export const imageGenerationService = new ImageGenerationService();
