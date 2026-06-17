# CodeForge Swarm API

> HTTP endpoints used by the Railway orchestrator to coordinate agent swarms.  
> All endpoints (except `POST /stripe/webhook` and auth routes) require Bearer token authentication with `RAILWAY_ORCHESTRATOR_SECRET`.

## Authentication

All swarm endpoints require the following header:

```
Authorization: Bearer <RAILWAY_ORCHESTRATOR_SECRET>
```

Unauthorized requests receive `{ error: "Unauthorized" }` with HTTP 401.

---

## Swarm Task Routes

### GET /api/swarm/tasks/pending

List queued agent tasks ready for processing (up to 10).

- **Response:** `{ tasks: AgentTask[] }`

`AgentTask` fields: `_id`, `_creationTime`, `projectId`, `buildSessionId`?, `agentId`, `agentName`, `agentIcon`, `task`, `status` ("queued"|"running"|"done"|"error"), `result`?, `filesChanged`?, `startedAt`, `finishedAt`?

---

### POST /api/swarm/tasks/status

Update a task's status and optional metrics.

- **Request body:**
  ```json
  {
    "taskId": "string",
    "status": "queued" | "running" | "done" | "error",
    "errorMessage?": "string",
    "totalAgentsSpawned?": number,
    "totalFilesChanged?": number,
    "rootAgentId?": "string"
  }
  ```
- **Response:** `{ ok: true }`

When `status` is `"done"` or `"error"`, `finishedAt` is set to the current timestamp.  
When `errorMessage` is provided, it is stored in the task's `result` field.

---

## Agent Spawn & Status

### POST /api/swarm/agents/spawn

Create a sub-agent record for a task.

- **Request body:**
  ```json
  {
    "taskId": "string",
    "projectId": "string",
    "agentUid": "string",
    "parentAgentUid?": "string",
    "role": "planner" | "ui-agent" | "mobile-agent" | "logic-agent" | "debug-agent" | "feature-agent" | "test-agent" | "reviewer" | "qa-agent",
    "assignment": "string",
    "depth": number,
    "filesOwned?": ["string", "..."]
  }
  ```
- **Response:** `{ agentId: string }`

The agent's `agentId` in the database is formatted as `swarm:<taskId>:<role>:<agentUid>`.  
Agent name is capitalised from the role (e.g. `"ui-agent"` → `"Ui Agent"`).  
The agent is inserted with `status: "running"`.

---

### POST /api/swarm/agents/status

Update a sub-agent's status and result.

- **Request body:**
  ```json
  {
    "taskId": "string",
    "agentUid": "string",
    "status": "queued" | "running" | "done" | "error",
    "result?": "string",
    "errorMessage?": "string"
  }
  ```
- **Response:** `{ ok: true }`

Looks up the agent by `agentId` prefix `swarm:<taskId>:<agentUid>`.  
When `status` is `"done"` or `"error"`, `finishedAt` is set.

---

### GET /api/swarm/task/agents

List all agents belonging to a task.

- **Query parameters:**
  | Param    | Type   | Required | Description                |
  | -------- | ------ | -------- | -------------------------- |
  | `taskId` | string | Yes      | Swarm task ID              |
- **Response:** `{ agents: AgentTask[] }`

---

## Event Routes

### POST /api/swarm/events

Log a single agent event as a thought record (visible in the streaming thought feed).

- **Request body:**
  ```json
  {
    "taskId": "string",
    "projectId": "string",
    "agentUid": "string",
    "agentRole": "string",
    "type": "plan" | "analyze" | "code" | "debug" | "review" | "memory" | "search" | "commit" | "broadcast" | "done",
    "content": "string",
    "metadata?": "string"
  }
  ```
- **Response:** `{ ok: true }`

Events are inserted into `agentThoughts` with `isStreaming: false`.  
If `type` is not one of the valid values, it defaults to `"analyze"`.

---

### POST /api/swarm/events/batch

Log multiple agent events at once.

- **Request body:**
  ```json
  {
    "events": [
      {
        "taskId": "string",
        "projectId": "string",
        "agentUid": "string",
        "agentRole": "string",
        "type": "string",
        "content": "string",
        "metadata?": "string"
      }
    ]
  }
  ```
- **Response:** `{ ok: true }`

Each event is inserted individually into `agentThoughts`.

---

## File Routes

### GET /api/swarm/project/files

Get all files for a project.

- **Query parameters:**
  | Param       | Type   | Required | Description   |
  | ----------- | ------ | -------- | ------------- |
  | `projectId` | string | Yes      | Project ID    |
- **Response:** `{ files: File[] }`

`File` fields: `_id`, `_creationTime`, `projectId`, `path`, `name`, `content`, `language`?, `isDirectory`, `parentPath`?

---

