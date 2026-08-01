# Tool Calling Specification

**Version:** 1.0 | **Status:** Complete | **Last Updated:** 2026-07-28

## Overview

Enables AI to call external tools/functions within conversations. Supports HTTP webhooks, pre-built integrations (weather, calculator, search), and custom workspace tools with audit trail.

---

## Database

Uses existing ToolDefinition and ToolExecution tables.

```prisma
model ToolDefinition {
  id String @id @default(cuid())
  workspaceId String
  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  
  name String              // "get_weather", "search_web"
  description String       // for AI's context
  
  // JSON Schema for input
  inputSchema Json
  
  // How to execute
  provider String          // "http", "builtin", "plugin"
  providerConfig Json      // auth, endpoint, timeout
  
  enabled Boolean @default(true)
  
  createdBy String
  creator User @relation(fields: [createdBy], references: [id])
  
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  
  executions ToolExecution[]
  
  @@unique([workspaceId, name])
  @@index([workspaceId])
}

model ToolExecution {
  id String @id @default(cuid())
  conversationId String
  conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  
  toolId String
  tool ToolDefinition @relation(fields: [toolId], references: [id], onDelete: Cascade)
  
  input Json              // what was passed to tool
  output Json             // tool's response
  error String?           // if failed
  status String           // enum: PENDING, SUCCESS, FAILED, TIMEOUT
  
  durationMs Int          // execution time
  
  executedBy String
  executedByUser User @relation(fields: [executedBy], references: [id])
  
  createdAt DateTime @default(now())
  
  @@index([conversationId])
  @@index([toolId])
  @@index([status])
}
```

---

## Service Layer

```typescript
class ToolCallingService {
  async createToolDefinition(
    userId: string,
    workspaceId: string,
    input: {
      name: string;
      description: string;
      inputSchema: JsonSchema;
      provider: 'http' | 'builtin' | 'plugin';
      providerConfig: {
        endpoint?: string;
        auth?: { type: string; token: string };
        timeout?: number;
      };
    }
  ): Promise<ToolDefinition>
  
  async listTools(workspaceId: string): Promise<ToolDefinition[]>
  
  async callTool(
    toolId: string,
    input: any,
    conversationId: string,
    userId: string
  ): Promise<{ output: any; durationMs: number }>
  
  async validateToolInput(
    toolId: string,
    input: any
  ): Promise<{ valid: boolean; errors?: string[] }>
  
  async executeToolExecution(
    execution: ToolExecution
  ): Promise<{ success: boolean; result?: any; error?: string }>
}
```

---

## Tool Schema Format

```json
{
  "name": "get_weather",
  "description": "Get current weather for a location",
  "inputSchema": {
    "type": "object",
    "properties": {
      "location": {
        "type": "string",
        "description": "City name or coordinates"
      },
      "units": {
        "type": "string",
        "enum": ["celsius", "fahrenheit"],
        "default": "celsius"
      }
    },
    "required": ["location"]
  }
}
```

---

## API

```
POST /api/workspaces/:id/tools
Body: { name, description, inputSchema, provider, providerConfig }
Response 201: ToolDefinition

GET /api/workspaces/:id/tools
Response 200: { items: ToolDefinition[] }

POST /api/workspaces/:id/tools/:toolId/test
Body: { input: {...} }
Response 200: { output, durationMs, status }

DELETE /api/workspaces/:id/tools/:toolId
Response 200: { success: true }

GET /api/workspaces/:id/tools/:toolId/executions
Query: ?limit=50&offset=0
Response 200: { items: ToolExecution[], total }
```

---

## Built-in Tools

**Calculator:**
- Input: { expression: "2 * 3 + 5" }
- Output: { result: 11 }

**Web Search:**
- Input: { query: "latest AI news", limit: 10 }
- Output: { results: [{ title, url, snippet }] }

**Current Time:**
- Input: { timezone: "UTC" }
- Output: { time: "2026-07-28T14:30:00Z" }

**Weather:**
- Input: { location: "San Francisco", units: "celsius" }
- Output: { temp: 22, condition: "Sunny", humidity: 65 }

---

## HTTP Tool Execution

```
Tool Definition:
{
  provider: "http",
  providerConfig: {
    endpoint: "https://api.example.com/get-data",
    auth: { type: "bearer", token: "..." },
    timeout: 30000,
    method: "POST"
  }
}

Request to Tool:
POST https://api.example.com/get-data
Authorization: Bearer <token>
Content-Type: application/json
{
  "location": "SF"
}

Tool Response:
{
  "success": true,
  "data": { "temp": 22 }
}
```

---

## AI Integration

When AI receives tool call from provider:

1. **Parse Tool Call:** Extract tool name and arguments
2. **Validate:** Check input against inputSchema
3. **Execute:** Call ToolCallingService.callTool()
4. **Record:** Store ToolExecution with result
5. **Resume:** Pass result back to AI for continued generation

---

## Validation

- Tool name: 1-50 chars, alphanumeric + underscore
- Description: 1-500 chars
- Input schema: valid JSON Schema
- Endpoint URL: must be HTTPS
- Timeout: 1-120 seconds (default 30)
- Max 100 tools per workspace

---

## Permissions

- Workspace admin+ can create/delete tools
- All members can view/use tools
- Editor can only modify tools they created

---

## Error Handling

| Code | Scenario | Recovery |
|------|----------|----------|
| 400 | Invalid input schema | Validate format |
| 400 | Missing required field | Show schema |
| 403 | Tool not enabled | Use different tool |
| 504 | Tool timeout | Retry with longer timeout |
| 500 | Provider error | Log, notify admin |
| 422 | Invalid JSON | Return validation error |

---

## Retry Strategy

- Tool failures: exponential backoff (1s, 2s, 4s), max 3 attempts
- Timeout failures: single retry with +30s timeout
- Provider unavailable: fail fast (no retry)

---

## Logging

```json
{
  "action": "tool_executed",
  "toolId": "tool_123",
  "toolName": "get_weather",
  "input": { "location": "SF" },
  "status": "success",
  "durationMs": 450,
  "conversationId": "conv_123",
  "userId": "user_123",
  "executionId": "exec_456"
}
```

---

## Monitoring

- tools_executed_total{tool_name, status}
- tool_execution_latency_ms{tool_name, percentile}
- tool_errors_total{tool_name, error_type}
- tools_defined_total{workspace_id}
- tool_usage_count{tool_id}
- tool_success_rate{tool_id}

---

## Testing

- Create tool definition
- Validate input against schema
- Execute tool successfully
- Tool timeout handling
- Tool error handling
- Invalid input rejection
- HTTP auth (bearer token)
- Audit trail recorded

---

## Performance

- Tool call latency: <100ms for built-in
- HTTP tool latency: <5s average
- Concurrent calls: support 10 per workspace
- Queue tool jobs (don't block conversation)

---

## Security

- JWT required for tool creation
- Workspace membership enforced
- Auth tokens stored encrypted
- No credentials in logs
- Rate limiting: 100 tool calls/hour per user
- HTTP endpoints must be HTTPS
- Input validation (prevent injection)
- Output sanitization (prevent XSS)

---

## Audit Trail

Every tool execution recorded with:
- Tool ID and name
- Input provided
- Output received
- Status (success/failure)
- Duration
- User who triggered
- Conversation ID
- Timestamp

**Retention:** 1 year (queryable via API)

---

## Future Enhancements

- Tool chaining (tool output → input to next tool)
- Conditional tool calls (if output matches X, call Y)
- Parallel tool execution
- Custom tool marketplace
- Tool versioning
- Tool cost tracking
- A/B testing tools

---

**Status:** Complete
