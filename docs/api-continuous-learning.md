# Continuous Learning Platform - API Documentation

**Version**: 1.0.0  
**Base URL**: `/api/workspaces/:workspaceId`  
**Authentication**: Bearer token (JWT) required for all endpoints

---

## Overview

The Continuous Learning Platform API provides endpoints for managing privacy consent, model lifecycle, evaluations, and dataset exports. This subsystem supports enterprise AI operations with compliance, versioning, and performance tracking.

### Key Features

- **Privacy Consent Management**: GDPR-compliant opt-in/opt-out controls for training data usage
- **Model Registry**: Lifecycle management for model versions (DRAFT → TRAINING → EVALUATING → RELEASED → DEPRECATED)
- **Evaluation & Benchmarking**: Run evaluations and compare model performance
- **Dataset Export**: Export training datasets in multiple formats for RLHF/DPO/SFT/Tool-Use training

---

## Privacy Consent Management

### Set User Consent

```
POST /privacy/consent
```

Set or update privacy consent preferences for a user in a workspace.

**Request Body:**

```json
{
  "collectFeedback": boolean,        // optional, collect user feedback on responses
  "useForTraining": boolean,          // optional, use data for model training
  "shareWithPartners": boolean,       // optional, share data with research partners
  "allowEvaluation": boolean          // optional, allow use in model evaluation
}
```

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "id": "consent-123",
    "userId": "user-123",
    "workspaceId": "workspace-123",
    "collectFeedback": true,
    "useForTraining": true,
    "shareWithPartners": false,
    "allowEvaluation": true,
    "consentGivenAt": "2026-08-01T10:30:00Z",
    "updatedAt": "2026-08-01T10:30:00Z"
  },
  "meta": {
    "timestamp": "2026-08-01T10:30:00Z",
    "version": "1.0.0"
  }
}
```

---

### Get User Consent

```
GET /privacy/consent
```

Retrieve current privacy consent preferences for a user.

**Query Parameters**: None

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "id": "consent-123",
    "collectFeedback": true,
    "useForTraining": true,
    "shareWithPartners": false,
    "allowEvaluation": true,
    "consentGivenAt": "2026-08-01T10:30:00Z"
  },
  "meta": {
    "timestamp": "2026-08-01T10:30:00Z",
    "version": "1.0.0"
  }
}
```

**Response (404 Not Found):**

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Consent record not found for this user in workspace"
  }
}
```

---

### Revoke User Consent

```
POST /privacy/consent/revoke
```

Revoke all privacy consent for a user (opt-out completely).

**Request Body**: None

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "success": true
  }
}
```

---

### Set Conversation Training Consent

```
POST /conversations/:conversationId/training-consent
```

Set whether a specific conversation can be used for training or evaluation.

**Request Body:**

```json
{
  "allowUseInTraining": boolean,    // Allow conversation for training data
  "allowUseInEvaluation": boolean   // Allow conversation for evaluation
}
```

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "id": "tc-123",
    "conversationId": "conv-123",
    "userId": "user-123",
    "workspaceId": "workspace-123",
    "allowUseInTraining": true,
    "allowUseInEvaluation": false,
    "createdAt": "2026-08-01T10:30:00Z"
  }
}
```

---

### Get Conversation Training Consent

```
GET /conversations/:conversationId/training-consent
```

Retrieve training consent for a specific conversation.

**Query Parameters**: None

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "id": "tc-123",
    "conversationId": "conv-123",
    "allowUseInTraining": true,
    "allowUseInEvaluation": false
  }
}
```

---

### Delete User Data (GDPR)

```
POST /privacy/delete-data
```

Delete all personal data for a user from a workspace (GDPR Article 17 Right to Erasure).

