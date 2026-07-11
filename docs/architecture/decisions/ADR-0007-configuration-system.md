# ADR-0007: zod-validated configuration mirroring `.env.example`, provider names as open strings

**Status:** Accepted

## Context

`.env.example` already defines the platform's full configuration surface (app metadata,
feature flags, provider defaults). Configuration needs to be typed, validated at startup,
and must not become a place where adding a new provider requires editing a closed list.

## Decision

`@synora/config`'s `zod` schema mirrors `.env.example` field-for-field (`app`/`features`/
`providers` groups). `ENABLE_*` flags are coerced from `"true"`/`"false"` strings to real
booleans. `DEFAULT_*` provider fields are validated as non-empty strings (`z.string()`
with a default matching `.env.example`), **not** `z.enum([...])`.

## Alternatives considered

- **`z.enum()` for every provider field** — would give slightly stronger typing (a typo'd
  provider name caught at config-load time instead of at composition-root wiring time),
  but means every new `infra-*` adapter package requires a matching edit to
  `packages/shared/shared-config/src/schema.ts` just to be a legal config value — directly
  contradicting "provider-agnostic... future extensibility." Open strings push that
  validation to where it actually belongs: the composition root failing to find a
  registered adapter for an unrecognized provider name, which is where the real coupling
  between "configured provider" and "available adapter" lives.
- **No schema at all — read `process.env` ad hoc wherever needed** — rejected outright;
  see `05-configuration-system.md` for why untyped, unvalidated, scattered `process.env`
  reads are the standard this schema exists to prevent.
- **A config file (YAML/JSON/TOML) instead of environment variables** — rejected; the
  platform's `.env.example` convention (and `DEFAULT_SECRET_MANAGER=environment`) already
  commits to environment-variable-based configuration as the baseline, matching standard
  12-factor practice for containerized deployment.

## Consequences

Adding a new feature flag or app-level setting requires updating both `.env.example` and
`schema.ts`/`load-config.ts` together (they must stay in sync — `05-configuration-system.md`
calls this out explicitly). Adding a new _provider option_ for an existing `DEFAULT_*`
field requires no config-layer change at all, only a new `infra-*` package and a
composition-root wiring change.
