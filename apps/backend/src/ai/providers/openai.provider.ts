/**
 * OpenAI Provider Implementation — demonstrates provider pattern compliance.
 * All provider-specific logic isolated here; no leakage to core.
 */

import { BaseProvider, ProviderConfig, ProviderFactory } from '../core/provider';
import {
  AIRequest,
  AIResponse,
  AIStreamEvent,
  AIModel,
  ProviderHealth,
  CancellationToken,
} from '../core/types';

export class OpenAIProvider extends BaseProvider {
  private apiKey: string;
  private baseUrl: string = 'https://api.openai.com/v1';

  constructor(config: ProviderConfig, logger: any) {
    super('openai', 'OpenAI', logger);
    if (!config.apiKey) {
      throw new Error('OpenAI provider requires apiKey');
    }
    this.apiKey = config.apiKey;
    if (config.baseUrl) {
      this.baseUrl = config.baseUrl;
    }
  }

  async initialize(): Promise<void> {
    // Load OpenAI models
    this.models = [
      {
        id: 'gpt-4o',
        providerId: this.id,
        name: 'gpt-4o',
        displayName: 'GPT-4 Omni',
        contextWindow: 128000,
        maxOutputTokens: 4096,
        trainingData: '2024-05',
        costPer1kInputTokens: 0.015,
        costPer1kOutputTokens: 0.06,
        capabilities: ['chat', 'streaming', 'vision', 'tool-calling', 'json-mode'],
      },
      {
        id: 'gpt-4-turbo',
        providerId: this.id,
        name: 'gpt-4-turbo',
        displayName: 'GPT-4 Turbo',
        contextWindow: 128000,
        maxOutputTokens: 4096,
        costPer1kInputTokens: 0.01,
        costPer1kOutputTokens: 0.03,
        capabilities: ['chat', 'streaming', 'vision', 'tool-calling', 'json-mode'],
      },
      {
        id: 'gpt-3.5-turbo',
        providerId: this.id,
        name: 'gpt-3.5-turbo',
        displayName: 'GPT-3.5 Turbo',
        contextWindow: 16384,
        maxOutputTokens: 4096,
        costPer1kInputTokens: 0.0005,
        costPer1kOutputTokens: 0.0015,
        capabilities: ['chat', 'streaming', 'tool-calling'],
      },
    ];
  }

  async listModels(): Promise<AIModel[]> {
    return this.models;
  }

  async complete(request: AIRequest, cancellation?: CancellationToken): Promise<AIResponse> {
    const startTime = Date.now();

    const body = {
      model: request.model,
      messages: request.messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
      temperature: request.temperature,
      top_p: request.topP,
      max_tokens: request.maxTokens,
      stop: request.stopSequences,
      tools: request.tools?.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        },
      })),
      response_format: request.responseFormat,
    };

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: cancellation?.isCancelled ? AbortSignal.abort() : undefined,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`OpenAI API error: ${error.error?.message}`);
      }

      const data = await response.json();
      const latencyMs = Date.now() - startTime;

      const model = await this.getModel(request.model);
      const cost = model.costPer1kInputTokens * (data.usage.prompt_tokens / 1000) +
        model.costPer1kOutputTokens * (data.usage.completion_tokens / 1000);

      this.recordSuccess(latencyMs);

      return {
        id: data.id,
        requestId: request.id,
        providerId: this.id,
        modelId: request.model,
        content: data.choices[0].message.content,
        toolCalls: [],
        stopReason: 'stop',
        inputTokens: data.usage.prompt_tokens,
        outputTokens: data.usage.completion_tokens,
        cost,
        latencyMs,
      };
    } catch (error) {
      this.recordFailure(error as any);
      throw error;
    }
  }

  async *stream(request: AIRequest, cancellation?: CancellationToken): AsyncIterable<AIStreamEvent> {
    const body = {
      model: request.model,
      messages: request.messages,
      stream: true,
      temperature: request.temperature,
      max_tokens: request.maxTokens,
    };

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: cancellation?.isCancelled ? AbortSignal.abort() : undefined,
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      let inputTokens = 0;
      let outputTokens = 0;

      for await (const chunk of this.readStream(reader)) {
        if (chunk.startsWith('[DONE]')) break;

        const data = JSON.parse(chunk);
        const choice = data.choices[0];

        if (choice.delta?.content) {
          yield {
            type: 'content_block_delta',
            delta: {
              type: 'text_delta',
              text: choice.delta.content,
            },
          };
          outputTokens += Math.ceil(choice.delta.content.length / 4);
        }

        if (choice.finish_reason) {
          yield {
            type: 'message_stop',
          };
        }
      }

      this.recordSuccess(0);
    } catch (error) {
      this.recordFailure(error as any);
      throw error;
    }
  }

  async getHealth(): Promise<ProviderHealth> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      });

      if (response.ok) {
        this.recordHealthCheck('healthy');
      } else {
        this.recordHealthCheck('degraded');
      }
    } catch {
      this.recordHealthCheck('unhealthy');
    }

    return this.health;
  }

  async estimateTokens(text: string, modelId: string): Promise<number> {
    // Rough estimation: ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  private async *readStream(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncIterable<string> {
    let buffer = '';
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          yield line.slice(6);
        }
      }
    }
  }
}

export class OpenAIProviderFactory implements ProviderFactory {
  async create(config: ProviderConfig, logger: any): Promise<OpenAIProvider> {
    const provider = new OpenAIProvider(config, logger);
    await provider.initialize();
    return provider;
  }
}
