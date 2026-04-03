# Part 2: System Architecture

## Project
Collaborative Document Editor with AI Writing Assistant

This document builds on [Part1_Requirements_Engineering.md](../requirements/Part1_Requirements_Engineering.md). The architecture follows the C4 model at the System Context, Container, and Component levels, then covers feature breakdown, AI integration, API design, authorization, communication, code structure, data model, and architecture decision records.

Every diagram in this report includes an embedded Mermaid source block and a rendered image. Standalone Mermaid source files are also stored in `docs/architecture/diagrams/`.

## 2.1 C4 Architecture

### 2.1.1 Top Architectural Drivers

The architecture is ranked by both functional and quality drivers from Part 1:

| Rank | Driver | Why it is high priority | Architecture impact |
|---|---|---|---|
| 1 | Real-time co-edit latency and convergence (`FR-COL-01`, `NFR-LAT-01`) | The core product value is live collaboration; delayed or divergent edits break trust immediately. | Push-based sync service, CRDT merge engine, in-memory room state in Redis, and client-side immediate local apply. |
| 2 | Overlapping edit conflict handling (`FR-COL-03`) | Concurrent same-region edits are common in shared drafting and must never silently lose content. | Deterministic merge policy in collaboration components, conflict suggestion path, and replay-safe operation pipeline. |
| 3 | Resilience and offline recovery (`FR-COL-04`, `NFR-AVL-02`, `NFR-AVL-03`) | Users must keep writing during transient failures and reconnect safely. | Client offline queue, reconnect replay coordinator, duplicate-op suppression, and fast session bootstrap path. |
| 4 | Privacy and authorization boundaries (`FR-UM-02`, `FR-AI-05`, `NFR-SEC-01`, `NFR-SEC-03`) | Documents can be sensitive and AI calls cross trust boundaries to third-party providers. | Dedicated authz checks in API and collaboration paths, scoped AI context by default, TLS everywhere, and auditable request flow. |
| 5 | AI responsiveness and graceful degradation (`FR-AI-01`, `FR-AI-04`, `NFR-LAT-02`, `NFR-AVL-04`) | AI is valuable but cannot block writing; users need visible progress and safe failure behavior. | Async AI worker, queue-backed execution, SSE status stream, cancel support, and fail-fast provider outage handling. |
| 6 | Version safety and history integrity (`FR-DOC-02`, `FR-DOC-03`) | Teams need recoverability and accountability during active collaboration. | Append-only version store, revert-as-new-head model, and collaboration reload event on revert. |
| 7 | System scale growth (`NFR-SCL-01`, `NFR-SCL-02`) | Collaboration and AI usage can grow quickly across many documents and tenants. | Horizontally scalable stateless API/collab nodes, shared contracts package, and split services (`api`, `collab`, `ai-worker`). |

Because this ranking includes both UX-critical latency/reliability and governance/privacy drivers, the chosen architecture is intentionally split between low-latency collaboration paths and asynchronous, policy-guarded AI/data workflows.

### 2.1.2 Level 1 - System Context Diagram

The system context shows the collaborative editor as a single product boundary. The primary external actors are collaborators and workspace administrators. The only external systems that are essential at this level are the identity provider for authentication and the third-party LLM provider used to generate AI suggestions.

Mermaid source:

```mermaid
flowchart LR
    collaborator[Collaborator<br/>Editor / Commenter / Viewer]
    admin[Workspace Admin]
    idp[External Identity Provider<br/>OIDC / SAML]
    llm[Third-Party LLM Provider<br/>Inference API]

    subgraph system[Collaborative Document Editor with AI Writing Assistant]
        platform[System Under Design]
    end

    collaborator -->|Create, edit, comment, export, request AI help| platform
    admin -->|Manage members, sharing, AI policy, quotas, audit| platform
    platform -->|Authenticate users and validate sessions| idp
    platform -->|Send scoped prompts and receive completions| llm
```

![Level 1 System Context Diagram](rendered/c4-level1-system-context.svg)

This level answers the C4 question "what does the system interact with?" Editing and permission checks stay inside the product, while login and LLM calls stay outside. That is important because those outside services can be slow or unavailable, and the editor should still fail in a controlled way.

### 2.1.3 Level 2 - Container Diagram

The container view breaks the system into the main running parts. The browser client handles the editor UI, local state, offline storage, and AI suggestion display. The API app handles normal backend actions like documents, sharing, versions, and permissions. A separate collaboration service handles live syncing and presence. AI runs in a background worker so a slow AI request does not block typing.

Mermaid source:

