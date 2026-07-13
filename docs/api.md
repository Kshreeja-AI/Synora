# Synora AI API Documentation

## Base URL
```
http://localhost:3001/api
```

## Authentication
All protected endpoints require an `Authorization` header:
```
Authorization: Bearer <jwt_token>
```

## Response Format

### Success Response
```json
{
  "success": true,
  "data": { /* response data */ },
  "meta": {
    "timestamp": "2026-01-13T12:00:00Z",
    "version": "1.0.0"
  }
}
```

### Error Response
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable error message",
    "details": { /* optional error details */ }
  }
}
```

## Authentication Endpoints

### Register
Create a new user account.

**Request**
```http
POST /api/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecurePass123!",
  "name": "User Name" (optional)
}
```

**Response**
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGc...",
    "user": {
      "id": "cuid123",
      "email": "user@example.com",
      "name": "User Name"
    }
  }
}
```

**Status Codes**
- `201`: User created successfully
- `400`: Validation error (invalid email, weak password, etc.)
- `409`: Email already registered

---

### Login
Authenticate and receive JWT token.

**Request**
```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecurePass123!"
}
```

**Response**
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGc...",
    "user": {
      "id": "cuid123",
      "email": "user@example.com",
      "name": "User Name"
    }
  }
}
```

**Status Codes**
- `200`: Authentication successful
- `400`: Invalid credentials
- `422`: Missing required fields

---

### Logout
Invalidate current session.

**Request**
```http
POST /api/auth/logout
Authorization: Bearer <token>
```

**Response**
```json
{
  "success": true,
  "data": { "message": "Logged out successfully" }
}
```

---

## User Endpoints

### Get Current User
Retrieve authenticated user's profile.

**Request**
```http
GET /api/users/me
Authorization: Bearer <token>
```

**Response**
```json
{
  "success": true,
  "data": {
    "id": "cuid123",
    "email": "user@example.com",
    "name": "User Name",
    "image": "https://...",
    "role": "USER",
    "createdAt": "2026-01-13T12:00:00Z"
  }
}
```

**Status Codes**
- `200`: Success
- `401`: Unauthorized
- `404`: User not found

---

### Get User Profile
Retrieve public user profile.

**Request**
```http
GET /api/users/:userId
```

**Response**
```json
{
  "success": true,
  "data": {
    "id": "cuid123",
    "name": "User Name",
    "image": "https://...",
    "createdAt": "2026-01-13T12:00:00Z"
  }
}
```

---

## Project Endpoints

### List Projects
Get all user projects.

**Request**
```http
GET /api/projects
Authorization: Bearer <token>
```

**Response**
```json
{
  "success": true,
  "data": [
    {
      "id": "proj123",
      "name": "My Project",
      "description": "Project description",
      "status": "ACTIVE",
      "createdAt": "2026-01-13T12:00:00Z",
      "updatedAt": "2026-01-13T12:00:00Z"
    }
  ]
}
```

---

### Create Project
Create a new project.

**Request**
```http
POST /api/projects
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "My New Project",
  "description": "Optional description",
  "workspaceId": "workspace123" (optional)
}
```

**Response**
```json
{
  "success": true,
  "data": {
    "id": "proj123",
    "name": "My New Project",
    "description": "Optional description",
    "status": "ACTIVE",
    "createdAt": "2026-01-13T12:00:00Z",
    "updatedAt": "2026-01-13T12:00:00Z"
  }
}
```

**Status Codes**
- `201`: Project created
- `400`: Invalid data
- `401`: Unauthorized

---

### Get Project
Retrieve project details.

**Request**
```http
GET /api/projects/:projectId
Authorization: Bearer <token>
```

**Response**
```json
{
  "success": true,
  "data": {
    "id": "proj123",
    "name": "My Project",
    "description": "Description",
    "status": "ACTIVE",
    "createdAt": "2026-01-13T12:00:00Z",
    "updatedAt": "2026-01-13T12:00:00Z"
  }
}
```

---

## Document Endpoints

### List Documents
Get all user documents.

**Request**
```http
GET /api/documents
Authorization: Bearer <token>
```

**Query Parameters**
- `projectId`: Filter by project (optional)
- `status`: Filter by status (optional)
- `page`: Page number (optional, default: 1)
- `limit`: Items per page (optional, default: 20)

**Response**
```json
{
  "success": true,
  "data": [
    {
      "id": "doc123",
      "title": "Document Title",
      "content": "Document content...",
      "format": "MARKDOWN",
      "status": "PUBLISHED",
      "createdAt": "2026-01-13T12:00:00Z",
      "updatedAt": "2026-01-13T12:00:00Z",
      "publishedAt": "2026-01-13T12:05:00Z"
    }
  ]
}
```

---

### Create Document
Create a new document.

**Request**
```http
POST /api/documents
Authorization: Bearer <token>
Content-Type: application/json

