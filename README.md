# SWE Midterm - Part 4 PoC

Minimal proof-of-concept for the **Collaborative Document Editor with AI Writing Assistant** assignment.

This PoC demonstrates:
- A working frontend (`apps/web`)
- A working backend API (`apps/api`)
- A FastAPI auth backend (`backend/`) for canonical registration, login, refresh, and protected profile validation
- A minimal React shell (`src/main.tsx` + `src/App.ts`) that mounts the existing imperative document UI without rewriting the current editor flows
- Authenticated document create/load with shared API contracts
- Dashboard document list with clickable open/load actions
- Rich-text editor baseline with headings, bold, italic, lists, code blocks, and autosave status
- Document-level RBAC + sharing API (`owner` / `editor` / `viewer`)
- Document version history list/fetch/restore API with immutable snapshots
- Role-aware sharing controls and version restore UI in `apps/web`
- Authenticated collaboration session bootstrap with presence and reconnect resync
- AI rewrite + summarize suggestions with progressive streaming, cancel, compare/apply/reject/edit/undo, and per-document history
- An env-configurable AI provider boundary that defaults to the demo generator and can call LM Studio through its OpenAI-compatible API using `nvidia.nemotron-mini-4b-instruct`
- Shared API data contracts via `packages/contracts`

This PoC intentionally does **not** implement yet:
- Full single-backend cutover from the current Node PoC to FastAPI for collaboration + AI, and export
- Separate collaboration and AI worker container deployment (`apps/collab` and `apps/ai-worker` remain placeholders while the baseline runs in `apps/api`)

## Prerequisites

- Node.js `>= 22` (Node `24.x` used in development)
- npm `>= 10`
- Python `>= 3.9` (`3.11+` preferred)
- `make` (optional, only if you prefer Makefile commands)

## Setup

```bash
npm install
```

Recommended for the FastAPI backend:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements.txt
```

## Environment Setup

Create your local environment file from the template:

```bash
cp .env.example .env
```

For the current PoC, only these variables are actively used:
- `PORT` (API server port, default `4000`)
- `VITE_API_BASE_URL` (frontend API base URL, default `http://localhost:4000`)
- `VITE_AUTH_API_BASE_URL` (frontend FastAPI auth workspace base URL, default `http://127.0.0.1:4021`)
- `JWT_ACCESS_SECRET` (signs demo API access tokens and short-lived collaboration session tokens; defaults to a local dev fallback if unset)
- `FASTAPI_AUTH_BASE_URL` (Node auth bridge target for canonical FastAPI auth/user lookup, default `http://127.0.0.1:4021`)
- `AI_PROVIDER` (`demo` by default, `openai-compatible` for LM Studio)
- `AI_PROVIDER_BASE_URL` (OpenAI-compatible provider base URL, default `http://127.0.0.1:1234/v1`)
- `AI_PROVIDER_API_KEY` (provider API key header value, default `lm-studio`)
- `AI_MODEL` (OpenAI-compatible model name, default `nvidia.nemotron-mini-4b-instruct`)

To run the existing rewrite/summarize flow against LM Studio instead of the local demo provider, set:

```bash
AI_PROVIDER=openai-compatible
AI_PROVIDER_BASE_URL=http://127.0.0.1:1234/v1
AI_PROVIDER_API_KEY=lm-studio
AI_MODEL=nvidia.nemotron-mini-4b-instruct
```

The frontend contract does not change when you switch providers. The existing `/v1/documents/{id}/ai/jobs` API, SSE stream, cancel flow, compare/apply/reject/edit/undo controls, and history panel remain the same.

Current auth integration model:
- FastAPI is the canonical auth/user directory service.
- `apps/api` still owns documents, sharing, collaboration, and AI streaming.
- The Node API now accepts FastAPI-issued access tokens and uses FastAPI for user resolution when needed.
- The seeded-user quick sign-in remains available for local verification, but it bridges through the shared FastAPI identity model when that backend is running.

## Run the PoC (Single Command)

Using shell script:

```bash
./run.sh
```

`run.sh` now starts all three local services:
- Node API on `http://localhost:4000`
- FastAPI auth backend on `http://127.0.0.1:4021`
- Vite web app on `http://localhost:5173`

Using Makefile:

```bash
make run
```

## Run the PoC (Manual)

Start backend (Terminal 1):

```bash
npm run dev:api
```

Start FastAPI auth backend (Terminal 2):

```bash
python3 -m uvicorn backend.app.main:app --reload --port 4021
```

