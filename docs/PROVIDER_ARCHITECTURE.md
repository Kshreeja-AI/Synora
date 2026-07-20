# Provider Abstraction Layer

Synora never depends on a specific AI provider. Routes and services only see
Synora's own interfaces (`IImageProvider`, `IVideoProvider`, `IAudioProvider`);
concrete providers (OpenAI, Anthropic, Replicate, Runway, Synthesia) are
implementation details that can be swapped, added, or removed without
touching business logic.

## Layout

```
apps/backend/src/
├── providers/                  # Synora's own interfaces + wiring (no provider knowledge)
│   ├── interfaces/             # IProvider, IImageProvider, IVideoProvider, IAudioProvider
│   ├── registry/                # ProviderRegistry<T> — lookup by ProviderName
│   ├── factory/                  # ProviderFactory — decides real vs mock, builds the set
│   ├── environment/               # EnvironmentAdapter — only place touching process.env
│   ├── secrets/                    # SecretsManager — resolves provider credentials
│   ├── mock/                        # MockImageProvider / MockVideoProvider / MockAudioProvider
│   └── container.ts                  # ProviderContainer (DI root) + defaultProviderContainer
│
├── integrations/                # One folder per concrete provider — the ONLY place
│   ├── openai/openaiProvider.ts   # that talks to a specific vendor's API
│   ├── anthropic/anthropicProvider.ts
│   ├── replicate/replicateProvider.ts
│   ├── runway/runwayProvider.ts
│   └── synthesia/synthesiaProvider.ts
│
└── services/
    ├── aiService.ts              # Facade used by routes; resolves providers via the registry
    └── videoService.ts           # Same pattern for video generation
```

## How swapping works

`ProviderFactory.create()` is the single place that knows the list of
concrete providers. It reads `USE_MOCK_PROVIDERS`:

- `false` (default, matches prior behavior) — registers the live
  `integrations/*` providers.
- `true` — registers `providers/mock/*` instead. Same `ProviderName` keys,
  same interfaces, zero network calls, no API keys needed. This is how
  local development and CI run without depending on any vendor.

To remove a provider (e.g. drop OpenAI for a future `Synora LLM` provider),
add a new class under `integrations/` implementing the same interface and
change one line in `ProviderFactory` — nothing in `services/` or `routes/`
changes.

`services/aiService.ts` and `services/videoService.ts` keep their original
public API (`AIService`, `VideoService`, the `aiService`/`videoService`
singletons, and the legacy provider class re-exports) so existing routes and
tests did not need to change. They no longer contain any fetch/HTTP logic —
that lives entirely in `integrations/`.

## Adding a new capability or provider

1. Define the contract in `providers/interfaces/<capability>.ts` if it
   doesn't exist yet (e.g. `ILLMProvider` for a future Synora LLM).
2. Implement it in `integrations/<provider>/<provider>Provider.ts`.
3. Add a mock counterpart in `providers/mock/`.
4. Register both in `ProviderFactory`.

No other file needs to know the provider exists.
