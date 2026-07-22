import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { secretsManager } from '../../secrets';
import { getConfig } from '../../config';
import {
  AICapability,
  AIProviderError,
  TextGenerationProvider,
  TextGenerationRequest,
  TextGenerationResult,
} from '../types';
import { resolveSystemPrompt, DEFAULT_MAX_TOKENS } from '../shared';
import { AIProviderDescriptor } from '../registry';

/**
 * AWS Bedrock, via the model-agnostic Converse API (works across every
 * foundation model Bedrock hosts — Anthropic, Meta, Amazon, etc. — with one
 * request shape). Activated by setting `AWS_ACCESS_KEY_ID` and
 * `AWS_SECRET_ACCESS_KEY`. Model is `BEDROCK_MODEL_ID` (config:
 * `ai.bedrockModelId`), defaulting to a Claude 3.5 Sonnet Bedrock model id;
 * region is `BEDROCK_REGION` (config: `ai.bedrockRegion`), defaulting to
 * `us-east-1`.
 */
export class BedrockTextProvider implements TextGenerationProvider {
  readonly id = 'bedrock';
  readonly capabilities: readonly AICapability[] = ['text-generation', 'code-generation'];

  constructor(
    private readonly client: BedrockRuntimeClient,
    private readonly defaultModelId: string
  ) {}

  async generateText(request: TextGenerationRequest): Promise<TextGenerationResult> {
    const modelId = request.model ?? this.defaultModelId;
    const systemPrompt = resolveSystemPrompt(request);

    try {
      const response = await this.client.send(
        new ConverseCommand({
          modelId,
          messages: [{ role: 'user', content: [{ text: request.prompt }] }],
          system: systemPrompt ? [{ text: systemPrompt }] : undefined,
          inferenceConfig: {
            maxTokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
            temperature: request.temperature,
          },
        })
      );

      const text = (response.output?.message?.content ?? [])
        .map((block) => block.text)
        .filter((t): t is string => typeof t === 'string')
        .join('');

      return {
        text,
        provider: this.id,
        model: modelId,
        usage: {
          inputTokens: response.usage?.inputTokens,
          outputTokens: response.usage?.outputTokens,
        },
        finishReason: response.stopReason,
      };
    } catch (error) {
      throw new AIProviderError(
        `Bedrock text generation failed: ${error instanceof Error ? error.message : String(error)}`,
        this.id,
        error
      );
    }
  }
}

export const bedrockDescriptor: AIProviderDescriptor = {
  id: 'bedrock',
  displayName: 'AWS Bedrock',
  capabilities: ['text-generation', 'code-generation'],
  async isConfigured() {
    const accessKeyId = await secretsManager.tryGet('AWS_ACCESS_KEY_ID', 'ai:bedrock');
    const secretAccessKey = await secretsManager.tryGet('AWS_SECRET_ACCESS_KEY', 'ai:bedrock');
    return Boolean(accessKeyId && secretAccessKey);
  },
  async create() {
    const accessKeyId = await secretsManager.get('AWS_ACCESS_KEY_ID', 'ai:bedrock');
    const secretAccessKey = await secretsManager.get('AWS_SECRET_ACCESS_KEY', 'ai:bedrock');
    const { bedrockRegion, bedrockModelId } = getConfig().ai;

    const client = new BedrockRuntimeClient({
      region: bedrockRegion,
      credentials: { accessKeyId, secretAccessKey },
    });

    return new BedrockTextProvider(client, bedrockModelId);
  },
};
