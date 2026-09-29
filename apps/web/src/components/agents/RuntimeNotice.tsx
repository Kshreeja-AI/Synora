'use client';

import { Cpu, FlaskConical } from 'lucide-react';
import type { RunRuntime } from '@/lib/api/agents';

/**
 * States plainly what produced a run.
 *
 * WHY THIS COMPONENT EXISTS AT ALL. When no AI provider is configured, the
 * platform plans runs with a deterministic local planner that follows a
 * fixed grammar. Its output looks like a plan and behaves like a plan, and
 * rendering it without a label would be presenting scaffolding as
 * intelligence — the same class of fabrication as inventing a benchmark
 * result. So this is not a nice-to-have badge: it is the honesty
 * requirement made visible, and it is rendered next to every run.
 *
 * The notice text comes from the server rather than being written here, so
 * there is exactly one wording and the client cannot soften it.
 */
export function RuntimeNotice({ runtime }: { runtime: RunRuntime }) {
  const isLocal = runtime.mode === 'local';
  const Icon = isLocal ? FlaskConical : Cpu;

  return (
    <div
      role="note"
      aria-label={isLocal ? 'Local deterministic run' : 'Model-backed run'}
      className={
        isLocal
          ? 'flex gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200'
          : 'flex gap-3 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
      }
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="space-y-1">
        <p className="font-semibold">
          {isLocal ? 'LOCAL — deterministic, not AI' : `REAL — planned by ${runtime.provider ?? 'a model'}`}
        </p>
        <p>{runtime.notice}</p>
      </div>
    </div>
  );
}
