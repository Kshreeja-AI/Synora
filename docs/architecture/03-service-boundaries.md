# Service Boundaries

## The rule

| From ↓ / To →      | domain | application | shared | infrastructure | plugin | app |
| ------------------ | ------ | ----------- | ------ | -------------- | ------ | --- |
| **domain**         | ✅     | ❌          | ❌     | ❌             | ❌     | ❌  |
| **application**    | ✅     | ✅          | ✅     | ❌             | ❌     | ❌  |
| **shared**         | ✅     | ❌          | ✅     | ❌             | ❌     | ❌  |
| **infrastructure** | ✅     | ✅          | ✅     | ✅             | ❌     | ❌  |
| **plugin**         | ✅     | ✅          | ✅     | ✅             | ✅     | ❌  |
| **app**            | ✅     | ✅          | ✅     | ✅             | ✅     | ✅  |

Reading a row: "what am I allowed to import." `domain` (both the platform kernel and every
plugin's own domain code) can only import other domain code. `shared` kernel packages
(`@synora/errors`, `@synora/logger`, `@synora/config`, `@synora/di`, `@synora/event-bus`,
`@synora/plugin-system`, `@synora/types`) sit beside domain/application — they're
dependency-free (or depend only on each other/domain) cross-cutting utilities, not
concrete infrastructure, which is why `application` is allowed to depend on them (e.g.
`ApplicationError extends AppError` from `@synora/errors`; DI tokens for platform ports
live in `@synora/application` using `@synora/di`).

## Why "shared" isn't a loophole

It would defeat the point of Clean Architecture if "shared" meant "anything goes." Every
shared kernel package is held to the same standard as domain/application: no framework
dependency, no I/O side effect a unit test can't run without mocking the whole world.
`@synora/logger` wraps pino but never touches the network; `@synora/config` validates
environment variables but doesn't call out to a secrets vault (that's
`infra-secrets-env`'s job, behind the `SecretManager` port `@synora/config` defines).
`@synora/types` is deliberately kept tiny — see its README — precisely so it doesn't
become a backdoor for smuggling infrastructure-shaped types past the boundary.

## How it's enforced (three independent mechanisms)

1. **Package dependencies.** A package's `package.json` `dependencies` are the only
   `@synora/*` imports Node module resolution will actually find — you cannot accidentally
   import a package you didn't declare.
2. **TypeScript project references.** Each `tsconfig.json`'s `references` array must match
   reality or `tsc -b` fails to build in the right order — a second, independent check of
   the same graph.
3. **ESLint `eslint-plugin-boundaries`** (`eslint.config.js`, root). Classifies every file
   by path into `domain`/`application`/`shared`/`infrastructure`/`plugin`/`app` and fails
   lint on a disallowed import — this is defense-in-depth for the case where 1 and 2 would
   technically permit an import but it still violates the rule in spirit (e.g. importing a
   type-only symbol that happens to be re-exported through a permitted package).

See `ADR-0002` for why three mechanisms instead of just relying on code review.
