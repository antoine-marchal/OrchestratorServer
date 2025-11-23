# Orchestrator REST API Specification

## Overview

This REST API replaces the file-based IPC communications between the frontend and backend. It provides endpoints for executing node jobs asynchronously with status polling, session management, and support for multiple backend runners.

## Base URL
```
/api/v1
```

## Authentication
All requests require a session token in the `Authorization` header:
```
Authorization: Bearer <session-token>
```

## Error Handling

All endpoints return standard HTTP status codes. Error responses include:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": {}
  }
}
```

Common error codes:
- `INVALID_REQUEST`: Malformed request
- `UNAUTHORIZED`: Invalid or missing session token
- `NOT_FOUND`: Resource not found
- `JOB_NOT_FOUND`: Specified job ID does not exist
- `SESSION_EXPIRED`: Session has expired
- `RUNNER_UNAVAILABLE`: No available runners for job execution

## Job Execution

### Submit Job
Execute a node job asynchronously.

**Endpoint:** `POST /api/v1/jobs`

**Request Body:**
```json
{
  "type": "javascript|jsbackend|groovy|batch|powershell|flow",
  "code": "string",
  "codeFilePath": "string (optional)",
  "input": "any",
  "timeout": "number (optional, milliseconds)",
  "dontWaitForOutput": "boolean (optional)",
  "basePath": "string (optional)",
  "sessionId": "string (optional)",
  "runnerId": "string (optional)"
}
```

**Response (202 Accepted):**
```json
{
  "jobId": "string",
  "status": "queued",
  "estimatedStartTime": "ISO 8601 timestamp",
  "queuePosition": "number"
}
```

### Get Job Status
Poll for job execution status and results.

**Endpoint:** `GET /api/v1/jobs/{jobId}`

**Response (200 OK):**
```json
{
  "jobId": "string",
  "status": "queued|running|completed|failed|stopped",
  "progress": "number (0-100, optional)",
  "output": "any (present when status=completed)",
  "error": "string (present when status=failed)",
  "log": "string (optional)",
  "executionTime": "number (milliseconds, optional)",
  "startTime": "ISO 8601 timestamp",
  "endTime": "ISO 8601 timestamp (optional)"
}
```

### Stop Job
Stop a running job.

**Endpoint:** `POST /api/v1/jobs/{jobId}/stop`

**Response (200 OK):**
```json
{
  "jobId": "string",
  "status": "stopped",
  "message": "Job stopped successfully"
}
```

### List Jobs
Get jobs for current session.

**Endpoint:** `GET /api/v1/jobs`

**Query Parameters:**
- `status`: Filter by status (queued|running|completed|failed|stopped)
- `limit`: Maximum number of results (default: 50)
- `offset`: Pagination offset (default: 0)

**Response (200 OK):**
```json
{
  "jobs": [
    {
      "jobId": "string",
      "type": "string",
      "status": "string",
      "startTime": "ISO 8601 timestamp",
      "executionTime": "number (optional)"
    }
  ],
  "total": "number",
  "hasMore": "boolean"
}
```

## Session Management

### Create Session
Create a new user session.

**Endpoint:** `POST /api/v1/sessions`

**Request Body:**
```json
{
  "userId": "string (optional)",
  "metadata": {
    "clientVersion": "string",
    "platform": "string"
  }
}
```

**Response (201 Created):**
```json
{
  "sessionId": "string",
  "token": "string",
  "expiresAt": "ISO 8601 timestamp",
  "createdAt": "ISO 8601 timestamp"
}
```

### Get Session
Get session information.

**Endpoint:** `GET /api/v1/sessions/{sessionId}`

**Response (200 OK):**
```json
{
  "sessionId": "string",
  "activeJobs": "number",
  "totalJobs": "number",
  "createdAt": "ISO 8601 timestamp",
  "lastActivity": "ISO 8601 timestamp",
  "expiresAt": "ISO 8601 timestamp"
}
```

### Extend Session
Extend session expiration.

**Endpoint:** `POST /api/v1/sessions/{sessionId}/extend`

**Response (200 OK):**
```json
{
  "sessionId": "string",
  "expiresAt": "ISO 8601 timestamp"
}
```

### Delete Session
Terminate a session and stop all associated jobs.

**Endpoint:** `DELETE /api/v1/sessions/{sessionId}`

**Response (200 OK):**
```json
{
  "sessionId": "string",
  "message": "Session terminated",
  "stoppedJobs": "number"
}
```

## Multiple Runners Support

### List Runners
Get available backend runners.

**Endpoint:** `GET /api/v1/runners`

**Response (200 OK):**
```json
{
  "runners": [
    {
      "runnerId": "string",
      "status": "active|inactive|busy",
      "supportedTypes": ["javascript", "groovy", "batch", "powershell", "flow"],
      "currentJobs": "number",
      "maxConcurrentJobs": "number",
      "lastHeartbeat": "ISO 8601 timestamp"
    }
  ]
}
```

### Get Runner
Get specific runner information.

**Endpoint:** `GET /api/v1/runners/{runnerId}`

**Response (200 OK):**
```json
{
  "runnerId": "string",
  "status": "active|inactive|busy",
  "supportedTypes": ["string"],
  "currentJobs": "number",
  "maxConcurrentJobs": "number",
  "queueLength": "number",
  "lastHeartbeat": "ISO 8601 timestamp",
  "version": "string"
}
```

### Create Runner
Start a new backend runner instance.

**Endpoint:** `POST /api/v1/runners`

**Request Body:**
```json
{
  "supportedTypes": ["string"],
  "maxConcurrentJobs": "number (optional)",
  "configuration": {}
}
```

**Response (201 Created):**
```json
{
  "runnerId": "string",
  "status": "starting",
  "supportedTypes": ["string"],
  "maxConcurrentJobs": "number"
}
```

### Stop Runner
Stop a backend runner.

**Endpoint:** `DELETE /api/v1/runners/{runnerId}`

**Response (200 OK):**
```json
{
  "runnerId": "string",
  "status": "stopping",
  "message": "Runner shutdown initiated"
}
```

## File Operations

File operations are handled via browser APIs. The API accepts file paths and content as parameters in job requests.

### Upload File
Upload a file for use in job execution.

**Endpoint:** `POST /api/v1/files`

**Request:** Multipart form data with file

**Response (201 Created):**
```json
{
  "fileId": "string",
  "path": "string",
  "size": "number",
  "uploadedAt": "ISO 8601 timestamp"
}
```

### Download File
Download a file generated by job execution.

**Endpoint:** `GET /api/v1/files/{fileId}`

**Response:** File content with appropriate Content-Type header

## WebSocket Support (Optional)

For real-time job status updates:

**Endpoint:** `WS /api/v1/ws`

**Messages:**
```json
{
  "type": "job_status_update",
  "jobId": "string",
  "status": "string",
  "progress": "number"
}
```

## Rate Limiting

- Job submission: 100 requests per minute per session
- Status polling: 10 requests per second per job
- File uploads: 50 MB per hour per session

Rate limit headers are included in responses:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1638360000
```

## Versioning

API versioning follows semantic versioning. Breaking changes will increment the major version in the URL path.

## Data Types

- `string`: UTF-8 encoded text
- `number`: JSON number (integer or float)
- `boolean`: JSON boolean
- `any`: Any valid JSON value
- Timestamps: ISO 8601 format in UTC

## Security Considerations

- All communication must use HTTPS in production
- Session tokens expire after 24 hours of inactivity
- Input validation on all endpoints
- Rate limiting to prevent abuse
- Audit logging of all job executions