```mermaid
flowchart LR
    user[Collaborator / Admin]
    idp[External Identity Provider<br/>OIDC / SAML]
    llm[Third-Party LLM Provider<br/>LLM API]

    subgraph system[Collaborative Document Editor with AI Writing Assistant]
        web[Web Editor SPA<br/>React + TypeScript + TipTap/Yjs + IndexedDB<br/>Rich-text editing, local state, offline queue, AI UX]
        api[API Application<br/>NestJS + TypeScript REST/SSE<br/>Document CRUD, sharing, versions, authz, AI/job APIs]
        collab[Collaboration Service<br/>Node.js + Hocuspocus/Yjs over WebSocket<br/>Live sync, presence, bootstrap, reconnect]
        ai[AI Orchestrator Worker<br/>Node.js + BullMQ<br/>Prompt assembly, quotas, model routing, suggestion artifacts]
        postgres[(PostgreSQL<br/>Users, documents, permissions, versions,<br/>AI metadata, audit events)]
        redis[(Redis<br/>Presence, room cache, pub/sub,<br/>AI job queue)]
        object[(Object Storage<br/>Version snapshots, exports,<br/>large AI suggestion payloads)]
    end

    user -->|HTTPS| web
    web -->|REST/JSON + SSE| api
    web <--> |WebSocket ops, presence, acks| collab

    api -->|OIDC redirect / token validation| idp
    api -->|SQL| postgres
    api -->|Cache, pub/sub, job enqueue| redis
    api -->|Read and write snapshots / exports| object

    collab -->|Load head state / checkpoint metadata| postgres
    collab -->|Presence fan-out / room coordination| redis
    collab -->|Read and write large checkpoints| object

    ai -->|Dequeue jobs / publish completion| redis
    ai -->|Read document context / persist status| postgres
    ai -->|Store suggestion payloads| object
    ai -->|HTTPS prompt / response| llm
```

![Level 2 Container Diagram](rendered/c4-level2-container.png)

The technology choices are fairly practical. The web client uses TypeScript, TipTap/ProseMirror, and Yjs for rich-text editing and shared editing state. The API and worker also use TypeScript so shared types and validation rules are easier to reuse. Redis handles short-term data like presence, room state, and AI job queues, while PostgreSQL is the main database for users, documents, permissions, versions, AI records, and audit logs.

### 2.1.4 Level 3 - Component Diagram (Collaboration Service)

The collaboration service is the most sensitive part of the architecture because it directly handles simultaneous editing, offline recovery, and predictable handling of overlapping edits. Its internal parts are separated so session handling, merge logic, replay logic, presence, and version checkpoint creation can be changed more easily later.

Mermaid source:

```mermaid
flowchart LR
    client[Web Editor Client]
    api[API Application / AuthZ]
    postgres[(PostgreSQL)]
    redis[(Redis)]
    object[(Object Storage)]

    subgraph collab[Collaboration Service Container]
        gateway[Session Gateway<br/>WebSocket handshake, join, leave, heartbeats]
        authz[Access Verifier<br/>Validate session ticket and effective role]
        bootstrap[Bootstrap Loader<br/>Fetch latest head snapshot and room state]
        intake[Operation Intake<br/>Normalize ops and reject malformed payloads]
        resync[Offline Resync Coordinator<br/>Deduplicate replayed ops and recover after reconnect]
        sync[CRDT Sync Engine<br/>Merge concurrent edits and converge state]
        presence[Presence Manager<br/>Track cursor, selection, online state]
        broadcast[Event Broadcaster<br/>Fan-out ops, presence, reload, AI markers]
        checkpoint[Checkpoint Publisher<br/>Trigger autosave and version snapshots]
    end

    client <--> |Join room, send ops, presence, receive acks| gateway
    gateway --> authz
    authz -->|Validate ACL and session| api
    gateway --> bootstrap
    bootstrap -->|Load head state and metadata| postgres
    bootstrap -->|Load large snapshot blobs| object
    gateway --> intake
    intake --> resync
    resync -->|Track last acked op and replay window| redis
    resync --> sync
    gateway --> presence
    presence --> broadcast
    sync -->|Ephemeral room state coordination| redis
    sync --> broadcast
    sync --> checkpoint
    checkpoint -->|Request durable checkpoint / version creation| api
    broadcast -->|Ops, presence, refresh events| client
```

![Level 3 Collaboration Service Component Diagram](rendered/c4-level3-collaboration-component.png)

Two design decisions are important here. First, the merge engine uses a CRDT (Conflict-free Replicated Data Type, a way to merge edits safely) so disconnected clients can keep working and still end up with the same final document. Second, version checkpoint creation is kept outside the merge engine, so saving versions does not slow down the live editing path. That separation matters for `FR-COL-01`, `FR-COL-04`, `FR-COL-03`, and the document versioning requirements.

## 2.2 Architectural Concerns

### 2.2.1 Feature Decomposition (Feature Breakdown)

The system is split into modules that can be built and tested fairly independently.

| Module | What it does | Depends on | Interface exposed to other modules |
|---|---|---|---|
| Rich-text editor and frontend state management | Shows the document, applies local edits right away, stores offline changes in IndexedDB, and shows presence, versions, and AI suggestions. | Shared document structure rules (schema), collaboration session API, AI job API, login/session state. | Editor commands (`applyLocalOp`, `acceptSuggestion`, `revertVersion`), UI state events, document view model. |
| Real-time synchronization layer | Keeps live document rooms running, merges edits from different users, tracks presence, replays missed changes after reconnect, and sends refresh events after a revert. | WebSocket transport, CRDT document model (shared merge model), Redis room state, document snapshots. | Session join/leave, operation stream, presence events, ack/replay rules, refresh notifications. |
| AI assistant service | Receives AI requests, builds prompts, checks role and quota rules, calls the provider, stores saved suggestion results, and sends status updates. | Document content access, prompt templates, LLM adapter, quota policy, audit logging. | `createAiRequest`, `cancelAiRequest`, `getAiStatus`, `applySuggestion`, `rejectSuggestion`. |
| Document storage and versioning | Creates documents, stores metadata, writes saved versions that are not changed later, lists history, restores old states by creating a new head version, and prepares exports. | PostgreSQL metadata, object storage, authorization, collaboration refresh events. | CRUD APIs, version listing, snapshot creation, revert command, export generation. |
| User authentication and authorization | Authenticates users, resolves workspace and document roles, enforces permission matrix for edit/share/AI/revert actions, records privileged operations. | Identity provider integration, membership data, document permissions, AI policy settings. | Session validation, role lookup, access checks, AI feature policy lookup, audit events. |
| API layer connecting frontend and backend | Exposes stable backend interfaces, prepares data for the client, creates collaboration session tokens, and exposes SSE (Server-Sent Events, one-way live updates) for long AI jobs. | Authorization service, document service, versioning service, AI worker flow, audit logging. | REST endpoints, SSE streams, session start data, standard error response format. |

