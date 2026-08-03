'use client';

import { useQuery } from '@tanstack/react-query';
import { Loader2, Users, Building2, MessagesSquare, Zap, TrendingUp, DollarSign } from 'lucide-react';
import { getAdminStats, type AdminStats } from '@/lib/api/admin';

function StatTile({
  label,
  value,
  icon: Icon,
  sub,
}: {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
      {sub ? <div className="mt-1 text-xs text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

export default function AdminOverviewPage() {
  const { data, isLoading, error } = useQuery<AdminStats>({
    queryKey: ['admin', 'stats'],
    queryFn: getAdminStats,
    // Refresh cadence: overview polling should be cheap and current, but not
    // so fast that a room of open browsers hammers the DB. 30s is a good
    // default; observers scraping /metrics get finer granularity anyway.
    refetchInterval: 30_000,
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Platform overview</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Cross-workspace counters refreshed every 30 seconds. For time series and
          alerting, scrape <code className="rounded bg-muted px-1">/metrics</code>.
        </p>
      </header>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading platform stats…
        </div>
      ) : error ? (
        <div className="rounded border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          Could not load platform stats.
        </div>
      ) : data ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile
            label="Users"
            value={data.totalUsers}
            icon={Users}
            sub={`${data.activeUsers} active`}
          />
          <StatTile label="Workspaces" value={data.totalWorkspaces} icon={Building2} />
          <StatTile
            label="Conversations"
            value={data.totalConversations}
            icon={MessagesSquare}
          />
          <StatTile
            label="Messages"
            value={data.totalMessages}
            icon={Zap}
            sub={`${data.last24hMessages} last 24h`}
          />
          <StatTile
            label="Active subscriptions"
            value={data.activeSubscriptions}
            icon={DollarSign}
          />
          <StatTile
            label="24h volume"
            value={data.last24hMessages}
            icon={TrendingUp}
            sub="messages sent"
          />
        </div>
      ) : null}
    </div>
  );
}
