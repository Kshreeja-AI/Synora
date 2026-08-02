'use client';

import { Card } from '@synora/design-system';
import { useCreditBalance, useUsageSummary, useCreditLedger } from '../../../hooks/useBilling';
import { EmptyState } from '@synora/design-system';
import { useCurrentWorkspace } from '../../../hooks/useCurrentWorkspace';
import { UsageOverview } from '../../../components/analytics/UsageOverview';
import { UsageLedger } from '../../../components/analytics/UsageLedger';

export default function UsagePage() {
  // This route has no URL params — the previous `useParams().id` read
  // always yielded '' here, leaving every query disabled and the page
  // stuck on its empty state. The active workspace is the real scope.
  const { currentWorkspace } = useCurrentWorkspace();
  const workspaceId = currentWorkspace?.id || '';

  const { data: credits, isLoading: isLoadingCredits } = useCreditBalance(workspaceId);
  const { data: usage, isLoading: isLoadingUsage } = useUsageSummary(workspaceId);
  const { data: ledger, isLoading: isLoadingLedger } = useCreditLedger(workspaceId);

  if (isLoadingCredits || isLoadingUsage || isLoadingLedger) {
    return (
      <div className="space-y-6">
        <div className="bg-gray-200 dark:bg-gray-700 h-40 rounded animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-gray-200 dark:bg-gray-700 h-64 rounded animate-pulse" />
          <div className="bg-gray-200 dark:bg-gray-700 h-64 rounded animate-pulse" />
        </div>
      </div>
    );
  }

  if (!credits) {
    return (
      <EmptyState
        title="No usage data"
        description="You haven't used any credits yet"
        icon="Zap"
      />
    );
  }

  const usageEntries = usage ? Object.entries(usage) : [];
  const totalCreditsUsed = ledger
    ?.filter((entry) => entry.type === 'DEDUCTION')
    .reduce((sum, entry) => sum + Math.abs(entry.amount), 0) || 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Usage & Credits</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-2">
          Track your credit consumption and usage patterns
        </p>
      </div>

      {/* Credits Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="p-6">
          <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">
            Available Credits
          </h3>
          <p className="text-3xl font-bold">{credits.balance.toLocaleString()}</p>
        </Card>

        <Card className="p-6">
          <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">
            Total Used
          </h3>
          <p className="text-3xl font-bold">{totalCreditsUsed.toLocaleString()}</p>
        </Card>

        <Card className="p-6">
          <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">
            Last 30 Days
          </h3>
          <p className="text-3xl font-bold">
            {ledger
              ?.filter(
                (entry) =>
                  entry.type === 'DEDUCTION' &&
                  new Date(entry.createdAt) > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
              )
              .reduce((sum, entry) => sum + Math.abs(entry.amount), 0)
              .toLocaleString() || 0}
          </p>
        </Card>
      </div>

      {/* Usage by Capability */}
      {usageEntries.length > 0 && (
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">Usage by Capability</h3>
          <div className="space-y-4">
            {usageEntries
              .sort(([, a], [, b]) => b.creditsCost - a.creditsCost)
              .map(([capability, data]) => {
                const percentage =
                  totalCreditsUsed > 0 ? (data.creditsCost / totalCreditsUsed) * 100 : 0;
                return (
                  <div key={capability}>
                    <div className="flex justify-between mb-2">
                      <span className="font-medium capitalize">{capability.replace(/_/g, ' ')}</span>
                      <span className="text-gray-600 dark:text-gray-400 text-sm">
                        {data.creditsCost.toLocaleString()} credits •{' '}
                        {data.quantity.toLocaleString()} uses
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                      <div
                        className="bg-blue-600 h-2 rounded-full transition-all"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                );
              })}
          </div>
        </Card>
      )}

      {/* Credit Ledger */}
      {ledger && ledger.length > 0 && (
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">Recent Transactions</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b dark:border-gray-700">
                <tr>
                  <th className="text-left py-2 px-3 font-medium">Date</th>
                  <th className="text-left py-2 px-3 font-medium">Type</th>
                  <th className="text-left py-2 px-3 font-medium">Reason</th>
                  <th className="text-right py-2 px-3 font-medium">Amount</th>
                  <th className="text-right py-2 px-3 font-medium">Balance</th>
                </tr>
              </thead>
              <tbody>
                {ledger.slice(0, 20).map((entry) => (
                  <tr
                    key={entry.id}
                    className="border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-900"
                  >
                    <td className="py-3 px-3 text-gray-600 dark:text-gray-400">
                      {new Date(entry.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className={`px-2 py-1 rounded text-xs font-medium ${
                          entry.type === 'GRANT'
                            ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
                            : entry.type === 'DEDUCTION'
                              ? 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200'
                              : 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200'
                        }`}
                      >
                        {entry.type}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-gray-700 dark:text-gray-300">
                      {entry.reason}
                    </td>
                    <td
                      className={`py-3 px-3 text-right font-medium ${
                        entry.amount > 0
                          ? 'text-green-600 dark:text-green-400'
                          : 'text-red-600 dark:text-red-400'
                      }`}
                    >
                      {entry.amount > 0 ? '+' : ''}{entry.amount.toLocaleString()}
                    </td>
                    <td className="py-3 px-3 text-right text-gray-700 dark:text-gray-300 font-medium">
                      {entry.balanceAfter.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* AI token/cost analytics, aggregated from per-generation
          accounting. Distinct from the credit ledger above: credits
          are the billing currency, this is the underlying provider
          usage that consumes them. */}
      {workspaceId && (
        <section aria-label="AI usage analytics" className="space-y-6">
          <div>
            <h2 className="text-xl font-semibold">AI Usage</h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Tokens and provider costs across this workspace&apos;s conversations
            </p>
          </div>
          <UsageOverview workspaceId={workspaceId} />
          <UsageLedger workspaceId={workspaceId} />
        </section>
      )}
    </div>
  );
}