**Request Body**: None

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "deletedCount": 42
  }
}
```

Deleted data includes:
- User feedback and corrections
- Preferred responses
- Hallucination reports
- Training consent records
- Message ratings and preferences

---

## Model Registry

### Create Model

```
POST /models
```

Register a new AI model in the workspace model registry.

**Request Body:**

```json
{
  "modelName": "Claude 3 Opus",              // required, model display name
  "description": "Anthropic Claude 3 Opus",  // optional
  "providerId": "anthropic"                  // required, AI provider
}
```

**Response (201 Created):**

```json
{
  "success": true,
  "data": {
    "id": "model-123",
    "workspaceId": "workspace-123",
    "modelName": "Claude 3 Opus",
    "description": "Anthropic Claude 3 Opus",
    "providerId": "anthropic",
    "createdAt": "2026-08-01T10:30:00Z",
    "createdBy": "user-123"
  }
}
```

---

### List Models

```
GET /models
```

List all models in a workspace with pagination.

**Query Parameters:**

```
skip=0      // Pagination offset
take=20     // Results per page (default: 20)
```

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "model-123",
        "modelName": "Claude 3 Opus",
        "providerId": "anthropic",
        "versionCount": 5,
        "createdAt": "2026-08-01T10:30:00Z"
      }
    ],
    "total": 42,
    "skip": 0,
    "take": 20
  }
}
```

---

### Get Model

```
GET /models/:modelId
```

Retrieve details for a specific model.

**Query Parameters**: None

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "id": "model-123",
    "modelName": "Claude 3 Opus",
    "description": "Anthropic Claude 3 Opus",
    "providerId": "anthropic",
    "versions": 5,
    "latestVersion": "3.0.2",
    "productionVersion": "3.0.1",
    "createdAt": "2026-08-01T10:30:00Z",
    "deprecatedAt": null
  }
}
```

---

### Create Model Version

```
POST /models/:modelId/versions
```

Create a new version of a model.

**Request Body:**

```json
{
  "versionNumber": "1.0.0",           // required, semantic versioning
  "status": "DRAFT",                  // required, initial status (DRAFT | TRAINING | EVALUATING | RELEASED | DEPRECATED)
  "performanceMetrics": {             // optional, initial metrics
    "accuracy": 0.95,
    "f1_score": 0.93,
    "latency_ms": 150
  }
}
```

**Status Enum:**
- `DRAFT`: Initial version, not ready for production
- `TRAINING`: Currently being trained/fine-tuned
- `EVALUATING`: Under evaluation by LLM-as-Judge
- `RELEASED`: Production version
- `DEPRECATED`: No longer supported

**Response (201 Created):**

```json
{
  "success": true,
  "data": {
    "id": "version-123",
    "modelId": "model-123",
    "versionNumber": "1.0.0",
    "status": "DRAFT",
    "performanceMetrics": {
      "accuracy": 0.95,
      "f1_score": 0.93,
      "latency_ms": 150
    },
    "createdAt": "2026-08-01T10:30:00Z"
  }
}
```

---

### Promote Version

```
POST /models/:modelId/versions/:versionId/promote
```

Promote a version to a new lifecycle status.

**Request Body:**

```json
{
  "newStatus": "RELEASED"  // required, target status
}
```

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "id": "version-123",
    "versionNumber": "1.0.0",
    "status": "RELEASED",
    "promotedAt": "2026-08-01T10:30:00Z",
    "promotedBy": "user-123"
  }
}
```

---

### Get Version History

```
GET /models/:modelId/versions
```

List all versions of a model with their lifecycle states.

**Query Parameters**: None

**Response (200 OK):**

```json
{
  "success": true,
  "data": [
    {
      "id": "version-123",
      "versionNumber": "3.0.1",
      "status": "RELEASED",
      "isProduction": true,
      "createdAt": "2026-07-15T10:30:00Z"
    },
    {
      "id": "version-122",
      "versionNumber": "3.0.0",
      "status": "RELEASED",
      "isProduction": false,
      "createdAt": "2026-07-08T10:30:00Z"
    }
  ]
}
```

---

### Get Production Version

```
GET /models/:modelId/production
```

Get the currently active production version (no auth required).

