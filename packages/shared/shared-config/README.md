# @synora/config

Part of the **shared kernel**. Loads and validates environment configuration against a
`zod` schema mirroring `.env.example`, and exposes it as one typed, immutable `AppConfig`
object — nothing else in the codebase should call `process.env` directly (enforced by
convention + code review, see `docs/architecture/12-coding-standards.md`).

Provider _names_ (`DEFAULT_LLM_PROVIDER`, `DEFAULT_DATABASE`, ...) are validated as
non-empty strings, not closed enums — adding a new provider adapter must never require
editing this schema. Feature flags (`ENABLE_*`) are coerced to booleans.

Also defines the `SecretManager` port — `loadConfig()` reads plain environment variables
directly (matching `DEFAULT_SECRET_MANAGER=environment`), but any secret value that should
be resolvable from a vault later is read through this port so swapping in
`infra-secrets-*` adapter doesn't touch call sites.

See `docs/architecture/05-configuration-system.md` and ADR-0007.