{
  "title": "Document Title",
  "content": "Document content in markdown...",
  "format": "MARKDOWN",
  "projectId": "proj123" (optional)
}
```

**Response**
```json
{
  "success": true,
  "data": {
    "id": "doc123",
    "title": "Document Title",
    "content": "Document content in markdown...",
    "format": "MARKDOWN",
    "status": "DRAFT",
    "createdAt": "2026-01-13T12:00:00Z",
    "updatedAt": "2026-01-13T12:00:00Z"
  }
}
```

**Status Codes**
- `201`: Document created
- `400`: Invalid data
- `401`: Unauthorized

---

### Get Document
Retrieve document details.

**Request**
```http
GET /api/documents/:documentId
Authorization: Bearer <token>
```

**Response**
```json
{
  "success": true,
  "data": {
    "id": "doc123",
    "title": "Document Title",
    "content": "Full document content...",
    "format": "MARKDOWN",
    "status": "PUBLISHED",
    "createdAt": "2026-01-13T12:00:00Z",
    "updatedAt": "2026-01-13T12:00:00Z",
    "publishedAt": "2026-01-13T12:05:00Z"
  }
}
```

---

## Image Endpoints

### List Images
Get all generated images.

**Request**
```http
GET /api/images
Authorization: Bearer <token>
```

**Query Parameters**
- `projectId`: Filter by project (optional)
- `page`: Page number (optional)
- `limit`: Items per page (optional, default: 20)

**Response**
```json
{
  "success": true,
  "data": [
    {
      "id": "img123",
      "prompt": "A beautiful sunset...",
      "imageUrl": "https://s3.amazonaws.com/...",
      "thumbnailUrl": "https://s3.amazonaws.com/...",
      "width": 1024,
      "height": 768,
      "model": "dall-e-3",
      "status": "COMPLETED",
      "createdAt": "2026-01-13T12:00:00Z"
    }
  ]
}
```

---

### Generate Image
Create an AI-generated image.

**Request**
```http
POST /api/images/generate
Authorization: Bearer <token>
Content-Type: application/json

{
  "prompt": "A serene mountain landscape at sunset",
  "width": 1024,
  "height": 768,
  "projectId": "proj123" (optional)
}
```

**Response**
```json
{
  "success": true,
  "data": {
    "id": "img123",
    "prompt": "A serene mountain landscape at sunset",
    "imageUrl": "https://s3.amazonaws.com/...",
    "width": 1024,
    "height": 768,
    "model": "dall-e-3",
    "status": "PROCESSING",
    "createdAt": "2026-01-13T12:00:00Z"
  }
}
```

**Status Codes**
- `201`: Image generation started
- `400`: Invalid prompt or parameters
- `401`: Unauthorized
- `429`: Rate limit exceeded

---

### Get Image
Retrieve image details.

**Request**
```http
GET /api/images/:imageId
Authorization: Bearer <token>
```

**Response**
```json
{
  "success": true,
  "data": {
    "id": "img123",
    "prompt": "A serene mountain landscape at sunset",
    "imageUrl": "https://s3.amazonaws.com/...",
    "thumbnailUrl": "https://s3.amazonaws.com/...",
    "width": 1024,
    "height": 768,
    "model": "dall-e-3",
    "status": "COMPLETED",
    "createdAt": "2026-01-13T12:00:00Z"
  }
}
```

---

## Health Check

### Get Server Status
Check API health.

**Request**
```http
GET /health
```

**Response**
```json
{
  "status": "ok",
  "timestamp": "2026-01-13T12:00:00Z"
}
```

---

## Error Codes

| Code | Status | Description |
|------|--------|-------------|
| `VALIDATION_ERROR` | 400 | Input validation failed |
| `UNAUTHORIZED` | 401 | Missing or invalid authentication |
| `FORBIDDEN` | 403 | Access denied |
| `NOT_FOUND` | 404 | Resource not found |
| `CONFLICT` | 409 | Resource already exists |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Server error |

---

## Rate Limiting

- **Default**: 100 requests per 15 minutes per IP
- **Auth endpoints**: 5 requests per 15 minutes per IP
- **Response headers**: `X-RateLimit-Limit`, `X-RateLimit-Remaining`

---

**Last Updated**: 2026-01-13
