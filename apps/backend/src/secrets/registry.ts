import { SecretDescriptor } from './types';

/**
 * Single source of truth for every secret the application uses: what it's
 * for, who owns it, which environments need it, and how often it should
 * rotate. `validateRequired()` (SecretsManager) checks this list at
 * startup. Add a new secret here whenever you introduce one — this list
 * is also what docs/security/SECRET_MANAGEMENT.md's environment matrix is
 * generated from.
 */
export const SECRET_CATALOG: SecretDescriptor[] = [
  {
    key: 'JWT_SECRET',
    description: 'Symmetric signing key for access/refresh JWTs issued by the backend.',
    owner: 'backend',
    environments: ['development', 'testing', 'qa', 'staging', 'production'],
    requiredIn: ['staging', 'production'],
    rotationDays: 90,
  },
  {
    key: 'NEXTAUTH_SECRET',
    description: 'Session/cookie encryption key for NextAuth.js on the web app.',
    owner: 'web',
    environments: ['development', 'testing', 'qa', 'staging', 'production'],
    requiredIn: ['staging', 'production'],
    rotationDays: 90,
  },
  {
    key: 'DATABASE_URL',
    description: 'PostgreSQL connection string, including the database credential.',
    owner: 'backend',
    environments: ['development', 'testing', 'qa', 'staging', 'production'],
    requiredIn: ['staging', 'production'],
    rotationDays: 180,
  },
  {
    key: 'OPENAI_API_KEY',
    description: 'OpenAI API key used by AI provider integrations.',
    owner: 'backend',
    environments: ['staging', 'production'],
    requiredIn: [],
  },
  {
    key: 'ANTHROPIC_API_KEY',
    description: 'Anthropic API key used by AI provider integrations.',
    owner: 'backend',
    environments: ['staging', 'production'],
    requiredIn: [],
  },
  {
    key: 'REPLICATE_API_KEY',
    description: 'Replicate API key used by image generation providers.',
    owner: 'backend',
    environments: ['staging', 'production'],
    requiredIn: [],
  },
  {
    key: 'GOOGLE_AI_API_KEY',
    description: 'Google AI (Gemini) API key used by the Gemini text-generation provider.',
    owner: 'backend',
    environments: ['staging', 'production'],
    requiredIn: [],
  },
  {
    key: 'XAI_API_KEY',
    description: 'xAI API key used by the Grok text-generation provider.',
    owner: 'backend',
    environments: ['staging', 'production'],
    requiredIn: [],
  },
  {
    key: 'OPENROUTER_API_KEY',
    description: 'OpenRouter API key used by the OpenRouter text-generation provider.',
    owner: 'backend',
    environments: ['staging', 'production'],
    requiredIn: [],
  },
  {
    key: 'DEEPSEEK_API_KEY',
    description: 'DeepSeek API key used by the DeepSeek text-generation provider.',
    owner: 'backend',
    environments: ['staging', 'production'],
    requiredIn: [],
  },
  {
    key: 'TOGETHER_API_KEY',
    description: 'Together AI API key used by the Together text-generation provider.',
    owner: 'backend',
    environments: ['staging', 'production'],
    requiredIn: [],
  },
  {
    key: 'AZURE_OPENAI_API_KEY',
    description:
      'Azure OpenAI API key used by the Azure OpenAI text-generation provider. Requires AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_DEPLOYMENT to also be set.',
    owner: 'backend',
    environments: ['staging', 'production'],
    requiredIn: [],
  },
  {
    key: 'AWS_ACCESS_KEY_ID',
    description:
      'AWS access key used by the Bedrock text-generation provider. Requires AWS_SECRET_ACCESS_KEY and the BEDROCK_REGION env var (no default — deliberately not auto-detected from ambient AWS credentials alone) to also be set.',
    owner: 'backend',
    environments: ['staging', 'production'],
    requiredIn: [],
  },
  {
    key: 'AWS_SECRET_ACCESS_KEY',
    description: 'AWS secret key used by the Bedrock text-generation provider.',
    owner: 'backend',
    environments: ['staging', 'production'],
    requiredIn: [],
  },
  {
    key: 'VOYAGE_API_KEY',
    description: 'Voyage AI API key used by the Voyage embeddings provider (Anthropic\'s recommended embedding partner).',
    owner: 'backend',
    environments: ['staging', 'production'],
    requiredIn: [],
  },
  {
    key: 'COHERE_API_KEY',
    description: 'Cohere API key used by the Cohere embeddings provider.',
    owner: 'backend',
    environments: ['staging', 'production'],
    requiredIn: [],
  },
  {
    key: 'PINECONE_API_KEY',
    description: 'Pinecone API key used by the Pinecone vector DB provider.',
    owner: 'backend',
    environments: ['staging', 'production'],
    requiredIn: [],
  },
  {
    key: 'QDRANT_API_KEY',
    description:
      'Qdrant API key used by the Qdrant vector DB provider. Only required for Qdrant Cloud; self-hosted Qdrant with no auth configured needs no key.',
    owner: 'backend',
    environments: ['staging', 'production'],
    requiredIn: [],
  },
  {
    key: 'WEAVIATE_API_KEY',
    description:
      'Weaviate API key used by the Weaviate vector DB provider. Only required for Weaviate Cloud or an instance with auth enabled.',
    owner: 'backend',
    environments: ['staging', 'production'],
    requiredIn: [],
  },
  {
    key: 'MILVUS_TOKEN',
    description:
      'Milvus/Zilliz Cloud auth token used by the Milvus vector DB provider. Only required for Zilliz Cloud or a self-hosted instance with auth enabled.',
    owner: 'backend',
    environments: ['staging', 'production'],
    requiredIn: [],
  },
  {
    key: 'SMTP_USER',
    description:
      'SMTP username used by the mail SMTP transport. Only required when MAIL_TRANSPORT=smtp is explicitly set.',
    owner: 'backend',
    environments: ['staging', 'production'],
    requiredIn: [],
  },
  {
    key: 'SMTP_PASSWORD',
    description:
      'SMTP password used by the mail SMTP transport. Only required when MAIL_TRANSPORT=smtp is explicitly set.',
    owner: 'backend',
    environments: ['staging', 'production'],
    requiredIn: [],
  },
  {
    key: 'SNYK_TOKEN',
    description: 'Snyk auth token used by the security-scan GitHub Actions job.',
    owner: 'platform',
    environments: ['staging', 'production'],
    requiredIn: [],
  },
  {
    key: 'STRIPE_SECRET_KEY',
    description: 'Stripe secret API key used by the billing/subscription service for charging and managing payments.',
    owner: 'backend',
    environments: ['staging', 'production'],
    requiredIn: ['production'],
  },
  {
    key: 'STRIPE_WEBHOOK_SECRET',
    description: 'Stripe webhook signing secret used to verify webhook events from Stripe (payment confirmations, subscription updates, etc.).',
    owner: 'backend',
    environments: ['staging', 'production'],
    requiredIn: ['production'],
  },
];