This split matches the traceability matrix in Part 1. The editor and collaboration layer own fast live behavior. The AI assistant and document/versioning parts own slower background work and saved data. The API and auth layers are the main boundary used by the client and by other internal services.

### 2.2.2 AI Integration Design

#### Context and Scope

AI requests are selection-first by default. For rewrite, summarize, and translate, the client sends the selected text plus a small amount of nearby context, such as the document title, heading path, and nearby paragraphs. This keeps cost lower, makes responses faster, and sends less private data to the third-party LLM provider.

For restructure requests, the scope grows from just the selection to the section or document outline, because the local text alone is usually not enough. Very long documents are handled in steps:

- First, build an outline and a meaning-based summary from stored metadata and nearby headings.
- Second, split large text into fixed-size chunks so the prompt size stays predictable.
- Third, keep the base document version and selection hash with the AI request so the result can later be matched back to the current content.

This means the AI may see a little less of the full document, but the trade-off is worth it because cost and response time stay more predictable. That fits this product, since users review suggestions instead of letting the AI rewrite the whole document automatically.

#### Suggestion UX

AI output is shown like tracked changes instead of replacing the text immediately. The UI has three connected views:

- Inline highlights in the editor show exactly which ranges would change.
- A side panel shows the full before/after diff, status, and model metadata.
- Accept, reject, partial-accept, and edit actions let the user stay in control.

Partial acceptance works by applying only the selected parts of the saved suggestion result. Accepted changes become normal document edits, so undo works through the same local history used for human edits. A successful accept can also create a version checkpoint if the change is large enough based on a config setting.

#### AI During Collaboration

The system does not hard-lock text when AI is used. Instead, it stores the request with the base document version and selected range, then shows a small "AI drafting" marker to collaborators looking at the same area.

If other users edit the region while the AI job is running:

- Editing continues normally.
- When the AI result arrives, the client tries to match the suggestion to the current CRDT state (the shared merge state).
- If that match is safe, the user sees an updated proposal against the latest text.
- If the region diverged too much, the UI marks the result as stale and asks the requester to review or regenerate.

This avoids blocking collaboration and keeps the behavior easy to trust. Other collaborators never get a hidden AI overwrite. They only see a suggestion or, after explicit acceptance, a normal document change.

#### Prompt Design

Prompt logic is template-based and versioned. Each feature has:

- A base system instruction
- A feature template (`rewrite`, `summarize`, `translate`, `restructure`)
- Runtime variables such as tone, target language, heading path, and length target
- Output rules (contracts) that tell the model to return structured results, such as patch text and explanation fields

Templates live in shared config instead of being hardcoded in source files, so prompt changes can be rolled out without redeploying every service. The AI worker loads the active prompt versions at startup and can refresh them through a feature flag (config switch) or config update channel.

#### Model and Cost Strategy

Different models are used for different tasks:

- Low-cost, low-latency model for summarize and translate on bounded selections
- Higher-quality model for rewrite and restructure where instruction following matters more
- Optional enterprise option for privacy-sensitive customers that need a different provider

Cost control is checked at both user and workspace level. Each AI request checks:

- Role permission for the requested feature
- Remaining user quota
- Workspace budget ceiling
- Whether the provider is healthy and still within time limits

When a limit is exceeded, the request is rejected before any provider call is made. The user gets a quota-specific error, sees remaining allowance when useful, and can keep using the rest of the editor normally.

### 2.2.3 API Design

#### API Style Choices

The system uses a mix of API styles because the interactions are different:

| Interaction type | Style | Why this fits |
|---|---|---|
| Document CRUD, permissions, version history, exports | REST/JSON over HTTPS | Good for normal data actions, easy to understand, easy to version, and easy to log. |
| Live editing, presence, operation acks, reconnect replay | WebSocket connection (two-way live connection) | Needed because editing is live and both client and server need to send updates quickly. |
| AI job status and progress updates | Server-Sent Events (SSE, one-way live updates from server to client), with polling fallback | Good for long AI jobs where the server mainly needs to push status updates back to the client. |

#### Concrete API Contracts

##### Document CRUD and Versioning

| Method | Endpoint | Purpose | Success responses |
|---|---|---|---|
| `POST` | `/v1/documents` | Create a document with initial metadata and optional template content. | `201 Created` |
| `GET` | `/v1/documents/{documentId}` | Fetch document metadata plus the current content snapshot used by the editor. | `200 OK` |
| `PATCH` | `/v1/documents/{documentId}` | Update mutable metadata such as title or status. | `200 OK` |
| `DELETE` | `/v1/documents/{documentId}` | Soft-delete or archive a document. | `204 No Content` |
| `GET` | `/v1/documents/{documentId}/versions` | List saved versions that are not changed later. | `200 OK` |
| `GET` | `/v1/documents/{documentId}/versions/{versionId}` | Fetch version metadata and snapshot link. | `200 OK` |
| `POST` | `/v1/documents/{documentId}/versions/{versionId}:revert` | Create a new head version from a historical version. | `202 Accepted` |
| `POST` | `/v1/documents/{documentId}/exports` | Create an export job with format and AI-trail options. | `202 Accepted` |

