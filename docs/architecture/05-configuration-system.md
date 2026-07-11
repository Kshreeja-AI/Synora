# Configuration System

`@synora/config` is the single source of truth for environment configuration. Nothing
else in the codebase should call `process.env` directly for application-level settings
(feature flags, provider names, app metadata) — everything goes through `loadConfig()`'s
typed, validated `AppConfig`.

## Schema

`packages/shared/shared-config/src/schema.ts` defines a `zod` schema that mirrors
`.env.example` field-for-field, grouped into `app` (name/env/version/logLevel/...),
`features` (every `ENABLE_*` flag, coerced from the string `"true"`/`"false"` to a real
boolean), and `providers` (every `DEFAULT_*` provider name). **Provider names are
validated as non-empty strings, not closed enums** — adding a new provider adapter must
never require editing this schema, only adding a new `infra-*` package and pointing the
composition root at it.

`loadConfig()` calls `zod`'s `.parse()`, which throws immediately on missing/malformed
required configuration — fail fast at process startup, not three requests deep into
production traffic.

## Secrets

`SecretManager` (defined alongside the schema in `@synora/config`) is a port:
`getSecret(key): Promise<string | undefined>`. The default adapter,
`EnvSecretManager` in `infra-secrets-env`, reads straight from `process.env`, matching
`DEFAULT_SECRET_MANAGER=environment`. A future vault-backed adapter (AWS Secrets Manager,
HashiCorp Vault, ...) implements the same port — call sites that resolve a secret through
this port don't change.

Note: connection strings/credentials for infrastructure the composition root wires up
directly (`DATABASE_URL`, `REDIS_URL`, `OPENROUTER_API_KEY`, ...) are read via
`process.env` in `composition-root.ts` rather than through `AppConfig`, because they
aren't part of `.env.example`'s application-config schema — they're deployment-specific
secrets, and `.env.example` intentionally does not commit real secret values to the repo.

See `ADR-0007` for the reasoning behind schema-mirrors-`.env.example` and provider names
as open strings.