**Query Parameters**: None

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "id": "version-123",
    "modelId": "model-123",
    "modelName": "Claude 3 Opus",
    "versionNumber": "3.0.1",
    "status": "RELEASED",
    "performanceMetrics": {
      "accuracy": 0.96,
      "latency_ms": 140
    }
  }
}
```

---

### Compare Versions

```
POST /models/compare
```

Compare performance metrics across multiple model versions.

**Request Body:**

```json
{
  "versionIds": ["version-123", "version-122", "version-121"]  // 2+ versions
}
```

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "versions": [
      {
        "id": "version-123",
        "versionNumber": "3.0.1",
        "status": "RELEASED",
        "metrics": {
          "accuracy": 0.96,
          "f1_score": 0.95,
          "latency_ms": 140
        }
      }
    ],
    "bestVersion": "version-123",
    "improvementPct": 2.1
  }
}
```

---

### Get Version Metrics

```
GET /models/:modelId/versions/:versionId/metrics
```

Retrieve detailed performance metrics for a version.

**Query Parameters**: None

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "versionId": "version-123",
    "metrics": {
      "accuracy": 0.96,
      "precision": 0.94,
      "recall": 0.97,
      "f1_score": 0.95,
      "latency_ms": 140,
      "throughput_rps": 1000
    },
    "timestamp": "2026-08-01T10:30:00Z"
  }
}
```

---

### Deprecate Model

```
POST /models/:modelId/deprecate
```

Mark a model as deprecated (no longer support).

**Request Body**: None

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "success": true,
    "deprecatedAt": "2026-08-01T10:30:00Z",
    "message": "Model marked as deprecated. Current users should migrate to a newer version."
  }
}
```

---

## Evaluation & Benchmarking

### Create Evaluation Run

```
POST /evaluations
```

Create a new evaluation run for one or more models against a dataset.

**Request Body:**

```json
{
  "datasetId": "dataset-123",           // required
  "modelId": "model-123",               // required
  "metrics": ["accuracy", "latency", "f1_score"]  // required, 1+ metrics
}
```

**Supported Metrics:**
- `accuracy`: Classification accuracy
- `f1_score`: F1 score
- `precision`: Precision metric
- `recall`: Recall metric
- `latency`: Response time (ms)
- `throughput`: Requests per second
- `hallucination_rate`: LLM hallucination %
- `factuality_score`: Factual correctness
- `helpfulness_score`: User-rated helpfulness

**Response (201 Created):**

```json
{
  "success": true,
  "data": {
    "id": "eval-run-123",
    "datasetId": "dataset-123",
    "modelId": "model-123",
    "metrics": ["accuracy", "latency", "f1_score"],
    "status": "PENDING",
    "progress": 0,
    "createdAt": "2026-08-01T10:30:00Z"
  }
}
```

---

### List Evaluation Runs

```
GET /evaluations
```

List all evaluation runs in the workspace.

**Query Parameters:**

```
skip=0         // Pagination offset
take=20        // Results per page
status=PENDING // Optional: filter by status (PENDING, RUNNING, COMPLETED, FAILED)
```

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "eval-run-123",
        "datasetId": "dataset-123",
        "modelId": "model-123",
        "status": "COMPLETED",
        "progress": 100,
        "createdAt": "2026-08-01T10:30:00Z",
        "completedAt": "2026-08-01T11:45:00Z"
      }
    ],
    "total": 42,
    "skip": 0,
    "take": 20
  }
}
```

---

### Get Evaluation Results

```
GET /evaluations/:runId
```

Retrieve results for a completed evaluation run.

**Query Parameters**: None

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "id": "eval-run-123",
    "datasetId": "dataset-123",
    "modelId": "model-123",
    "status": "COMPLETED",
    "results": {
      "accuracy": 0.96,
      "f1_score": 0.94,
      "latency_ms": 145,
      "throughput_rps": 950,
      "hallucination_rate": 0.02
    },
    "samplesEvaluated": 1000,
    "completedAt": "2026-08-01T11:45:00Z",
    "duration_ms": 4500
  }
}
```