Example request for document creation:

```json
{
  "workspaceId": "ws_123",
  "title": "Q3 Product Brief",
  "templateId": null,
  "initialContent": {
    "type": "doc",
    "content": []
  }
}
```

Example response:

```json
{
  "documentId": "doc_456",
  "workspaceId": "ws_123",
  "title": "Q3 Product Brief",
  "ownerRole": "owner",
  "currentVersionId": "ver_001",
  "createdAt": "2026-03-16T11:25:00Z"
}
```

Example response for document load:

```json
{
  "documentId": "doc_456",
  "workspaceId": "ws_123",
  "title": "Q3 Product Brief",
  "ownerRole": "owner",
  "currentVersionId": "ver_001",
  "createdAt": "2026-03-16T11:25:00Z",
  "content": {
    "type": "doc",
    "content": [
      {
        "type": "paragraph",
        "text": "Initial PoC content"
      }
    ]
  },
  "updatedAt": "2026-03-16T11:25:00Z"
}
```

##### Real-Time Session Management

| Method | Endpoint | Purpose | Success responses |
|---|---|---|---|
| `POST` | `/v1/documents/{documentId}/sessions` | Create a collaboration session token and starting data. | `201 Created` |
| `GET` | `/v1/documents/{documentId}/sessions/{sessionId}` | Read session state for reconnect diagnostics. | `200 OK` |
| `DELETE` | `/v1/documents/{documentId}/sessions/{sessionId}` | End the session explicitly. | `204 No Content` |

Example response when starting a live editing session:

```json
{
  "sessionId": "ses_789",
  "wsUrl": "wss://collab.example.com/rooms/doc_456",
  "sessionToken": "signed-short-lived-token",
  "headVersionId": "ver_031",
  "stateVector": "base64-encoded-yjs-state-vector",
  "presence": [
    {
      "userId": "usr_101",
      "displayName": "Nino"
    }
  ],
  "permissions": {
    "role": "editor",
    "canInvokeAi": true,
    "canRevert": false
  }
}
```

WebSocket message format for collaboration:

| Direction | Event | Example payload |
|---|---|---|
| Client -> Server | `client.ops` | `{ "sessionId": "...", "clientSeq": 42, "ops": [...], "baseStateVector": "..." }` |
| Client -> Server | `client.presence` | `{ "sessionId": "...", "cursor": {...}, "selection": {...} }` |
| Server -> Client | `server.ack` | `{ "ackClientSeq": 42, "serverRevision": 311, "stateVector": "..." }` |
| Server -> Client | `server.ops` | `{ "serverRevision": 312, "ops": [...], "authorUserId": "usr_101" }` |
| Server -> Client | `server.reload_required` | `{ "reason": "revert_created_new_head", "newVersionId": "ver_032" }` |
| Server -> Client | `server.presence` | `{ "participants": [...] }` |

##### AI Assistant Invocation

| Method | Endpoint | Purpose | Success responses |
|---|---|---|---|
| `POST` | `/v1/documents/{documentId}/ai-requests` | Create a new AI job from explicit user intent. | `202 Accepted` |
| `GET` | `/v1/ai-requests/{aiRequestId}` | Fetch current job state and result summary. | `200 OK` |
| `GET` | `/v1/ai-requests/{aiRequestId}/events` | SSE stream for AI job status changes. | `200 OK` |
| `POST` | `/v1/ai-requests/{aiRequestId}:cancel` | Cancel a queued or running AI job. | `202 Accepted` |
| `POST` | `/v1/ai-requests/{aiRequestId}/suggestions/{suggestionId}:apply` | Accept all or part of a suggestion. | `200 OK` |
| `POST` | `/v1/ai-requests/{aiRequestId}/suggestions/{suggestionId}:reject` | Reject a suggestion. | `200 OK` |

AI invocation request:

```json
{
  "feature": "summarize",
  "scope": {
    "type": "selection",
    "start": 1220,
    "end": 1674
  },
  "options": {
    "tone": "executive",
    "maxLength": "short",
    "targetLanguage": null
  },
  "baseVersionId": "ver_031"
}
```

Accepted response:

```json
{
  "aiRequestId": "ai_991",
  "status": "queued",
  "statusUrl": "/v1/ai-requests/ai_991",
  "eventsUrl": "/v1/ai-requests/ai_991/events",
  "cancelUrl": "/v1/ai-requests/ai_991:cancel"
}
```

##### User and Permission Management

| Method | Endpoint | Purpose | Success responses |
|---|---|---|---|
| `GET` | `/v1/me` | Fetch current identity, workspace memberships, and effective policies. | `200 OK` |
| `GET` | `/v1/workspaces/{workspaceId}/members` | List members and workspace roles. | `200 OK` |
| `PATCH` | `/v1/workspaces/{workspaceId}/ai-policies` | Update per-role AI feature policy and budget settings. | `200 OK` |
| `GET` | `/v1/documents/{documentId}/permissions` | Read the final document access list (ACL, access control list). | `200 OK` |
| `POST` | `/v1/documents/{documentId}/shares` | Share document with user, team, or link. | `201 Created` |
| `PATCH` | `/v1/documents/{documentId}/shares/{shareId}` | Change permission level or expiry. | `200 OK` |
| `DELETE` | `/v1/documents/{documentId}/shares/{shareId}` | Revoke share. | `204 No Content` |

