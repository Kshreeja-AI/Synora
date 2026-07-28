# Analytics Specification

**Version:** 1.0 | **Status:** Complete | **Last Updated:** 2026-07-28

## Overview

Track usage metrics, token counts, costs, and generate analytics reports. Provides workspace-level dashboards and per-conversation cost tracking.

---

## Database

```prisma
model ConversationUsage {
  id String @id @default(cuid())
  conversationId String @unique
  conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  
  totalInputTokens Int @default(0)
  totalOutputTokens Int @default(0)
  
  // Cost tracking per provider
  costByProvider Json @default("{}")  // { "anthropic": 0.001, "openai": 0.002 }
  totalCostCents Int @default(0)      // sum across providers
  
  updatedAt DateTime @updatedAt
  
  @@index([conversationId])
}

model CreditLedger {
  id String @id @default(cuid())
  workspaceId String
  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  
  type String           // enum: PURCHASE, USAGE, REFUND, ADJUSTMENT
  amount Int            // cents (negative for usage)
  description String
  
  conversationId String?
  messageId String?
  
  createdBy String?
  createdByUser User? @relation(fields: [createdBy], references: [id], onDelete: SetNull)
  
  createdAt DateTime @default(now())
  
  @@index([workspaceId, createdAt])
  @@index([type])
}
```

---

## Service Layer

```typescript
class AnalyticsService {
  async recordUsage(
    conversationId: string,
    input: {
      inputTokens: number;
      outputTokens: number;
      provider: string;
      model: string;
    }
  ): Promise<void>
  // Called after message generation
  
  async getConversationUsage(conversationId: string): Promise<{
    totalInputTokens: number;
    totalOutputTokens: number;
    costByProvider: Record<string, number>;
    totalCostCents: number;
  }>
  
  async getWorkspaceSummary(
    workspaceId: string,
    dateRange: { from: Date; to: Date }
  ): Promise<{
    totalConversations: number;
    totalMessages: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCostCents: number;
    costByProvider: Record<string, number>;
    costByModel: Record<string, number>;
    topUsers: Array<{ userId: string; conversations: number; costCents: number }>;
    topModels: Array<{ model: string; usage: number; costCents: number }>;
  }>
  
  async getLedger(
    workspaceId: string,
    skip: number = 0,
    take: number = 100
  ): Promise<{
    items: CreditLedger[];
    total: number;
    balance: number;
  }>
  
  async projectCost(
    workspaceId: string,
    model: string,
    estimatedTokens: number
  ): Promise<{ estimatedCentsCents: number; breakdown: Record<string, number> }>
}
```

---

## API

```
GET /api/workspaces/:id/conversations/:conversationId/usage
Response 200: {
  totalInputTokens,
  totalOutputTokens,
  costByProvider,
  totalCostCents
}

GET /api/workspaces/:id/usage/summary
Query: ?from=2026-07-01&to=2026-07-31
Response 200: {
  totalConversations,
  totalMessages,
  totalInputTokens,
  totalOutputTokens,
  totalCostCents,
  costByProvider,
  costByModel,
  topUsers,
  topModels,
  trends: [{ date, costCents, messages }]
}

GET /api/workspaces/:id/usage/ledger
Query: ?skip=0&take=100&type=USAGE
Response 200: {
  items: [{ id, type, amount, description, createdAt }],
  total,
  balance
}

GET /api/workspaces/:id/usage/forecast
Query: ?days=30
Response 200: {
  projectedCostCents,
  projectedMessages,
  averageCostPerMessage,
  trends: [{ day, projected }]
}

POST /api/workspaces/:id/usage/export
Body: { format: "csv", dateRange: { from, to } }
Response 200: CSV file (or 202 for async)
```

---

## Provider Pricing

```typescript
const PRICING = {
  anthropic: {
    'claude-opus': { input: 0.015, output: 0.075 },      // per 1K tokens
    'claude-sonnet': { input: 0.003, output: 0.015 },
    'claude-haiku': { input: 0.00025, output: 0.00125 },
  },
  openai: {
    'gpt-4': { input: 0.03, output: 0.06 },
    'gpt-4-turbo': { input: 0.01, output: 0.03 },
    'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
  },
  google: {
    'gemini-pro': { input: 0.0005, output: 0.0015 },
  },
}
```

---

## Cost Calculation

```
Input Cost = inputTokens / 1000 * provider_pricing[provider][model].input_price
Output Cost = outputTokens / 1000 * provider_pricing[provider][model].output_price
Total Cost = Input Cost + Output Cost (in cents)
```

---

## Validation

- Date range: from <= to, max 1 year apart
- Model must exist
- Provider must exist
- Token counts >= 0
- Cost calculations match expected values

---

## Permissions

- Users can view own conversation costs
- Admins can view workspace summary
- Finance team can access ledger

---

## Error Handling

| Code | Scenario | Recovery |
|------|----------|----------|
| 400 | Invalid date range | Show format |
| 400 | Model not found | Show available models |
| 403 | Not authorized | Show permission error |
| 503 | Analytics unavailable | Cache results |

---

## Logging

```json
{
  "action": "usage_recorded",
  "conversationId": "conv_123",
  "provider": "anthropic",
  "model": "claude-opus",
  "inputTokens": 1000,
  "outputTokens": 500,
  "costCents": 112,
  "timestamp": "2026-07-28T14:30:00Z"
}
```

---

## Monitoring

- usage_recorded_total{provider, model}
- tokens_generated_total{role, provider}
- cost_accrued_total{workspace_id, provider}
- usage_cache_hit_rate
- ledger_queries_total

---

## Alerts

- Cost exceeds budget by 10%
- Unexpected token spike (> 2σ)
- Provider pricing changed
- Analytics lag (>5 min behind real-time)

---

## Testing

- Record usage for message
- Calculate cost correctly
- Aggregate by provider
- Aggregate by model
- Ledger entries accurate
- Export CSV format
- Date range filtering

---

## Performance

- Record usage: <100ms
- Workspace summary: <5s (cached 1 hour)
- Ledger query: <2s (indexed)
- Cost projection: <1s

---

## Caching Strategy

- Workspace summary: 1-hour TTL
- Ledger entries: 30-minute TTL
- Provider pricing: 24-hour TTL
- Usage forecasts: hourly recalculation

---

## Data Retention

- Per-message costs: 7 years (for audits)
- Ledger entries: 7 years
- Summaries: indefinite
- Usage exports: 30-day retention (S3)

---

## Security

- JWT required
- Workspace membership enforced
- Financial data encrypted at rest
- Audit log all ledger changes
- Rate limiting on ledger export

---

## Reporting Features

**Workspace Dashboard:**
- Total cost (month/all-time)
- Cost by provider (pie chart)
- Cost by model (bar chart)
- Trend line (tokens/day)
- Top users (by cost)

**Ledger Export:**
- Conversation, Provider, Model, Tokens, Cost, Date
- Suitable for accounting/finance

**Forecasting:**
- Current burn rate
- Projected monthly cost
- Budget remaining
- Cost per user/conversation

---

## Future Enhancements

- Real-time dashboard (sub-minute updates)
- Budget alerts (configurable thresholds)
- Chargeback to users/projects
- Cost attribution (per-team, per-project)
- Discount tracking (bulk rates)
- ROI calculations (cost vs. output quality)

---

**Status:** Complete
