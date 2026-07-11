# @synora/infra-secrets-env

**Infrastructure layer** adapter for `DEFAULT_SECRET_MANAGER=environment` — the default
`SecretManager` (port defined in `@synora/config`). Reads secrets straight from
`process.env`. Swapping to a vault later (AWS Secrets Manager, HashiCorp Vault, ...) means
adding a new `infra-secrets-*` package implementing the same port, not touching call sites.
