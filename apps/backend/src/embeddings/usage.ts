export interface WorkspaceEmbeddingUsage {
  workspaceId: string;
  totalCalls: number;
  totalTokens: number;
  totalCostUsd: number;
  /** Token/cost totals broken down by provider, so a workspace using multiple providers can see the split. */
  byProvider: Record<string, { calls: number; tokens: number; costUsd: number }>;
}

interface RawWorkspaceUsage {
  totalCalls: number;
  totalTokens: number;
  totalCostUsd: number;
  byProvider: Map<string, { calls: number; tokens: number; costUsd: number }>;
}

function toPublicShape(workspaceId: string, raw: RawWorkspaceUsage): WorkspaceEmbeddingUsage {
  return {
    workspaceId,
    totalCalls: raw.totalCalls,
    totalTokens: raw.totalTokens,
    totalCostUsd: raw.totalCostUsd,
    byProvider: Object.fromEntries(raw.byProvider),
  };
}

/**
 * Per-workspace usage and cost accounting for embeddings — the workspace-
 * isolation counterpart to `./metrics.ts` (which tracks operational health
 * per *provider*, not spend per *workspace*). In-memory today; the shape
 * here (`recordUsage` fed by `service.ts` after every successful embed/
 * embedBatch call) is exactly what a persistence layer would consume to
 * write these into a `ConversationUsage`-style table, the same way
 * `../ai/pricing.ts`'s estimates ultimately land in that model today.
 */
export class UsageAccountant {
  private readonly usage = new Map<string, RawWorkspaceUsage>();

  recordUsage(workspaceId: string, providerId: string, tokens: number, costUsd: number): void {
    const raw = this.usage.get(workspaceId) ?? {
      totalCalls: 0,
      totalTokens: 0,
      totalCostUsd: 0,
      byProvider: new Map(),
    };

    raw.totalCalls += 1;
    raw.totalTokens += tokens;
    raw.totalCostUsd += costUsd;

    const providerUsage = raw.byProvider.get(providerId) ?? { calls: 0, tokens: 0, costUsd: 0 };
    providerUsage.calls += 1;
    providerUsage.tokens += tokens;
    providerUsage.costUsd += costUsd;
    raw.byProvider.set(providerId, providerUsage);

    this.usage.set(workspaceId, raw);
  }

  getWorkspaceUsage(workspaceId: string): WorkspaceEmbeddingUsage {
    const raw = this.usage.get(workspaceId) ?? {
      totalCalls: 0,
      totalTokens: 0,
      totalCostUsd: 0,
      byProvider: new Map(),
    };
    return toPublicShape(workspaceId, raw);
  }

  getAllUsage(): Map<string, WorkspaceEmbeddingUsage> {
    const result = new Map<string, WorkspaceEmbeddingUsage>();
    for (const [workspaceId, raw] of this.usage) {
      result.set(workspaceId, toPublicShape(workspaceId, raw));
    }
    return result;
  }
}

let usageAccountant: UsageAccountant | null = null;

export function getUsageAccountant(): UsageAccountant {
  if (!usageAccountant) {
    usageAccountant = new UsageAccountant();
  }
  return usageAccountant;
}

export function initUsageAccountant(): UsageAccountant {
  usageAccountant = new UsageAccountant();
  return usageAccountant;
}

export function resetUsageAccountantForTests(): void {
  usageAccountant = null;
}