Share request example:

```json
{
  "principalType": "user",
  "principalId": "usr_777",
  "permissionLevel": "viewer",
  "expiresAt": "2026-04-01T00:00:00Z"
}
```

#### Long-Running AI Operations

The client does not wait for the whole AI result inside one request. The flow is:

1. `POST /v1/documents/{documentId}/ai-requests` returns `202 Accepted`.
2. The client immediately subscribes to `/v1/ai-requests/{aiRequestId}/events`.
3. The worker emits `queued`, `in_progress`, `completed`, `failed`, or `canceled`.
4. On `completed`, the client fetches the saved suggestion result if it was not already included in the event data.

Example SSE status event:

```text
event: ai.status
data: {"aiRequestId":"ai_991","status":"in_progress","progress":"provider_called"}
```

Polling is still available as a backup option if SSE is blocked in a given environment.

#### Error Handling Strategy

All error responses use the same JSON shape:

```json
{
  "error": {
    "code": "AI_QUOTA_EXCEEDED",
    "message": "Monthly AI quota exceeded for this workspace.",
    "retryable": false,
    "requestId": "req_abc123",
    "details": {
      "quotaScope": "workspace",
      "resetsAt": "2026-04-01T00:00:00Z"
    }
  }
}
```

Clients distinguish the major AI states as follows:

| Situation | API behavior | Client interpretation |
|---|---|---|
| AI is slow but still healthy | `202 Accepted` plus SSE events with `queued` or `in_progress` | Show spinner and keep editor usable. |
| AI failed due to provider or internal error | Final status becomes `failed`; `GET /v1/ai-requests/{id}` returns failure reason | Show error banner and allow retry. |
| User exceeded quota or role policy | Immediate `403 Forbidden` or `429 Too Many Requests` with specific error code | Do not create a provider call; show policy/quota message. |

### 2.2.4 PoC Scope Mapping (Part 4 Alignment)

The implemented Part 4 PoC currently covers only a focused API subset to validate architecture contracts and front-end/back-end wiring:

Implemented in code:

- `POST /v1/documents` returns `201 Created` with fields:
  - `documentId`
  - `workspaceId`
  - `title`
  - `ownerRole`
  - `currentVersionId`
  - `createdAt`
- `GET /v1/documents/{documentId}` returns `200 OK` with the same metadata plus:
  - `content`
  - `updatedAt`
- Error envelope contract is implemented for invalid routes and unknown documents:
  - `error.code`
  - `error.message`
  - `error.retryable`
  - `error.requestId`

Intentionally deferred beyond Part 4 PoC:

- Real-time collaboration channels (`/sessions`, WebSocket operation flow)
- AI orchestration endpoints and SSE job-stream behavior
- Authentication, authorization, and persistent data storage integrations
- Export, sharing, and version-revert workflows

This deferred scope is deliberate for Part 4 because the rubric asks for a minimal technical skeleton proving contract-correct frontend-backend communication.

### 2.2.5 Authentication & Authorization

Authentication is required because the system stores private documents, supports sharing, keeps version history, and AI calls cost money. The main user types are workspace admins, document owners, editors, commenters, viewers, and support or audit roles in managed setups.

Role model:

| Role | Main capabilities | Important restrictions |
|---|---|---|
| Owner | Full document control: edit, share, revert versions, delete/archive, export, view AI history. | Cannot bypass workspace-wide compliance rules. |
| Editor | Edit content, accept AI suggestions, use AI features allowed by policy, export, create versions. | Cannot change document ownership or workspace policy. |
| Commenter | Comment, read, and optionally use limited AI features if workspace policy allows suggestion-only use. | Cannot directly change body content or accept AI output that writes to the document unless given more access. |
| Viewer | Read and export if permitted. | Cannot edit, share, revert, or invoke AI. |
| Workspace Admin | Manage memberships, default AI policy, quota budgets, audit visibility. | Is not automatically the owner of every document unless policy gives extra admin access. |

Privacy considerations for third-party LLM use:

- Minimize scope by defaulting to selection-level context.
- Redact configured sensitive patterns before provider calls when workspace policy requires it.
- Require provider agreements that disable model training on customer content by default.
- Encrypt all document and AI metadata in transit and at rest.
- Keep full prompts and responses only for a short support window, then keep only small metadata needed for auditing.

### 2.2.6 Communication Model

The communication model is real-time and push-based for editing, presence, and reconnect recovery. Polling alone would be simpler, but it cannot meet the collaboration latency targets or presence expectations. The trade-off is that the server must track more live connection state, and reconnect logic becomes more complex.

When a user first opens a shared document:

1. The client loads metadata through the API.
2. The client requests a collaboration session ticket.
3. The collaboration service loads the latest saved document state and the active presence list.
4. The editor becomes writable only after the starting sync state is loaded.

When a user loses connectivity:

1. The editor switches to offline mode and continues accepting local edits.
2. Operations are queued locally with client sequence numbers and extra IDs so the same change is not applied twice.
3. Presence is marked stale for other participants after a timeout.
4. On reconnect, the client resends its last acknowledged state vector (summary of its current sync state) and queued operations.
5. The server skips duplicate replayed operations, merges them into the current CRDT state, and sends back any missing remote operations.

This model preserves a strong user experience under intermittent network conditions while avoiding document locks or manual merge flows in normal use.

## 2.3 Code Structure & Repository Organization

