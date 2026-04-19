# SWE Midterm - Part 4 PoC

Minimal proof-of-concept for the **Collaborative Document Editor with AI Writing Assistant** assignment.

This PoC demonstrates:
- A working frontend (`apps/web`)
- A working backend API (`apps/api`)
- Authenticated document create/load with shared API contracts
- Document-level RBAC + sharing API (`owner` / `editor` / `viewer`)
- Document version history list/fetch/restore API with immutable snapshots
- Demo-authenticated collaboration session bootstrap with presence and reconnect resync
- AI rewrite + summarize suggestions with progressive streaming, cancel, compare/apply/reject/edit/undo, and per-document history
- Shared API data contracts via `packages/contracts`

This PoC intentionally does **not** implement yet:
- Full JWT login/refresh flow, sharing, dedicated version-history UI, export
- Separate collaboration and AI worker container deployment (`apps/collab` and `apps/ai-worker` remain placeholders while the baseline runs in `apps/api`)

## Prerequisites

- Node.js `>= 22` (Node `24.x` used in development)
- npm `>= 10`
- `make` (optional, only if you prefer Makefile commands)

## Setup

```bash
npm install
```

## Environment Setup

Create your local environment file from the template:

```bash
cp .env.example .env
```

For the current PoC, only these variables are actively used:
- `PORT` (API server port, default `4000`)
- `VITE_API_BASE_URL` (frontend API base URL, default `http://localhost:4000`)
- `JWT_ACCESS_SECRET` (signs demo API access tokens and short-lived collaboration session tokens; defaults to a local dev fallback if unset)

## Run the PoC (Single Command)

Using shell script:

```bash
./run.sh
```

Using Makefile:

```bash
make run
```

## Run the PoC (Manual)

Start backend (Terminal 1):

```bash
npm run dev:api
```

Start frontend (Terminal 2):

```bash
npm run dev:web
```

Open the app at the Vite URL (usually `http://localhost:5173`).

Default API base URL in UI: `http://localhost:4000`

Demo login credentials for the collaboration baseline:
- `usr_assanali` / `demo-assanali`
- `usr_alaa` / `demo-alaa`
- `usr_dachi` / `demo-dachi`
- `usr_editor` / `demo-editor`
- `usr_viewer` / `demo-viewer`

## What to Demo (3 minutes max)

1. Open the web app in two browser windows.
2. Sign in each window with a different demo user.
3. Create a document in one window and load the same `documentId` in the second.
4. Join the collaboration session in both windows.
5. Verify the online user list updates in both windows.
6. Edit text in one window and watch the other window resync.
7. Disconnect one window, keep typing locally, reconnect, and verify the latest draft syncs once.
8. Select text in the editor, run `Rewrite Selection` or `Summarize Selection`, and watch the suggestion stream progressively.
9. Cancel one AI request mid-stream, then run another request and compare, edit, accept, reject, and undo the applied suggestion.
10. Verify the AI history list shows completed/canceled jobs plus the final user decision.

## Contract Validation

Run type checks:

```bash
npm run typecheck
```

Run backend contract test:

```bash
npm test
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
