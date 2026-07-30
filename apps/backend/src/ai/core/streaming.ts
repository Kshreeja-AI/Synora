/**
 * Streaming abstraction — unified interface for streaming AI responses.
 * Transforms provider-specific streaming into uniform AIStreamEvent format.
 */

import { AIStreamEvent, CancellationToken } from './types';

export class StreamManager {
  private activeStreams: Map<string, StreamContext> = new Map();

  async *createStream(
    streamId: string,
    iterator: AsyncIterable<AIStreamEvent>,
    cancellation?: CancellationToken
  ): AsyncIterable<AIStreamEvent> {
    const context: StreamContext = {
      id: streamId,
      startTime: Date.now(),
      eventCount: 0,
      tokenCount: 0,
      cancelled: false,
    };

    this.activeStreams.set(streamId, context);

    try {
      for await (const event of iterator) {
        if (cancellation?.isCancelled || context.cancelled) {
          break;
        }

        context.eventCount++;
        if (event.delta?.text) {
          context.tokenCount++;
        }

        yield event;
      }
    } finally {
      this.activeStreams.delete(streamId);
    }
  }

  cancelStream(streamId: string): void {
    const context = this.activeStreams.get(streamId);
    if (context) {
      context.cancelled = true;
    }
  }

  getStreamStats(streamId: string): StreamStats | null {
    const context = this.activeStreams.get(streamId);
    if (!context) return null;

    return {
      id: streamId,
      elapsedMs: Date.now() - context.startTime,
      eventCount: context.eventCount,
      tokenCount: context.tokenCount,
    };
  }
}

export interface StreamContext {
  id: string;
  startTime: number;
  eventCount: number;
  tokenCount: number;
  cancelled: boolean;
}

export interface StreamStats {
  id: string;
  elapsedMs: number;
  eventCount: number;
  tokenCount: number;
}

export class StreamBuffer {
  private buffer: string[] = [];
  private maxBufferSize: number;

  constructor(maxBufferSize: number = 10) {
    this.maxBufferSize = maxBufferSize;
  }

  append(text: string): void {
    this.buffer.push(text);
    if (this.buffer.length > this.maxBufferSize) {
      this.buffer.shift();
    }
  }

  flush(): string {
    const text = this.buffer.join('');
    this.buffer = [];
    return text;
  }

  getContent(): string {
    return this.buffer.join('');
  }

  clear(): void {
    this.buffer = [];
  }
}

export function createStreamEventParser(_providerId: string) {
  return {
    parseContentBlockStart(rawEvent: any): AIStreamEvent {
      return {
        type: 'content_block_start',
        index: rawEvent.index ?? 0,
      };
    },

    parseContentBlockDelta(rawEvent: any): AIStreamEvent {
      return {
        type: 'content_block_delta',
        index: rawEvent.index ?? 0,
        delta: {
          type: 'text_delta',
          text: rawEvent.delta?.text ?? '',
        },
      };
    },

    parseContentBlockStop(rawEvent: any): AIStreamEvent {
      return {
        type: 'content_block_stop',
        index: rawEvent.index ?? 0,
      };
    },

    parseMessageDelta(rawEvent: any): AIStreamEvent {
      return {
        type: 'message_delta',
        delta: rawEvent.delta ?? {},
      };
    },

    parseMessageStop(): AIStreamEvent {
      return {
        type: 'message_stop',
      };
    },

    parseError(error: Error): AIStreamEvent {
      const aiError = error instanceof Error ? new Error(error.message) : error;
      return {
        type: 'error',
        error: aiError as any,
      };
    },
  };
}
