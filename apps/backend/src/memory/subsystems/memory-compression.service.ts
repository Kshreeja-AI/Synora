/**
 * Memory Compression & Summarization Service
 * Compresses long memories, generates summaries, reduces token footprint
 * Supports semantic compression, extractive summarization, abstractive summarization
 */

import { PrismaClient } from '@prisma/client';

export class MemoryCompressionService {
  constructor(
    private prisma: PrismaClient,
    private aiProvider: any,
    private logger: any
  ) {}

  /**
   * Estimate compressed size after compression algorithm
   */
  estimateCompressionRatio(content: string): { original: number; compressed: number; ratio: number } {
    const original = Buffer.byteLength(content, 'utf-8');

    // Simple LZ-like compression estimate (real implementation would use actual compression)
    // Rough estimate: 40-60% reduction for typical text
    const compressed = Math.ceil(original * 0.5);

    return {
      original,
      compressed,
      ratio: (1 - compressed / original) * 100,
    };
  }

  /**
   * Summarize memory content (extractive: key sentences)
   */
  async summarizeExtractive(memoryId: string, sentenceCount = 3): Promise<string> {
    const memory = await this.prisma.memory.findUnique({
      where: { id: memoryId },
    });

    if (!memory) throw new Error(`Memory ${memoryId} not found`);

    // Split into sentences
    const sentences = memory.content
      .split(/[.!?]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    if (sentences.length <= sentenceCount) {
      return memory.content;
    }

    // Score sentences by keyword frequency and position
    const scored = sentences.map((sent, idx) => ({
      sentence: sent,
      score: this.scoreSentence(sent, memory.content) + idx * 0.1,
    }));

    const top = scored
      .sort((a, b) => b.score - a.score)
      .slice(0, sentenceCount)
      .sort((a, b) => sentences.indexOf(a.sentence) - sentences.indexOf(b.sentence))
      .map(s => s.sentence);

    return top.join('. ') + '.';
  }

  /**
   * Summarize memory content (abstractive: AI-generated summary)
   */
  async summarizeAbstractive(memoryId: string): Promise<string> {
    const memory = await this.prisma.memory.findUnique({
      where: { id: memoryId },
    });

    if (!memory) throw new Error(`Memory ${memoryId} not found`);

    if (!this.aiProvider?.generateText) {
      // Fallback to extractive
      return this.summarizeExtractive(memoryId, 2);
    }

    try {
      const summary = await this.aiProvider.generateText(
        `Summarize this memory in one concise sentence: ${memory.content}`
      );

      // Update memory with summary
      await this.prisma.memory.update({
        where: { id: memoryId },
        data: { summary: summary.trim() },
      });

      return summary.trim();
    } catch (error) {
      this.logger.error('Abstractive summarization failed', { memoryId, error });
      return this.summarizeExtractive(memoryId, 2);
    }
  }

  /**
   * Compress memory by removing redundancy
   */
  async compress(memoryId: string): Promise<{ before: string; after: string; saved: number }> {
    const memory = await this.prisma.memory.findUnique({
      where: { id: memoryId },
      include: { metadata: true },
    });

    if (!memory) throw new Error(`Memory ${memoryId} not found`);

    const before = memory.content;
    const after = this.removeRedundancy(before);
    const savedBytes = Buffer.byteLength(before, 'utf-8') - Buffer.byteLength(after, 'utf-8');

    if (savedBytes > 0) {
      await this.prisma.memory.update({
        where: { id: memoryId },
        data: {
          content: after,
          embeddingRefreshNeeded: true,
        },
      });

      if (memory.metadata) {
        await this.prisma.memoryMetadata.update({
          where: { memoryId },
          data: {
            size: Buffer.byteLength(after, 'utf-8'),
            tokens: Math.ceil(after.length / 4),
          },
        });
      }

      this.logger.info('Memory compressed', {
        memoryId,
        savedBytes,
        beforeSize: Buffer.byteLength(before, 'utf-8'),
        afterSize: Buffer.byteLength(after, 'utf-8'),
      });
    }

    return { before, after, saved: savedBytes };
  }

  /**
   * Batch compress low-importance memories
   */
  async compressBatch(
    workspaceId: string,
    importanceThreshold = 0.3,
    limit = 100
  ): Promise<{ compressed: number; totalSaved: number }> {
    const memories = await this.prisma.memory.findMany({
      where: {
        workspaceId,
        importance: { lt: importanceThreshold },
        status: 'ACTIVE',
      },
      take: limit,
    });

    let compressed = 0;
    let totalSaved = 0;

    for (const memory of memories) {
      try {
        const result = await this.compress(memory.id);
        if (result.saved > 0) {
          compressed++;
          totalSaved += result.saved;
        }
      } catch (error) {
        this.logger.error('Batch compression failed for memory', {
          memoryId: memory.id,
          error,
        });
      }
    }

    return { compressed, totalSaved };
  }

  /**
   * Get compression recommendations for workspace
   */
  async getCompressionOpportunities(
    workspaceId: string
  ): Promise<Array<{ memoryId: string; content: string; estimatedSavings: number }>> {
    const memories = await this.prisma.memory.findMany({
      where: {
        workspaceId,
        status: 'ACTIVE',
      },
      select: { id: true, content: true },
      orderBy: { importance: 'asc' },
      take: 50,
    });

    return memories
      .map(m => ({
        memoryId: m.id,
        content: m.content,
        estimatedSavings: this.estimateCompressionRatio(m.content).original -
          this.estimateCompressionRatio(m.content).compressed,
      }))
      .filter(m => m.estimatedSavings > 100)
      .sort((a, b) => b.estimatedSavings - a.estimatedSavings);
  }

  /**
   * Remove redundant sentences and repeated phrases
   */
  private removeRedundancy(text: string): string {
    const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(s => s);
    const unique = Array.from(new Set(sentences));

    // Remove sentences that contain duplicated phrases
    return unique
      .filter((sent, idx) => {
        return !unique.some((other, oidx) => oidx !== idx && this.isSimilar(sent, other));
      })
      .join('. ') + '.';
  }

  /**
   * Score sentence by relevance
   */
  private scoreSentence(sentence: string, fullText: string): number {
    // Longer sentences tend to be more informative
    const lengthScore = Math.min(sentence.length / 100, 1);

    // Count keyword frequency
    const words = sentence.toLowerCase().split(/\s+/);
    const textWords = fullText.toLowerCase().split(/\s+/);
    const frequencyScore = words.reduce((score, word) => {
      const count = textWords.filter(w => w === word).length;
      return score + (count > 1 ? 1 : 0);
    }, 0) / words.length;

    // Sentences at start/end tend to be summaries
    const positionScore = fullText.startsWith(sentence) || fullText.endsWith(sentence) ? 1 : 0.5;

    return lengthScore * 0.4 + frequencyScore * 0.4 + positionScore * 0.2;
  }

  /**
   * Check if two sentences are similar (for deduplication)
   */
  private isSimilar(sent1: string, sent2: string, threshold = 0.7): boolean {
    const words1 = new Set(sent1.toLowerCase().split(/\s+/));
    const words2 = new Set(sent2.toLowerCase().split(/\s+/));

    const intersection = new Set([...words1].filter(w => words2.has(w)));
    const union = new Set([...words1, ...words2]);

    const similarity = intersection.size / union.size;
    return similarity >= threshold;
  }
}
