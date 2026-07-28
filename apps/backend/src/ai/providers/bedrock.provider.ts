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
import type { AIProviderDescriptor } from '../types/descriptor';

/** Used only once BEDROCK_REGION has confirmed operator intent (see below). */
const DEFAULT_BEDROCK_REGION = 'us-east-1';

/**
 * AWS Bedrock, via the model-agnostic Converse API (works across every
 * foundation model Bedrock hosts — Anthropic, Meta, Amazon, etc. — with one
 * request shape). Model is `BEDROCK_MODEL_ID` (config: `ai.bedrockModelId`),
 * defaulting to a Claude 3.5 Sonnet Bedrock model id.
 *
 * Deliberately requires `BEDROCK_REGION` to be explicitly set (no default)
 * in addition to `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` before this
 * provider is considered configured. Those two credential env vars are the
 * single most common ambient convention in AWS-hosted deployments (ECS task
 * roles, EC2 instance profiles, CI/CD pipelines) for reasons that have
 * nothing to do with AI generation — auto-detecting Bedrock from their mere
 * presence would silently activate a real, billable provider the operator
 * never chose. Requiring one Bedrock-specific env var makes activation an
 * explicit choice, the same way `ollama.provider.ts` requires an explicit
 * `OLLAMA_BASE_URL` with no default.
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
    return Boolean(accessKeyId && secretAccessKey && getConfig().ai.bedrockRegion);
  },
  async create() {
    const accessKeyId = await secretsManager.get('AWS_ACCESS_KEY_ID', 'ai:bedrock');
    const secretAccessKey = await secretsManager.get('AWS_SECRET_ACCESS_KEY', 'ai:bedrock');
    const { bedrockRegion, bedrockModelId } = getConfig().ai;

    const client = new BedrockRuntimeClient({
      region: bedrockRegion ?? DEFAULT_BEDROCK_REGION,
      credentials: { accessKeyId, secretAccessKey },
    });

    return new BedrockTextProvider(client, bedrockModelId);
  },
};