### POST /api/swarm/files/write

Write or update a file in a project.

- **Request body:**
  ```json
  {
    "projectId": "string",
    "path": "string",
    "content": "string"
  }
  ```
- **Response:** `{ ok: true }`

If a file at the given `path` already exists, its `content` is patched.  
Otherwise a new file record is created with auto-detected language and name derived from the path.

---

## Sandbox Routes

### POST /api/swarm/sandbox

Log a sandbox command execution result.

- **Request body:**
  ```json
  {
    "taskId": "string",
    "projectId": "string",
    "agentUid": "string",
    "command": "string",
    "stdout?": "string",
    "stderr?": "string",
    "exitCode": number,
    "durationMs": number
  }
  ```
- **Response:** `{ ok: true }`

Recorded as an `agentThoughts` entry with `type: "debug"` and `agentName: "Sandbox"`.  
The content includes the command, duration, exit code, stdout, and stderr.

---

## Memory Routes

### GET /api/memory/top

Fetch the top memories for a project, sorted by importance × decay factor.

- **Query parameters:**
  | Param       | Type   | Required | Default | Description                                  |
  | ----------- | ------ | -------- | ------- | -------------------------------------------- |
  | `projectId` | string | Yes      | —       | Project ID                                   |
  | `limit`     | number | No       | `20`    | Max memories to return                       |
  | `category`  | string | No       | —       | Filter by category (see valid categories below) |
- **Response:** `{ memories: AgentMemory[] }`

Valid categories: `pattern`, `anti_pattern`, `preference`, `architecture`, `dependency`, `bugfix`, `convention`, `tool`, `insight`.

`AgentMemory` fields: `_id`, `_creationTime`, `projectId`, `category`, `content`, `importance` (0.0–1.0), `usageCount`, `lastUsedAt`, `sourceTaskId`?, `sourceRetroId`?, `decayFactor`, `embedding`?

---

### POST /api/memory/create

Store a new persistent memory for a project.

- **Request body:**
  ```json
  {
    "projectId": "string",
    "category": "pattern" | "anti_pattern" | "preference" | "architecture" | "dependency" | "bugfix" | "convention" | "tool" | "insight",
    "title": "string",
    "content": "string",
    "importance?": number,
    "sourceTaskId?": "string",
    "sourceAgentRole?": "string"
  }
  ```
- **Response:** `{ memoryId: string }`

Content is stored as `[<title>] <content>`.  
If `category` is not one of the valid values, it defaults to `"insight"`.  
Default `importance` is `0.7`.

---

### POST /api/memory/use

Increment the usage count and update the last-used timestamp for a memory.

- **Request body:**
  ```json
  {
    "memoryId": "string"
  }
  ```
- **Response:** `{ ok: true }`

Increments `usageCount` by 1 and sets `lastUsedAt` to now.

---

## Retrospective Routes

### POST /api/retrospective/create

Store a task retrospective after an agent run completes.

- **Request body:**
  ```json
  {
    "taskId": "string",
    "projectId": "string",
    "taskSummary": "string",
    "totalAgents": number,
    "totalFiles": number,
    "durationMs": number,
    "sandboxPassedFirst": boolean,
    "reviewPassedFirst": boolean,
    "retryCount": number,
    "whatWorked": ["string", "..."],
    "whatFailed": ["string", "..."],
    "improvements": ["string", "..."],
    "newMemories": ["string", "..."],
    "qualityScore": number
  }
  ```
- **Response:** `{ retroId: string }`

Stored in `taskRetrospectives`. `memoriesCreated` and `agentsInvolved` are initialised as empty arrays on insert.

---

## Agent Message Bus Routes

### POST /api/agents/message

Send a message between agents (or broadcast to all).

- **Request body:**
  ```json
  {
    "taskId": "string",
    "projectId": "string",
    "fromAgentUid": "string",
    "fromAgentRole": "string",
    "toAgentUid?": "string",
    "toAgentRole?": "string",
    "messageType": "warning" | "context" | "request" | "finding" | "blocker" | "resolved",
    "content": "string"
  }
  ```
- **Response:** `{ messageId: string }`

If `toAgentUid` is omitted or `undefined`, the message is a broadcast (visible to all agents querying their messages).  
If `messageType` is not one of the valid values, it defaults to `"context"`.  
Messages are inserted with `acknowledged: false`.

---

### GET /api/agents/messages

Get messages for a specific agent (including broadcasts).

- **Query parameters:**
  | Param       | Type   | Required | Description                  |
  | ----------- | ------ | -------- | ---------------------------- |
  | `taskId`    | string | Yes      | Swarm task ID                |
  | `agentUid`  | string | Yes      | Recipient agent UID          |
  | `agentRole` | string | Yes      | Recipient agent role         |