---

### Run Evaluation (Trigger Execution)

```
POST /evaluations/:runId/run
```

Trigger execution of a pending evaluation run (spawns background job).

**Request Body**: None

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "id": "eval-run-123",
    "status": "RUNNING",
    "jobId": "job-worker-456",
    "startedAt": "2026-08-01T10:30:00Z"
  }
}
```

---

### Compare Models

```
POST /evaluations/compare
```

Run evaluations and compare performance across multiple models.

**Request Body:**

```json
{
  "datasetId": "dataset-123",
  "modelIds": ["model-1", "model-2", "model-3"]  // 2+ models
}
```

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "datasetId": "dataset-123",
    "models": [
      {
        "modelId": "model-1",
        "modelName": "Claude 3 Opus",
        "metrics": {
          "accuracy": 0.96,
          "f1_score": 0.94,
          "latency_ms": 145
        },
        "rank": 1
      },
      {
        "modelId": "model-2",
        "modelName": "GPT-4",
        "metrics": {
          "accuracy": 0.94,
          "f1_score": 0.91,
          "latency_ms": 200
        },
        "rank": 2
      }
    ],
    "winner": "model-1",
    "winnerMetric": "accuracy"
  }
}
```

---

## Dataset Export

### Export Dataset

```
POST /datasets/:datasetId/exports
```

Create a dataset export in a specified format.

**Request Body:**

```json
{
  "format": "JSONL",            // required: JSONL, CSV, PARQUET
  "includePII": false,          // optional, filter PII (default: false)
  "maxSamples": 10000           // optional, limit samples
}
```

**Supported Formats:**
- `JSONL`: JSON Lines (one record per line)
- `CSV`: Comma-separated values
- `PARQUET`: Columnar Apache Parquet format

**Response (201 Created):**

```json
{
  "success": true,
  "data": {
    "id": "export-123",
    "datasetId": "dataset-123",
    "format": "JSONL",
    "includePII": false,
    "maxSamples": 10000,
    "status": "PROCESSING",
    "progress": 0,
    "fileSize": null,
    "createdAt": "2026-08-01T10:30:00Z"
  }
}
```

---

### Get Export Status

```
GET /datasets/:datasetId/exports/:exportId
```

Check status and progress of a dataset export.

**Query Parameters**: None

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "id": "export-123",
    "datasetId": "dataset-123",
    "format": "JSONL",
    "status": "COMPLETED",
    "progress": 100,
    "fileSize": 52428800,
    "rowsExported": 10000,
    "fileUrl": "https://s3.example.com/exports/export-123.jsonl",
    "createdAt": "2026-08-01T10:30:00Z",
    "completedAt": "2026-08-01T10:45:00Z",
    "expiresAt": "2026-08-15T10:45:00Z"
  }
}
```

**Status Values:**
- `PENDING`: Queued for processing
- `PROCESSING`: Export in progress
- `COMPLETED`: Ready for download
- `FAILED`: Export failed, check error message
- `EXPIRED`: Export link expired

---

### Download Export

```
GET /datasets/:datasetId/exports/:exportId/download
```

Download the exported dataset (redirects to S3 presigned URL).

**Query Parameters**: None

**Response (302 Found):**

```
Location: https://s3.example.com/uploads/export-123.jsonl?...
```

Or, if export not ready:

**Response (404 Not Found):**

```json
{
  "success": false,
  "error": {
    "code": "EXPORT_NOT_READY",
    "message": "Export is still processing. Check back in a few moments."
  }
}
```

---

### Delete Export

```
DELETE /datasets/:datasetId/exports/:exportId
```

Delete an export and remove stored file.

**Request Body**: None

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "success": true
  }
}
```

---

## Error Responses

All endpoints return error responses in a standard format:

