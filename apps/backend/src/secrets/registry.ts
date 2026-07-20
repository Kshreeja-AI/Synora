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
    environments: ['local', 'development', 'staging', 'production'],
    requiredIn: ['staging', 'production'],
    rotationDays: 90,
  },
  {
    key: 'NEXTAUTH_SECRET',
    description: 'Session/cookie encryption key for NextAuth.js on the web app.',
    owner: 'web',
    environments: ['local', 'development', 'staging', 'production'],
    requiredIn: ['staging', 'production'],
    rotationDays: 90,
  },
  {
    key: 'DATABASE_URL',
    description: 'PostgreSQL connection string, including the database credential.',
    owner: 'backend',
    environments: ['local', 'development', 'staging', 'production'],
    requiredIn: ['local', 'development', 'staging', 'production'],
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
    key: 'SNYK_TOKEN',
    description: 'Snyk auth token used by the security-scan GitHub Actions job.',
    owner: 'platform',
    environments: ['staging', 'production'],
    requiredIn: [],
  },
];
