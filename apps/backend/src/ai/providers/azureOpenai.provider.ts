import { AzureOpenAI } from 'openai';
import { secretsManager } from '../../secrets';
import { getConfig } from '../../config';
import { AIProviderDescriptor } from '../registry';
import { OpenAICompatibleTextProvider } from './openaiCompatible.provider';

/**
 * Azure OpenAI. `AzureOpenAI` (from the official `openai` package) extends
 * the same `OpenAI` client used for every other OpenAI-compatible provider,
 * so it composes directly with `OpenAICompatibleTextProvider` — only
 * construction differs (endpoint + API version + deployment, Azure's own
 * three-part configuration, instead of a single base URL).
 *
 * Requires three settings, none of which have a safe default:
 * `AZURE_OPENAI_API_KEY` (secret), `AZURE_OPENAI_ENDPOINT`, and
 * `AZURE_OPENAI_DEPLOYMENT` (your deployed model's name — Azure uses the
 * deployment name where other providers use a model name).
 */
export const azureOpenAIDescriptor: AIProviderDescriptor = {
  id: 'azure-openai',
  displayName: 'Azure OpenAI',
  capabilities: ['text-generation', 'code-generation'],
  async isConfigured() {
    const apiKey = await secretsManager.tryGet('AZURE_OPENAI_API_KEY', 'ai:azure-openai');
    const { azureOpenAIEndpoint, azureOpenAIDeployment } = getConfig().ai;
    return Boolean(apiKey && azureOpenAIEndpoint && azureOpenAIDeployment);
  },
  async create() {
    const apiKey = await secretsManager.get('AZURE_OPENAI_API_KEY', 'ai:azure-openai');
    const { azureOpenAIEndpoint, azureOpenAIDeployment, azureOpenAIApiVersion } = getConfig().ai;
    if (!azureOpenAIEndpoint || !azureOpenAIDeployment) {
      throw new Error(
        'Azure OpenAI requires AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_DEPLOYMENT to be set.'
      );
    }
    const client = new AzureOpenAI({
      apiKey,
      endpoint: azureOpenAIEndpoint,
      apiVersion: azureOpenAIApiVersion,
      deployment: azureOpenAIDeployment,
    });
    return new OpenAICompatibleTextProvider('azure-openai', client, azureOpenAIDeployment);
  },
};
