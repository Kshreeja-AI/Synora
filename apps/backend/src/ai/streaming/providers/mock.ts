/**
 * Mock streaming provider for testing and development
 */

import { logger } from '../../../utils/logger';
import {
  TextGenerationStreamProvider,
  GenerateStreamInput,
  StreamChunk,
  StreamChunkType
} from '../types';

const MOCK_RESPONSE =
  'This is a mock response from Synora. In production, this would be replaced with actual AI provider responses. The mock provider is useful for testing streaming infrastructure without making real API calls. Each word is emitted as a separate token to simulate realistic streaming behavior.';

export class MockStreamProvider implements TextGenerationStreamProvider {
  getName(): string {
    return 'mock';
  }

  isConfigured(): boolean {
    return true;
  }

  async *generateStream(input: GenerateStreamInput): AsyncIterable<StreamChunk> {
    logger.debug('[MockStream] Starting generation', {
      model: input.model,
      messageCount: input.messages.length
    });

    const words = MOCK_RESPONSE.split(' ');
    const inputTokens = input.messages.reduce((sum, m) => sum + m.content.split(' ').length, 0);

    // Simulate network latency for first token
    await new Promise(resolve => setTimeout(resolve, 100));

    // Stream tokens with realistic delays
    for (let i = 0; i < words.length; i++) {
      if (input.abortSignal?.aborted) {
        logger.info('[MockStream] Aborted by signal');
        break;
      }

      // Emit token
      yield {
        type: StreamChunkType.TOKEN,
        token: words[i] + ' '
      };

      // Simulate network delay (5-50ms per token)
      const delay = Math.random() * 45 + 5;
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    // Emit final usage
    yield {
      type: StreamChunkType.USAGE,
      inputTokens,
      outputTokens: words.length
    };

    logger.debug('[MockStream] Generation complete', {
      model: input.model,
      tokens: words.length
    });
  }
}
