# @synora/infra-auth-better-auth

**Infrastructure layer** adapter for `DEFAULT_AUTH_PROVIDER=better-auth`.
`BetterAuthProvider` implements the `AuthProvider` port from `@synora/application` against
a minimal `SessionResolverLike` interface (the one method it needs from a configured
`better-auth` instance: resolving a session token to a user), so tests inject a fake
resolver instead of standing up a full better-auth instance + database.

Wiring an actual `better-auth` instance (adapters, plugins, schema) is an
application-level concern that belongs in `apps/api-gateway`'s composition root once a
real auth requirement exists — this package only adapts _whatever_ instance is handed to
it to the `AuthProvider` port.
