# SWE Midterm - Part 4 PoC

Minimal proof-of-concept for the **Collaborative Document Editor with AI Writing Assistant** assignment.

This PoC demonstrates:
- A working frontend (`apps/web`)
- A working backend API (`apps/api`)
- End-to-end frontend-backend communication for document create/load
- Shared API data contracts via `packages/contracts`

This PoC intentionally does **not** implement yet:
- Real-time collaboration (`apps/collab` is placeholder)
- AI orchestration (`apps/ai-worker` is placeholder)
- Auth, persistence, sharing, version revert, export

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

## What to Demo (3 minutes max)

1. Open web app.
2. Create document from the form (`POST /v1/documents`).
3. Observe returned `documentId`.
4. Load the same document (`GET /v1/documents/{documentId}`).
5. Show status + rendered response payload in UI.

## Contract Validation

Run type checks:

```bash
npm run typecheck
```

Run backend contract test:

```bash
npm test
```

The test validates that responses match shared contracts:
- `DocumentMetadataResponse`
- `DocumentDetailResponse`
- `ApiErrorEnvelope`

## Repository Shape (PoC-relevant)

```text
apps/
  api/        # Node HTTP API for PoC endpoints
  web/        # Vite frontend that calls the API
packages/
  contracts/  # Shared request/response types + validators
docs/
  requirements/
  architecture/
  project-management/
```

## Related Documentation

- Requirements: `docs/requirements/Part1_Requirements_Engineering.md`
- Architecture: `docs/architecture/Part2_System_Architecture.md`
- Project management: `docs/project-management/Part3_Project_Management_and_Team_Collaboration.md`
- Assignment 2 execution plan: `docs/project-management/A2_GRADE_MAX_PLAN.md`
- Assignment 1 to 2 deviations log: `DEVIATIONS.md`
