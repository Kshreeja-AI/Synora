# Model Selector Specification

**Version:** 1.0 | **Status:** Complete | **Last Updated:** 2026-07-28

## Overview

Selects optimal AI model based on workspace settings, conversation context, user preferences, and input complexity. Considers cost, speed, and quality.

---

## Service Layer

```typescript
class ModelSelector {
  selectModel(options: {
    workspaceId: string;
    userId: string;
    conversationId?: string;
    inputLength: number;  // chars
    complexity?: 'simple' | 'moderate' | 'complex';
    preferredProvider?: string;
  }): { providerId: string; model: string }
}
```

---

## Selection Logic

**Priority:**
1. User preference (if set)
2. Workspace default
3. Context-based:
   - Simple queries (< 500 chars) → fast model (Claude Haiku, GPT-4 mini)
   - Complex queries (> 5000 chars) → powerful model (Claude Opus, GPT-4)
   - Moderate → balanced (Claude Sonnet)
4. Cost optimization (if workspace has budget constraints)

**Cost-Quality Matrix:**

| Model | Speed | Quality | Cost |
|-------|-------|---------|------|
| Claude Haiku | Fast | Good | Low |
| Claude Sonnet | Fast | Excellent | Medium |
| Claude Opus | Slow | Best | High |
| GPT-4 | Slow | Best | High |

---

## Database

Store preferences in Workspace:
```prisma
model Workspace {
  // ... existing fields ...
  
  defaultAiModel String @default("claude-opus")
  preferredProvider String @default("anthropic")
  costOptimization Boolean @default(false)
}
```

---

## API

```
POST /api/workspaces/:workspaceId/select-model
Authorization: Bearer <jwt>

Request:
{
  "inputLength": 1500,
  "complexity": "moderate"
}

Response 200:
{
  "success": true,
  "data": {
    "providerId": "anthropic",
    "model": "claude-sonnet",
    "reason": "Balanced quality/cost for moderate complexity"
  }
}
```

---

## Validation

- complexity: 'simple' | 'moderate' | 'complex' or auto-detect
- inputLength: 0-50000
- provider: must be available

---

## Logging

```json
{
  "action": "model_selected",
  "providerId": "anthropic",
  "model": "claude-sonnet",
  "complexity": "moderate",
  "reason": "balanced quality/cost",
  "workspaceId": "ws_123"
}
```

---

## Testing

- Select model for each complexity level
- Cost optimization mode
- Fallback when preferred provider unavailable
- User override respected

---

## Performance

- Instant (< 10ms)
- Local decision (no API call)

---

## Future Extensibility

- Model A/B testing
- Per-conversation model override
- Learning from user feedback
- Performance-based ranking

---

**Status:** Complete, ready for implementation