**400 Bad Request** (Validation Error):

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid format: must be JSONL, CSV, or PARQUET",
    "details": {
      "field": "format",
      "value": "invalid"
    }
  }
}
```

**401 Unauthorized** (Missing or Invalid Token):

```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid or expired authentication token"
  }
}
```

**403 Forbidden** (Insufficient Permissions):

```json
{
  "success": false,
  "error": {
    "code": "FORBIDDEN",
    "message": "You do not have permission to access this resource"
  }
}
```

**404 Not Found**:

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Resource not found"
  }
}
```

**500 Internal Server Error**:

```json
{
  "success": false,
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "An unexpected error occurred"
  }
}
```

---

## Rate Limiting

All endpoints are subject to workspace-level rate limits:

- Default: 100 requests per 15 minutes
- Headers returned:
  - `X-RateLimit-Limit`: 100
  - `X-RateLimit-Remaining`: 95
  - `X-RateLimit-Reset`: Unix timestamp (seconds)

Rate limit errors return HTTP 429:

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests. Try again later.",
    "retryAfter": 900
  }
}
```

---

## Authentication

All endpoints require a valid JWT Bearer token:

```bash
curl -H "Authorization: Bearer <JWT_TOKEN>" \
  https://api.synora.app/api/workspaces/:workspaceId/models
```

Token Requirements:
- Issued by Synora auth service
- Scoped to workspace
- Expires in 15 minutes (refresh token: 7 days)
- Contains `userId`, `workspaceId`, `sub` (subject)

---

## Examples

### Example: Export dataset for RLHF training

```bash
# Create export
curl -X POST \
  https://api.synora.app/api/workspaces/ws-123/datasets/ds-456/exports \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "format": "JSONL",
    "includePII": false,
    "maxSamples": 50000
  }'

# Check status
curl https://api.synora.app/api/workspaces/ws-123/datasets/ds-456/exports/export-789 \
  -H "Authorization: Bearer $TOKEN"

# Download when ready
curl -L https://api.synora.app/api/workspaces/ws-123/datasets/ds-456/exports/export-789/download \
  -H "Authorization: Bearer $TOKEN" \
  -o training_data.jsonl
```

### Example: Compare models and promote winner

```bash
# Compare 3 models
COMPARISON=$(curl -X POST \
  https://api.synora.app/api/workspaces/ws-123/evaluations/compare \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "datasetId": "ds-456",
    "modelIds": ["model-1", "model-2", "model-3"]
  }')

WINNER=$(echo $COMPARISON | jq -r '.data.winner')

# Promote winner to production
curl -X POST \
  https://api.synora.app/api/workspaces/ws-123/models/$WINNER/versions/v-latest/promote \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"newStatus": "RELEASED"}'
```

---

## Webhook Events

Async operations (exports, evaluations) emit webhook events:

**Topic**: `continuous_learning.export.completed`
```json
{
  "event": "export.completed",
  "exportId": "export-123",
  "datasetId": "dataset-123",
  "format": "JSONL",
  "fileSize": 52428800,
  "fileUrl": "https://s3.example.com/...",
  "timestamp": "2026-08-01T10:45:00Z"
}
```

**Topic**: `continuous_learning.evaluation.completed`
```json
{
  "event": "evaluation.completed",
  "runId": "eval-run-123",
  "modelId": "model-123",
  "status": "COMPLETED",
  "results": { "accuracy": 0.96, ... },
  "timestamp": "2026-08-01T11:45:00Z"
}
```

---

## Best Practices

1. **Privacy First**: Always set `includePII: false` for exports unless explicitly required
2. **Pagination**: Use `skip` and `take` for large datasets to avoid timeout
3. **Polling**: Use exponential backoff when checking export/evaluation status
4. **Webhooks**: Subscribe to webhook events instead of polling for completion
5. **Versioning**: Always promote versions through full lifecycle (DRAFT → EVALUATING → RELEASED)
6. **Metrics**: Track all model versions with comprehensive metrics for comparison
7. **Consent**: Verify privacy consent before using conversation data for training

---

**Last Updated**: 2026-08-01  
**Status**: Production Ready
