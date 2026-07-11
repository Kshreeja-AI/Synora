/**
 * Port for resolving secret values (API keys, connection strings, ...). The default
 * adapter (`infra-secrets-env`) reads from `process.env`, matching `DEFAULT_SECRET_MANAGER=environment`.
 * Swapping to a vault (AWS Secrets Manager, Vault, ...) means adding a new infra adapter,
 * not touching call sites — see docs/architecture/05-configuration-system.md.
 */
export interface SecretManager {
  getSecret(key: string): Promise<string | undefined>;
}