### 2.3.1 Repository Strategy

A monorepo is the best fit for this project. The team is likely small to medium-sized, the frontend and backend share types and validation rules, and the live collaboration message format needs to stay consistent. A monorepo still allows separate deployment of `web`, `api`, `collab`, and `ai-worker`.

Using multiple repos would reduce CI scope for each service, but it would make shared message types harder to keep in sync and would likely create duplicate structure definitions. That extra overhead is not worth it for this project.

### 2.3.2 Current PoC Implementation vs Target Structure

To avoid architecture-code drift, this section explicitly separates what is implemented now (Part 4 PoC) from the full target structure planned for later milestones.

| Scope | Status | Paths | Why it exists |
|---|---|---|---|
| Part 4 PoC (implemented) | Implemented and runnable | `apps/web`, `apps/api`, `packages/contracts`, `docs/requirements`, `docs/architecture`, `docs/project-management` | Proves frontend-backend communication and shared API contracts required by the assignment PoC rubric. |
| Planned collaboration service | Placeholder scaffold only | `apps/collab` | Reserved for real-time sync and presence responsibilities documented in C4 and feature decomposition. |
| Planned AI worker | Placeholder scaffold only | `apps/ai-worker` | Reserved for async AI request execution and provider orchestration. |
| Planned shared packages | Placeholder scaffold only | `packages/editor-core`, `packages/ui`, `packages/config`, `packages/testkit` | Separates reusable domain logic, UI elements, config/templates, and test utilities to reduce coupling as scope grows. |
| Planned infra and test suites | Placeholder scaffold only | `infrastructure/*`, `tests/*` | Reserves clear locations for deployment assets and cross-service testing stages as implementation expands. |

All placeholder modules are intentionally non-functional in the PoC and are included to keep repository shape aligned with the architecture and team planning sections.

### 2.3.3 Repository Structure Diagram

Mermaid source:

```mermaid
flowchart TB
    root[SWE-midterm/]

    root --> apps[apps/]
    root --> packages[packages/]
    root --> infrastructure[infrastructure/]
    root --> docs[docs/]
    root --> tests[tests/]

    apps --> web[web/<br/>React SPA, editor UI, AI UX]
    apps --> api[api/<br/>REST and SSE application,<br/>authz, documents, sharing]
    apps --> collab[collab/<br/>WebSocket sync service,<br/>presence, reconnect logic]
    apps --> aiworker[ai-worker/<br/>Prompt execution, quotas,<br/>suggestion processing]

    packages --> contracts[contracts/<br/>API schemas, events,<br/>validation types]
    packages --> editorcore[editor-core/<br/>Shared document model,<br/>operation codecs, diff helpers]
    packages --> ui[ui/<br/>Reusable frontend components]
    packages --> config[config/<br/>Prompt templates, env schema,<br/>feature flags]
    packages --> testkit[testkit/<br/>Mocks, fixtures,<br/>provider stubs]

    infrastructure --> docker[docker/<br/>Local dev stack]
    infrastructure --> terraform[terraform/<br/>Cloud resources,<br/>secret references]
    infrastructure --> monitoring[monitoring/<br/>Dashboards, alerts,<br/>tracing]

    docs --> requirements[requirements/<br/>Part 1 requirements engineering]
    docs --> architecture[architecture/<br/>Part 2 architecture,<br/>diagrams, rendered assets]
    docs --> projectmgmt[project-management/<br/>Part 3 team/process planning]

    tests --> e2e[e2e/<br/>Browser and collaboration scenarios]
    tests --> integration[integration/<br/>API, DB, queue, AI worker flows]
    tests --> performance[performance/<br/>Latency and load tests]
```

![Repository Structure Diagram](rendered/repository-structure.svg)

### 2.3.4 Directory Layout

Target semester layout:

```text
SWE-midterm/
  apps/
    web/
    api/
    collab/
    ai-worker/
  packages/
    contracts/
    editor-core/
    ui/
    config/
    testkit/
  infrastructure/
    docker/
    terraform/
    monitoring/
  docs/
    requirements/
    architecture/
    project-management/
  tests/
    e2e/
    integration/
    performance/
```

Directory responsibilities:

- `apps/web`: editor shell, routes, collaboration client, AI suggestion UX, offline storage.
- `apps/api`: REST route definitions, controllers, auth middleware, document and sharing services.
- `apps/collab`: WebSocket room server, sync engine integration, replay logic, presence management.
- `apps/ai-worker`: prompt construction, model routing, provider adapters, job handlers.
- `packages/contracts`: shared DTOs (data transfer objects, shared request/response types), event schemas (data structure rules), validation types, permission enums.
- `packages/editor-core`: shared edit operation types, patch formats, diff utilities, document structure helpers.
- `packages/config`: prompt templates, feature flags, environment variable rules, non-secret defaults.
- `docs/requirements`: Part 1 requirements engineering deliverable.
- `docs/architecture`: Part 2 architecture deliverable plus Mermaid sources and rendered diagrams.
- `docs/project-management`: Part 3 team/process/risk/timeline deliverable.

API route definitions live under `apps/api/src/modules/*/routes` or a similar controller structure. Prompt templates live under `packages/config/prompts/`. Collaboration logic lives under `apps/collab/src/rooms`, `apps/collab/src/sync`, and `apps/collab/src/reconnect`.

### 2.3.5 Shared Code

Frontend and backend should share:

