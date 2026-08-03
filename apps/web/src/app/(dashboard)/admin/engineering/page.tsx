'use client';

import { useQuery } from '@tanstack/react-query';
import { Activity, AlertTriangle, Boxes, Cpu, Database, Gauge, Inbox, ShieldCheck } from 'lucide-react';
import {
  getCaptureStatus,
  getErrorRate,
  getEventStats,
  getLatency,
  getPromptReport,
  getProposals,
  getProviderMatrix,
  getCoverage,
  type ProviderMatrixEntry,
} from '@/lib/api/eos';
import { ProposalsPanel } from './ProposalsPanel';

/**
 * Founder-only view of the Engineering Operating System.
 *
 * Deliberately shows what is NOT being measured as prominently as what is.
 * A dashboard that only renders the data it happens to have invites the
 * reader to assume that data is complete — which is the same failure mode
 * as a cost column reporting zero when it means "unmeasured".
 */

const REFRESH_MS = 30_000;

function Tile({
  label,
  value,
  icon: Icon,
  sub,
  tone = 'normal',
}: {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  sub?: string;
  tone?: 'normal' | 'warn';
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <Icon className={`h-4 w-4 ${tone === 'warn' ? 'text-amber-500' : 'text-muted-foreground'}`} />
      </div>
      <div className={`mt-2 text-2xl font-semibold ${tone === 'warn' ? 'text-amber-500' : ''}`}>{value}</div>
      {sub ? <div className="mt-1 text-xs text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

/**
 * Whether a capability is token-priced is now recorded by the backend
 * rather than inferred here from a zero cost. The inference was reasonable
 * but wrong in one real case: a token-priced call that genuinely cost
 * nothing would have been labelled "not token-priced".
 */
function formatCost(entry: ProviderMatrixEntry): string {
  if (!entry.tokenPriced) return 'not token-priced';
  return `$${(entry.totalCostCents / 100).toFixed(4)}`;
}

export default function EngineeringDashboardPage() {
  const latency = useQuery({ queryKey: ['eos', 'latency'], queryFn: getLatency, refetchInterval: REFRESH_MS });
  const errorRate = useQuery({ queryKey: ['eos', 'errorRate'], queryFn: getErrorRate, refetchInterval: REFRESH_MS });
  const matrix = useQuery({ queryKey: ['eos', 'matrix'], queryFn: getProviderMatrix, refetchInterval: REFRESH_MS });
  const prompts = useQuery({ queryKey: ['eos', 'prompts'], queryFn: getPromptReport, refetchInterval: REFRESH_MS });
  const events = useQuery({ queryKey: ['eos', 'events'], queryFn: getEventStats, refetchInterval: REFRESH_MS });
  const capture = useQuery({ queryKey: ['eos', 'capture'], queryFn: getCaptureStatus, refetchInterval: REFRESH_MS });
  const coverage = useQuery({ queryKey: ['eos', 'coverage'], queryFn: getCoverage, refetchInterval: REFRESH_MS });
  // Same query key as the panel below, so the tile and the list share one
  // fetch and can never disagree about how many are waiting.
  const proposals = useQuery({
    queryKey: ['eos', 'proposals'],
    queryFn: () => getProposals(),
    refetchInterval: REFRESH_MS,
  });

  const regressing = prompts.data?.report.filter((p) => p.regressing) ?? [];
  const awaitingDecision = proposals.data?.filter((p) => p.status === 'pending').length ?? 0;
  const errorsNow = errorRate.data?.current.errorsInWindow ?? 0;
  const errorThreshold = errorRate.data?.current.threshold ?? 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Engineering</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Internal platform health, refreshed every 30 seconds. Measurements are held in memory and
          reset when the server restarts, so figures reflect the current process only.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Tile
          label="API p95"
          value={latency.data ? `${latency.data.current.p95} ms` : '—'}
          icon={Gauge}
          sub={latency.data ? `${latency.data.current.count} requests sampled` : 'no requests yet'}
        />
        <Tile
          label="API p50"
          value={latency.data ? `${latency.data.current.p50} ms` : '—'}
          icon={Activity}
          sub={latency.data ? `mean ${latency.data.current.mean} ms` : undefined}
        />
        <Tile
          label="Errors in window"
          value={errorsNow}
          icon={AlertTriangle}
          tone={errorThreshold > 0 && errorsNow >= errorThreshold ? 'warn' : 'normal'}
          sub={errorThreshold > 0 ? `alerts at ${errorThreshold}` : undefined}
        />
        <Tile
          label="Prompts regressing"
          value={regressing.length}
          icon={ShieldCheck}
          tone={regressing.length > 0 ? 'warn' : 'normal'}
          sub={prompts.data ? `${prompts.data.report.length} tracked` : 'none tracked yet'}
        />
        <Tile
          label="Awaiting your decision"
          value={awaitingDecision}
          icon={Inbox}
          tone={awaitingDecision > 0 ? 'warn' : 'normal'}
          sub={awaitingDecision > 0 ? 'proposals below' : 'nothing pending'}
        />
      </div>

      <ProposalsPanel />

      <Section
        title="Coverage"
        description="Which AI paths report to the platform. Unreported paths are invisible to every measurement on this page."
      >
        {coverage.isLoading ? (
          <EmptyHint>Loading…</EmptyHint>
        ) : (
          <ul className="space-y-2">
            {(coverage.data ?? []).map((path) => (
              <li key={path.promptId} className="flex items-center justify-between text-sm">
                <span>{path.label}</span>
                <span
                  className={
                    path.instrumented
                      ? 'text-xs font-medium text-emerald-500'
                      : 'text-xs font-medium text-muted-foreground'
                  }
                >
                  {path.instrumented
                    ? path.observed
                      ? 'reporting'
                      : 'wired, no traffic yet'
                    : 'not instrumented'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Provider capability matrix"
        description="Measured per provider and model from real traffic. Never hardcoded."
      >
        {matrix.isLoading ? (
          <EmptyHint>Loading…</EmptyHint>
        ) : !matrix.data?.length ? (
          <EmptyHint>
            No provider traffic recorded yet. This fills once the platform is deployed and serving
            real requests.
          </EmptyHint>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">Provider / model</th>
                  <th className="pb-2 pr-4 font-medium">Requests</th>
                  <th className="pb-2 pr-4 font-medium">Success</th>
                  <th className="pb-2 pr-4 font-medium">p95</th>
                  <th className="pb-2 font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {matrix.data.map((entry) => (
                  <tr key={`${entry.providerId}:${entry.modelId}`} className="border-b border-border/50">
                    <td className="py-2 pr-4">
                      <span className="font-medium">{entry.providerId}</span>
                      <span className="text-muted-foreground"> / {entry.modelId}</span>
                    </td>
                    <td className="py-2 pr-4">{entry.requests}</td>
                    <td className={`py-2 pr-4 ${entry.successRate < 1 ? 'text-amber-500' : ''}`}>
                      {Math.round(entry.successRate * 100)}%
                    </td>
                    <td className="py-2 pr-4">{entry.p95LatencyMs} ms</td>
                    <td className="py-2 text-muted-foreground">{formatCost(entry)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section
        title="Prompt intelligence"
        description="Success rate per prompt version, with a regression flag when the recent window drops below the historical baseline."
      >
        {prompts.isLoading ? (
          <EmptyHint>Loading…</EmptyHint>
        ) : !prompts.data?.report.length ? (
          <EmptyHint>No prompt executions recorded yet.</EmptyHint>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">Prompt</th>
                  <th className="pb-2 pr-4 font-medium">Runs</th>
                  <th className="pb-2 pr-4 font-medium">Overall</th>
                  <th className="pb-2 pr-4 font-medium">Recent</th>
                  <th className="pb-2 font-medium">State</th>
                </tr>
              </thead>
              <tbody>
                {prompts.data.report.map((entry) => (
                  <tr key={`${entry.promptId}:${entry.version}`} className="border-b border-border/50">
                    <td className="py-2 pr-4">
                      <span className="font-medium">{entry.promptId}</span>
                      <span className="text-muted-foreground"> v{entry.version}</span>
                    </td>
                    <td className="py-2 pr-4">{entry.executions}</td>
                    <td className="py-2 pr-4">{Math.round(entry.successRate * 100)}%</td>
                    <td className="py-2 pr-4">{Math.round(entry.recentSuccessRate * 100)}%</td>
                    <td className="py-2">
                      {entry.regressing ? (
                        <span className="text-xs font-medium text-amber-500">regressing</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">stable</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <div className="grid gap-4 md:grid-cols-2">
        <Section
          title="Evaluation capture"
          description="Real failures become permanent regression tests, subject to consent and redaction."
        >
          {capture.data?.stats.active ? (
            <div className="space-y-1 text-sm">
              <div>
                Captured: <span className="font-medium">{capture.data.stats.captured}</span> of{' '}
                {capture.data.stats.maxCases}
              </div>
              <div className="text-muted-foreground">Skipped: {capture.data.stats.skipped}</div>
            </div>
          ) : (
            <EmptyHint>
              Capture is off. It must be switched on deliberately, because it derives cases from real
              customer interactions.
            </EmptyHint>
          )}
        </Section>

        <Section title="Event bus" description="In-process backbone all collectors publish to.">
          {events.data ? (
            <div className="space-y-1 text-sm">
              <div className="flex items-center gap-2">
                <Boxes className="h-4 w-4 text-muted-foreground" />
                {events.data.totalEmitted} events buffered
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Database className="h-4 w-4" />
                buffer capacity {events.data.bufferSize}
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Cpu className="h-4 w-4" />
                {events.data.listenerCount} listeners attached
              </div>
            </div>
          ) : (
            <EmptyHint>Loading…</EmptyHint>
          )}
        </Section>
      </div>
    </div>
  );
}
