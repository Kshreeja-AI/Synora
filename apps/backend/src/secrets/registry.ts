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
    // openssl rand -base64 32 (the documented generator) yields 44 chars;
    // anything shorter than 32 was typed by hand, not generated.
    minLength: 32,
  },
  {
    key: 'NEXTAUTH_SECRET',
    description: 'Session/cookie encryption key for NextAuth.js on the web app.',
    owner: 'web',
    environments: ['development', 'testing', 'qa', 'staging', 'production'],
    requiredIn: ['staging', 'production'],
    rotationDays: 90,
    minLength: 32,
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
  // Payments are not part of the launch scope: the billing resolver reads
  // these lazily and answers "not configured" honestly without them, so a
  // production boot must not demand Stripe credentials the launch doesn't
  // use. Move both back to requiredIn: ['production'] when billing ships.
  {
    key: 'STRIPE_SECRET_KEY',
    description: 'Stripe secret API key used by the billing/subscription service for charging and managing payments.',
    owner: 'backend',
    environments: ['staging', 'production'],
    requiredIn: [],
  },
  {
    key: 'STRIPE_WEBHOOK_SECRET',
    description: 'Stripe webhook signing secret used to verify webhook events from Stripe (payment confirmations, subscription updates, etc.).',
    owner: 'backend',
    environments: ['staging', 'production'],
    requiredIn: [],
  },
  {
    key: 'GROQ_API_KEY',
    description: 'Groq API key used by the Groq text-generation provider (OpenAI-compatible endpoint).',
    owner: 'backend',
    environments: ['staging', 'production'],
    requiredIn: [],
  },
  {
    key: 'TOOL_SECRET_MASTER_KEY',
    description:
      'Master key for AES-256-GCM encryption of stored tool secrets (crypto/encryption.service.ts). ' +
      'Required where secrets hard-fail: tools are a shipped feature, and without this key the first ' +
      'user who stores a tool secret hits a runtime failure that boot validation should have caught. ' +
      'The encryption service is primed from the SecretsManager chain at boot, so file-mounted ' +
      'docker/kubernetes secrets work as well as plain env vars.',
    owner: 'backend',
    environments: ['development', 'testing', 'qa', 'staging', 'production'],
    requiredIn: ['staging', 'production'],
    minLength: 32,
  },
];

/**
 * Literal development/test secret values that appear in this repository
 * (test setup, examples, docs). A staging/production boot that resolves
 * one of these has copied a development environment file — a value anyone
 * can read from git is not a secret, and validateRequired() refuses it.
 */
export const KNOWN_DEV_SECRET_VALUES: ReadonlySet<string> = new Set([
  'test-jwt-secret-key-for-testing-only',
  'test-only-not-a-real-secret-tool-master-key-000000',
  'sk_test_fake_key_for_testing',
]);