- **Response:** `{ messages: AgentMessage[] }`

Returns up to 50 messages where `toAgentId` matches the agent or is `undefined` (broadcasts), ordered most recent first.

`AgentMessage` fields: `_id`, `_creationTime`, `projectId`, `buildSessionId`?, `fromAgentId`, `fromAgentName`, `fromAgentIcon`, `toAgentId`?, `toAgentName`?, `messageType`, `content`, `relatedFiles`?, `timestamp`, `acknowledged`?

---

## RAG Routes

### POST /api/rag/index

Index multiple files for semantic code search.

- **Request body:**
  ```json
  {
    "projectId": "string",
    "files": [
      {
        "path": "string",
        "content": "string",
        "language?": "string"
      }
    ]
  }
  ```
- **Response:** `{ totalChunks: number, filesIndexed: number }`

Each file is chunked into 60-line blocks. Existing chunks for each file are deleted before re-indexing. Returns the total number of chunks created and the count of files processed.

---

### POST /api/rag/index-file

Index a single file for semantic code search.

- **Request body:**
  ```json
  {
    "projectId": "string",
    "path": "string",
    "content": "string",
    "language?": "string"
  }
  ```
- **Response:** `{ chunks: number }`

Same chunking logic as the batch endpoint — 60-line blocks with TF-IDF embeddings.

---

### GET /api/rag/search

Search indexed code chunks by semantic similarity.

- **Query parameters:**
  | Param       | Type   | Required | Default | Description          |
  | ----------- | ------ | -------- | ------- | -------------------- |
  | `projectId` | string | Yes      | —       | Project ID           |
  | `query`     | string | Yes      | —       | Search query         |
  | `limit`     | number | No       | `15`    | Max results          |
- **Response:** `{ chunks: RagChunk[] }`

Each chunk includes a `score` field (computed from TF-IDF cosine similarity). Results are sorted by score descending.

`RagChunk` fields: `_id`, `_creationTime`, `projectId`, `filePath`, `chunkType`, `name`?, `content`, `startLine`, `endLine`, `embedding`?, `language`?, `score` (added by search).

---

## Git Routes

### POST /api/git/branch

Record a git branch creation for a task.

- **Request body:**
  ```json
  {
    "taskId": "string",
    "projectId": "string",
    "branchName": "string",
    "baseBranch?": "string"
  }
  ```
- **Response:** `{ id: string }`

Stores a `gitCommits` entry with `sha: "branch:<branchName>"` and the branch creation message. Defaults `baseBranch` to `"main"` if not provided.

---

### POST /api/git/commit

Record a git commit for a task (placeholder).

- **Request body:**
  ```json
  {
    "taskId": "string",
    "commitSHA": "string"
  }
  ```
- **Response:** `{ ok: true }`

Currently a no-op placeholder.

---

### POST /api/git/pr

Record a pull request for a task (placeholder).

- **Request body:**
  ```json
  {
    "taskId": "string",
    "prNumber": number,
    "prUrl": "string"
  }
  ```
- **Response:** `{ ok: true }`

Currently a no-op placeholder.

---

## Error Ingestion Route

### POST /api/error-ingest

Ingest errors from external services (Sentry, Datadog, Bugsnag, CloudWatch, or custom webhooks). Optionally triggers auto-fix.

- **Query parameters:**
  | Param       | Type    | Required | Default     | Description                                    |
  | ----------- | ------- | -------- | ----------- | ---------------------------------------------- |
  | `projectId` | string  | Yes      | —           | Target project ID                              |
  | `source`    | string  | No       | `"webhook"` | Error source (e.g. `sentry`, `datadog`, etc.)   |
  | `repo`      | string  | No       | —           | Full repo name (e.g. `org/repo`)               |
  | `autoFix`   | boolean | No       | `true`      | Set to `"false"` to skip auto-fixing           |

- **Request body:** Raw JSON payload from the error tracker (entire body consumed as text).

- **Response:** `{ ok: true, incidentId?: string, autoFixTriggered: boolean }`

If `projectId` is missing, returns HTTP 400 with `{ error: "projectId query param required" }`.  
This endpoint does **not** require `RAILWAY_ORCHESTRATOR_SECRET` — it is designed for public webhook URLs.

---

## Non-Swarm Routes

The following routes are registered but are not part of the swarm API:

| Method | Path               | Auth Required          | Description                      |
| ------ | ------------------ | ---------------------- | -------------------------------- |
| POST   | `/stripe/webhook`  | Stripe signature       | Stripe webhook handler           |
| *      | Auth routes        | None                   | Registered by `@convex-dev/auth` |

---

## Error Responses

All swarm routes return:

- **401** `{ error: "Unauthorized" }` — missing or invalid Bearer token
- **500** `{ error: "<message>" }` — internal server error
