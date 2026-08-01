'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@synora/design-system/components/Card';
import { Spinner } from '@synora/design-system/components/Spinner';
import { useWorkspaceUsageSummary, formatCost, formatTokens, getPercentage } from '@/lib/api/analytics';
import { TrendingUp } from 'lucide-react';

interface UsageOverviewProps {
  workspaceId: string;
  dateRange?: { from: string; to: string };
}

export function UsageOverview({ workspaceId, dateRange }: UsageOverviewProps) {
  const { data: summary, isLoading } = useWorkspaceUsageSummary(workspaceId, dateRange);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner size="md" />
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
        No usage data available
      </div>
    );
  }

  const metrics = [
    {
      label: 'Total Conversations',
      value: summary.totalConversations,
      formatted: String(summary.totalConversations),
    },
    {
      label: 'Total Messages',
      value: summary.totalMessages,
      formatted: String(summary.totalMessages),
    },
    {
      label: 'Input Tokens',
      value: summary.totalInputTokens,
      formatted: formatTokens(summary.totalInputTokens),
    },
    {
      label: 'Output Tokens',
      value: summary.totalOutputTokens,
      formatted: formatTokens(summary.totalOutputTokens),
    },
    {
      label: 'Total Cost',
      value: summary.totalCostCents,
      formatted: formatCost(summary.totalCostCents),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {metrics.map((metric) => (
          <Card key={metric.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                {metric.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{metric.formatted}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Provider Breakdown
          </CardTitle>
          <CardDescription>Cost distribution by AI provider</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {summary.topProviders && summary.topProviders.length > 0 ? (
              summary.topProviders.map((provider) => (
                <div key={provider.provider} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium">{provider.provider}</span>
                    <span className="text-muted-foreground">
                      {formatCost(provider.costCents)}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-blue-500"
                      style={{
                        width: `${getPercentage(provider.costCents, summary.totalCostCents)}%`,
                      }}
                    />
                  </div>
                </div>
              ))
            ) : (
              <div className="text-sm text-muted-foreground">No provider usage data</div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
