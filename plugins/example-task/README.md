# @synora/plugin-example-task

**Reference / example plugin — not a product feature.** Delete this once a real plugin
exists; its only purpose is to prove, end-to-end, that the platform's Clean Architecture +
DI + plugin + event-bus story actually works:

```
src/
  domain/          Task (AggregateRoot) + TaskCreated (DomainEvent) — zero dependencies
  application/     TaskRepository port, CreateTaskUseCase, GetTaskUseCase
  infrastructure/  PostgresTaskRepository (Drizzle schema + queries, via @synora/infra-postgres)
  presentation/    HTTP routes (framework-agnostic, via @synora/plugin-system's RouteRegistrar)
  plugin.ts        Plugin implementation: wires the above together in register(context)
```

Note this plugin's internal `src/domain` and `src/application` are its _own_ — feature
code, not the platform kernel (`@synora/domain` / `@synora/application`). It builds on top
of the kernel exactly the way a real product plugin would. See
`docs/architecture/06-plugin-architecture.md` for the full model.
