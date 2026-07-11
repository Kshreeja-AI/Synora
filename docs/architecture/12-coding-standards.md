# Coding Standards

## Language & module system

TypeScript, strict mode, ESM (`"type": "module"` everywhere, `NodeNext` module
resolution — import specifiers include the `.js` extension even though the source file is
`.ts`, because that's what actually resolves at runtime under `NodeNext`). Node 22.
`tsconfig.base.json` (root) turns on `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`,
`noPropertyAccessFromIndexSignature`, and `verbatimModuleSyntax` — every package's
`tsconfig.json` extends it, no package is allowed to loosen it.

## Naming

- Files: `kebab-case.ts`, one primary export per file, filename matches the export
  (`create-task.use-case.ts` exports `CreateTaskUseCase`).
- Ports: interface named for the capability (`Cache`, `TaskRepository`), no `I`-prefix.
- Adapters: `<Provider><Port>` (`RedisCache`, `PostgresTaskRepository`).
- DI tokens: `SCREAMING_SNAKE_CASE` constants, one per port, in the file that owns the port.
- Errors: `<Reason>Error`, always extending `AppError` or `DomainError` — never a bare
  `Error` thrown across a layer boundary.

## Imports

`@typescript-eslint/consistent-type-imports` is enforced (`import type { X }` for
type-only imports) — keeps type-only imports from accidentally creating a runtime module
dependency edge that the boundary rules would otherwise have to account for. Import
direction is enforced three independent ways — see `03-service-boundaries.md`.

## Formatting & linting

Prettier (`.prettierrc.json`: single quotes, semicolons, trailing commas, 100-col print
width) is the only source of formatting opinions — ESLint does not duplicate them
(`eslint-config-prettier` disables any ESLint rule that would conflict). ESLint
(`eslint.config.js`, flat config) layers `@typescript-eslint`'s recommended rules,
`eslint-plugin-boundaries` for the dependency rule, and a small set of house rules
(`no-console` outside `warn`/`error`, `@typescript-eslint/no-explicit-any` as a warning
not an error — sometimes justified at an adapter boundary, but it should be a visible
warning).

## Testing

See `15-documentation-standards.md`'s sibling, `ADR-0012` — Vitest, prefer fakes
(`@synora/test-utils`) over mocking libraries for ports simple enough to fake, one
`*.test.ts` colocated per source file it covers.

## No shortcuts, no speculative abstraction

Concretely: don't add a port for something only one adapter will ever implement (a
feature-local repository port doesn't need to move to the platform kernel just because it
might theoretically be reused); don't add a config flag or DI token for a provider nothing
resolves yet (see the composition root's scope notes for the two ports that stayed
unbound, and why that's a documented decision, not an oversight).