- Shared API request and response types
- Permission and role enums
- Document structure rules (schema) and patch model
- Event names and validators (input check rules) for real-time collaboration

The rule is to share types and pure logic, not actual service code. That prevents duplication without making the services depend on each other too much. For example, `packages/contracts` can be imported by all apps, but the collaboration service should not import API controllers or database repositories.

### 2.3.6 Configuration Management

Secrets such as database URLs, object storage credentials, and LLM provider keys do not belong in the repository. The repository stores:

- `.env.example` files with non-secret placeholders
- Environment variable validation
- Secret names or references expected from the deployment environment

Real secret values live in a secret manager or deployment platform environment store. CI should block commits that contain likely secrets, and local development should use separate sandbox credentials with minimum privileges.

### 2.3.7 Testing Structure

Tests live close to the code for unit tests and in top-level folders for cross-service tests:

- Unit tests beside source files for editor commands, prompt builders, permission checks, and diff helpers
- Integration tests in `tests/integration` for API + database, worker + provider stub, and collaboration + Redis flows
- End-to-end tests in `tests/e2e` for document creation, simultaneous editing, AI suggestion acceptance, share permissions, and version revert
- Performance tests in `tests/performance` for propagation latency, reconnect behavior, and high-collaborator load

AI integration should be tested mostly with provider stubs and recorded fixtures, not live provider calls. A small set of scheduled smoke tests can call the real provider to catch provider API changes without making every CI run expensive or flaky.

## 2.4 Data Model

### 2.4.1 Entity-Relationship Diagram

Mermaid source:

```mermaid
erDiagram
    USER {
        uuid id PK
        string email
        string display_name
        string status
        datetime created_at
    }

    WORKSPACE {
        uuid id PK
        string name
        uuid owner_user_id FK
        int ai_budget_monthly_tokens
        datetime created_at
    }

    MEMBERSHIP {
        uuid id PK
        uuid workspace_id FK
        uuid user_id FK
        string workspace_role
        datetime joined_at
    }

    TEAM {
        uuid id PK
        uuid workspace_id FK
        string name
        datetime created_at
    }

    TEAM_MEMBERSHIP {
        uuid id PK
        uuid team_id FK
        uuid user_id FK
        datetime joined_at
    }

    DOCUMENT {
        uuid id PK
        uuid workspace_id FK
        uuid owner_user_id FK
        string title
        string head_storage_key
        int current_version_no
        string status
        datetime created_at
        datetime updated_at
    }

    DOCUMENT_VERSION {
        uuid id PK
        uuid document_id FK
        int version_no
        uuid based_on_version_id FK
        uuid created_by_user_id FK
        string storage_key
        string change_summary
        boolean is_revert
        datetime created_at
    }

    DOCUMENT_PERMISSION {
        uuid id PK
        uuid document_id FK
        string principal_type
        uuid principal_id
        string permission_level
        datetime expires_at
        uuid granted_by_user_id FK
    }

    SHARE_LINK {
        uuid id PK
        uuid document_id FK
        string token_hash
        string permission_level
        datetime expires_at
        int max_uses
    }

    COLLAB_SESSION {
        uuid id PK
        uuid document_id FK
        uuid user_id FK
        string client_instance_id
        string last_ack_op_id
        string last_state_vector
        datetime connected_at
        datetime disconnected_at
    }

    AI_REQUEST {
        uuid id PK
        uuid document_id FK
        uuid requested_by_user_id FK
        uuid base_version_id FK
        string feature_type
        string scope_type
        int selection_start
        int selection_end
        string status
        string model_name
        int input_tokens
        int output_tokens
        datetime created_at
    }

    AI_SUGGESTION {
        uuid id PK
        uuid ai_request_id FK
        string patch_format
        string apply_status
        uuid applied_version_id FK
        datetime resolved_at
    }

    SUGGESTION_ACTION {
        uuid id PK
        uuid suggestion_id FK
        uuid acted_by_user_id FK
        string action_type
        string accepted_ranges_json
        datetime acted_at
    }

    AUDIT_EVENT {
        uuid id PK
        uuid workspace_id FK
        uuid actor_user_id FK
        uuid document_id FK
        string action_type
        string entity_type
        string entity_id
        string metadata_json
        datetime created_at
    }

    USER ||--o{ MEMBERSHIP : joins
    WORKSPACE ||--o{ MEMBERSHIP : contains
    WORKSPACE ||--o{ TEAM : contains
    USER ||--o{ TEAM_MEMBERSHIP : belongs_to
    TEAM ||--o{ TEAM_MEMBERSHIP : includes
    WORKSPACE ||--o{ DOCUMENT : owns
    USER ||--o{ DOCUMENT : creates
    DOCUMENT ||--o{ DOCUMENT_VERSION : has
    USER ||--o{ DOCUMENT_VERSION : creates
    DOCUMENT ||--o{ DOCUMENT_PERMISSION : shares_with
    USER ||--o{ DOCUMENT_PERMISSION : may_receive
    TEAM ||--o{ DOCUMENT_PERMISSION : may_receive
    DOCUMENT ||--o{ SHARE_LINK : publishes
    DOCUMENT ||--o{ COLLAB_SESSION : has
    USER ||--o{ COLLAB_SESSION : opens
    DOCUMENT ||--o{ AI_REQUEST : receives
    USER ||--o{ AI_REQUEST : invokes
    DOCUMENT_VERSION ||--o{ AI_REQUEST : anchors
    AI_REQUEST ||--o{ AI_SUGGESTION : produces
    AI_SUGGESTION ||--o{ SUGGESTION_ACTION : records
    USER ||--o{ SUGGESTION_ACTION : performs
    WORKSPACE ||--o{ AUDIT_EVENT : logs
    USER ||--o{ AUDIT_EVENT : triggers
    DOCUMENT ||--o{ AUDIT_EVENT : references
```