Start frontend (Terminal 3):

```bash
npm run dev:web
```

Open the app at the Vite URL (usually `http://localhost:5173`).

Default API base URL in UI: `http://localhost:4000`

Recommended sign-in flow:
- Use `#auth/register` or `#auth/login` against the FastAPI backend for the canonical Assignment 2 auth path.
- Use the seeded-user quick sign-in panel only when you need a fast local reset with known users.

Frontend shell note:
- `apps/web/src/main.tsx` mounts a React `App` component.
- `apps/web/src/App.ts` keeps the current imperative UI and Quill logic, but React now owns mount/unmount and teardown of the hash listener, timers, WebSocket, and AI SSE stream.

Seeded user credentials for fast local verification:
- `usr_assanali` / `demo-assanali`
- `usr_alaa` / `demo-alaa`
- `usr_dachi` / `demo-dachi`
- `usr_editor` / `demo-editor`
- `usr_viewer` / `demo-viewer`

## FastAPI Auth Baseline UI

`apps/web` now also includes a hash-routed auth workspace for the Assignment 2 frontend auth proof:
- `#auth/login`
- `#auth/register`
- `#auth/workspace` (protected route)

This flow targets the FastAPI backend in `backend/`, not the Node PoC API in `apps/api`.

The main app also reuses the FastAPI session for Node-backed documents, collaboration, and AI because `apps/api` accepts the same access token.

Example local startup for the auth proof:

```bash
python3 -m uvicorn backend.app.main:app --reload --port 4021
```

Then in the web UI:
- set `Auth API Base URL` to `http://127.0.0.1:4021`
- register or log in
- refresh the page on `#auth/workspace` to verify persisted session restore
- optionally shorten `JWT_ACCESS_TTL_SECONDS` to demonstrate expired-token refresh and graceful fallback to sign-in

## What to Demo (3 minutes max)

1. Open the web app in two browser windows.
2. Sign in each window with a different user.
3. Recommended: use FastAPI login/register for the canonical auth path. For a fast local smoke test, use the seeded users listed above.
4. Create a document in one window and load the same `documentId` in the second.
5. Join the collaboration session in both windows.
6. Verify the online user list updates in both windows.
7. Edit text in one window and watch the other window resync.
8. As the owner, assign `viewer` access to a stakeholder and verify their join attempt is blocked by the role-aware UI + backend.
9. Refresh version history, restore an older version as a new head, and verify the document reloads on the restored version.
10. Disconnect one window, keep typing locally, reconnect, and verify the latest draft syncs once.
11. Select text in the editor, run `Rewrite Selection` or `Summarize Selection`, and watch the suggestion stream progressively.
12. Cancel one AI request mid-stream, then run another request and compare, edit, accept, reject, and undo the applied suggestion.
13. Verify the AI history list shows completed/canceled jobs plus the final user decision.

## Contract Validation

Run type checks:

```bash
npm run typecheck
```

Run backend contract test:

```bash
npm test
```

Run focused frontend and AI provider tests:

```bash
npm --workspace @swe-midterm/web run test
npm --workspace @swe-midterm/api run test:provider
```

The test validates that responses and events match shared contracts:
- `DocumentMetadataResponse`
- `DocumentDetailResponse`
- `DocumentPermissionsResponse`
- `DocumentShareResponse`
- `DemoLoginResponse`
- `ApiErrorEnvelope`
- `CollaborationSessionResponse`
- `CreateAiJobResponse`
- `AiHistoryResponse`
- Demo login auth, document RBAC/share enforcement, session bootstrap authorization, WebSocket auth, presence, and reconnect replay behavior
- AI job creation, progressive stream events, cancel path, and per-document history persistence
- The React shell mount/unmount boundary in `apps/web`
- The OpenAI-compatible provider adapter used for LM Studio

## Repository Shape (PoC-relevant)

```text
apps/
  api/        # Node HTTP API for PoC endpoints
  web/        # Vite frontend that calls the API + collaboration WebSocket
packages/
  contracts/  # Shared request/response/event types + validators
docs/
  requirements/
  architecture/
  project-management/
```

## Related Documentation

- Requirements: `docs/requirements/Part1_Requirements_Engineering.md`
- Architecture: `docs/architecture/Part2_System_Architecture.md`
- Project management: `docs/project-management/Part3_Project_Management_and_Team_Collaboration.md`
- Assignment 2 implementation plan: `docs/project-management/Assignment2_Implementation_Plan.md`
- Assignment 1 to 2 deviations log: `DEVIATIONS.md`
