'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Eye,
  Wrench,
  Brain,
  Zap,
  Sparkles,
  Loader2,
  Cpu,
} from 'lucide-react';
import { listAIModels, type ProviderCatalog } from '@/lib/api/aiModels';

/**
 * Compact provider+model selector.
 *
 * Uses two native <select>s stacked as one visual control so users can pick a
 * provider first and then a model within it. Deliberately not a fully-custom
 * combobox — the native controls give free keyboard, mobile, and screen-reader
 * behaviour, which a hand-rolled dropdown would have to reimplement (badly)
 * to match.
 *
 * Providers without a configured API key stay in the list with a "not
 * configured" hint and are disabled — showing them communicates the platform's
 * full model surface, whereas silently omitting them makes it look like the
 * model doesn't exist.
 */
export interface ModelPickerValue {
  provider: string;
  model: string;
}

export interface ModelPickerProps {
  value: ModelPickerValue;
  onChange(next: ModelPickerValue): void;
  /** Only show models satisfying every listed capability. Useful for
   *  gating e.g. "vision required" flows. */
  requireCapabilities?: Array<'vision' | 'toolUse' | 'reasoning' | 'thinking'>;
  disabled?: boolean;
  className?: string;
}

const CAPABILITY_META: Record<
  'vision' | 'toolUse' | 'reasoning' | 'thinking',
  { icon: typeof Eye; label: string }
> = {
  vision: { icon: Eye, label: 'Vision' },
  toolUse: { icon: Wrench, label: 'Tools' },
  reasoning: { icon: Brain, label: 'Reasoning' },
  thinking: { icon: Sparkles, label: 'Thinking' },
};

export function ModelPicker({
  value,
  onChange,
  requireCapabilities,
  disabled,
  className,
}: ModelPickerProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['ai', 'models'],
    queryFn: listAIModels,
    // Catalog is a static file server-side plus a cheap per-provider config
    // check — 5 minutes of cache keeps the model dropdown snappy without
    // hiding a newly-added provider for long.
    staleTime: 5 * 60_000,
  });

  const providers: ProviderCatalog[] = data?.providers ?? [];

  const currentProvider = useMemo(
    () => providers.find((p) => p.providerId === value.provider),
    [providers, value.provider]
  );

  const filteredModels = useMemo(() => {
    const models = currentProvider?.models ?? [];
    if (!requireCapabilities?.length) return models;
    return models.filter((m) =>
      requireCapabilities.every((cap) => m.capabilities[cap])
    );
  }, [currentProvider, requireCapabilities]);

  const currentModel = filteredModels.find((m) => m.id === value.model);

  if (isLoading) {
    return (
      <div className={`flex items-center gap-2 text-sm text-muted-foreground ${className ?? ''}`}>
        <Loader2 className="h-4 w-4 animate-spin" /> Loading models…
      </div>
    );
  }
  if (error) {
    return (
      <div className={`text-sm text-destructive ${className ?? ''}`}>
        Could not load models.
      </div>
    );
  }

  return (
    <div className={`space-y-2 ${className ?? ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="model-picker-provider">
          Provider
        </label>
        <select
          id="model-picker-provider"
          disabled={disabled}
          value={value.provider}
          onChange={(e) => {
            const nextProvider = providers.find((p) => p.providerId === e.target.value);
            const nextFirstModel = nextProvider?.models?.[0]?.id;
            if (!nextFirstModel) return;
            onChange({ provider: e.target.value, model: nextFirstModel });
          }}
          className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
        >
          {providers.map((p) => (
            <option key={p.providerId} value={p.providerId} disabled={!p.configured}>
              {p.providerName}
              {p.configured ? '' : ' (not configured)'}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="model-picker-model">
          Model
        </label>
        <select
          id="model-picker-model"
          disabled={disabled || filteredModels.length === 0}
          value={value.model}
          onChange={(e) => onChange({ provider: value.provider, model: e.target.value })}
          className="rounded-md border border-input bg-background px-2 py-1.5 text-sm min-w-[220px]"
        >
          {filteredModels.length === 0 ? (
            <option value="">No models match the required capabilities</option>
          ) : (
            filteredModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))
          )}
        </select>
      </div>

      {currentModel ? (
        <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <div className="text-foreground">{currentModel.description}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {(['vision', 'toolUse', 'reasoning', 'thinking'] as const).map((cap) =>
              currentModel.capabilities[cap] ? (
                <span
                  key={cap}
                  className="inline-flex items-center gap-1 rounded bg-background px-1.5 py-0.5"
                >
                  {(() => {
                    const Icon = CAPABILITY_META[cap].icon;
                    return <Icon className="h-3 w-3" />;
                  })()}
                  {CAPABILITY_META[cap].label}
                </span>
              ) : null
            )}
            <span className="inline-flex items-center gap-1 rounded bg-background px-1.5 py-0.5">
              <Cpu className="h-3 w-3" />
              {(currentModel.contextWindow / 1000).toFixed(0)}K ctx
            </span>
            {currentModel.speedTokensPerSecond ? (
              <span className="inline-flex items-center gap-1 rounded bg-background px-1.5 py-0.5">
                <Zap className="h-3 w-3" />~{currentModel.speedTokensPerSecond} tok/s
              </span>
            ) : null}
            {currentModel.pricePerMillion ? (
              <span className="inline-flex items-center gap-1 rounded bg-background px-1.5 py-0.5">
                ${currentModel.pricePerMillion.input}/{currentModel.pricePerMillion.output} per 1M
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