![Entity Relationship Diagram](rendered/data-model-er.svg)

### 2.4.2 Data Model Notes

Document representation:

- `DOCUMENT` stores the document ID, owner, metadata, and a reference to the latest saved snapshot of the current document head.
- The latest content is stored in a ready-to-load form for fast opening, while older saved versions live in `DOCUMENT_VERSION`.
- Content itself can be stored as a ProseMirror JSON snapshot or a CRDT-serialized blob (saved merge-friendly document state) referenced by `head_storage_key`.

Versioning:

- Each saved checkpoint or major apply action creates a `DOCUMENT_VERSION`.
- Version history is append-only (old rows are not overwritten).
- Revert never deletes history; it creates a new version whose `based_on_version_id` points at the chosen historical version and sets `is_revert = true`.

AI interaction history:

- `AI_REQUEST` records who invoked the feature, on what document, against which base version, with which scope and model.
- `AI_SUGGESTION` stores the returned patch result and final state.
- `SUGGESTION_ACTION` records accept, reject, or partial-accept decisions, including accepted ranges for audit history.

Permissions and sharing:

- `DOCUMENT_PERMISSION` models explicit shares to users or teams.
- `SHARE_LINK` models link-based access with separate expiry and usage controls.
- Workspace membership gives the base access level, while document-level permissions further narrow or expand actual access.

## 2.5 Architecture Decision Records (ADRs)

### ADR-01

**Title**  
Use CRDT-based collaboration (merge method for shared editing) with client-side offline buffering

**Status**  
Accepted

**Context**  
The system must support simultaneous editing, offline work, reconnect replay, and predictable handling of overlapping edits. A central locking model would hurt latency and availability.

**Decision**  
Use a CRDT-based collaboration model with local-first editing in the browser, short-lived room state in the collaboration service, and reconnect replay using client sequence numbers and state vectors (sync summaries).

**Consequences**  
Positive: very good offline behavior, users usually end up with the same final document without manual merging, and there is lower risk of data loss during short disconnects.  
Negative: messages can be larger than simple text diffs, debugging is harder, and snapshot cleanup needs more care.

**Alternatives considered**  
Operational Transform (another shared editing merge approach) with a central sequencing server was rejected because reconnect and offline behavior are harder to reason about and depend more on the server always keeping perfect order. Polling-based synchronization was rejected because it cannot meet the collaboration latency target.

### ADR-02

**Title**  
Treat AI output as async suggestions instead of direct document edits

**Status**  
Accepted

**Context**  
AI is a core feature, but the requirements say users must stay in control, be able to partially accept changes, cancel requests, review history, and keep collaborating without being blocked.

**Decision**  
AI requests are created asynchronously, stored as `AI_REQUEST` records, and turned into saved suggestions that users can accept, reject, or partially apply to the document.

**Consequences**  
Positive: easier for users to trust, supports review and audit, allows long AI jobs without blocking editing, and handles concurrent edits more safely.  
Negative: more state to manage, more UI complexity, and extra storage for saved suggestions.

**Alternatives considered**  
Synchronous inline replacement was rejected because it hides model latency inside the main editing flow and makes failures harder to handle. A chat-style assistant separate from the document model was rejected because it would not satisfy the tracked-diff and partial-accept requirements.

### ADR-03

**Title**  
Use saved versions that are not changed later, and make revert create a new head version

**Status**  
Accepted

**Context**  
The product must support version history, safe revert during active collaboration, and a clear audit trail. Reverting by overwriting the current state would destroy history and confuse collaborators.

**Decision**  
Store document versions as saved records that are not changed later. A revert creates a new head version from a selected older snapshot and sends a refresh event to active collaborators.

**Consequences**  
Positive: full audit trail, easier-to-understand history, safer concurrent collaboration, and support for AI history export.  
Negative: higher storage cost, need for snapshot retention rules, and a more visible refresh event when a revert happens during active editing.

**Alternatives considered**  
In-place rollback was rejected because it breaks history and audit expectations. Pure event sourcing (rebuilding state from a long event log) without periodic snapshots was rejected because document load and restore cost would grow too much for large, long-lived documents.

### ADR-04

**Title**  
Use REST for normal data actions, WebSocket for collaboration, and SSE for AI job status

**Status**  
Accepted

**Context**  
The system has three different kinds of interaction: normal CRUD data actions, low-latency two-way collaboration, and long AI progress updates from server to client. One protocol does not fit all three well.

**Decision**  
Use REST/JSON for documents, permissions, and versions; WebSocket sessions (two-way live connections) for live edits and presence; and SSE for AI status updates with polling as backup.

**Consequences**  
Positive: each interaction uses a protocol that fits it well, client behavior is easier to predict, and AI progress stays visible without overloading the collaboration channel.  
Negative: using multiple protocols makes implementation and monitoring more complex, and client code must support more than one transport.

**Alternatives considered**  
Polling-only APIs were rejected because they cannot deliver live collaboration. WebSocket-only APIs were rejected because normal CRUD and job queries become harder to cache, secure, and debug. GraphQL subscriptions everywhere were rejected because they add complexity without a clear benefit for this assignment's required flows.
