'use client';

import { useState } from 'react';
import { useWorkspaceUsageLedger, formatCost, formatTokens } from '@/lib/api/analytics';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@synora/design-system/components/Card';
import { Button } from '@synora/design-system/components/Button';
import { Spinner } from '@synora/design-system/components/Spinner';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface UsageLedgerProps {
  workspaceId: string;
  dateRange?: { from: string; to: string };
}

const PAGE_SIZE = 20;

export function UsageLedger({ workspaceId, dateRange }: UsageLedgerProps) {
  const [currentPage, setCurrentPage] = useState(0);
  const skip = currentPage * PAGE_SIZE;

  const { data: ledger, isLoading } = useWorkspaceUsageLedger(workspaceId, {
    skip,
    take: PAGE_SIZE,
    from: dateRange?.from,
    to: dateRange?.to,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner size="md" />
      </div>
    );
  }

  if (!ledger || ledger.items.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Usage Ledger</CardTitle>
          <CardDescription>Detailed usage transactions</CardDescription>
        </CardHeader>
        <CardContent className="text-center py-8 text-sm text-muted-foreground">
          No usage data available
        </CardContent>
      </Card>
    );
  }

  const totalPages = Math.ceil(ledger.total / PAGE_SIZE);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Usage Ledger</CardTitle>
        <CardDescription>Detailed usage transactions ({ledger.total} total)</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                  Conversation
                </th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                  Provider
                </th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                  Model
                </th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                  Input
                </th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                  Output
                </th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                  Cost
                </th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                  Date
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {ledger.items.map((entry) => (
                <tr key={entry.id} className="hover:bg-muted/50">
                  <td className="px-3 py-2 font-mono text-xs">
                    {entry.conversationId.slice(0, 8)}...
                  </td>
                  <td className="px-3 py-2 text-sm">{entry.providerId}</td>
                  <td className="px-3 py-2 text-sm">{entry.model}</td>
                  <td className="px-3 py-2 text-right text-sm">
                    {formatTokens(entry.inputTokens)}
                  </td>
                  <td className="px-3 py-2 text-right text-sm">
                    {formatTokens(entry.outputTokens)}
                  </td>
                  <td className="px-3 py-2 text-right font-medium">
                    {formatCost(entry.costCents)}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {new Date(entry.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-4">
            <div className="text-sm text-muted-foreground">
              Page {currentPage + 1} of {totalPages}
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
                disabled={currentPage === 0}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={currentPage >= totalPages - 1}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
