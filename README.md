# SWE Midterm - Part 4 PoC

Minimal proof-of-concept for the **Collaborative Document Editor with AI Writing Assistant** assignment.

This PoC demonstrates:
- A working frontend (`apps/web`)
- A working FastAPI backend (`backend/app`)
- End-to-end frontend-backend communication for document create/load
- Shared API data contracts via `packages/contracts`

This PoC intentionally does **not** implement yet:
- Real-time collaboration (`apps/collab` is placeholder)
- AI orchestration (`apps/ai-worker` is placeholder)
- Persistence, sharing, version revert, export

## Prerequisites

- Node.js `>= 22` (Node `24.x` used in development)
- npm `>= 10`
- Python `>= 3.12`
- `make` (optional, only if you prefer Makefile commands)

## Setup

```bash
npm install
python3 -m pip install -r backend/requirements.txt
```

## Environment Setup

Create your local environment file from the template:

```bash
cp .env.example .env
```

For the current backend baseline, these variables are used or recognized:
- `PORT` (FastAPI server port, default `4000`)
- `VITE_API_BASE_URL` (frontend API base URL, default `http://localhost:4000`)
- `JWT_ACCESS_SECRET` (optional; falls back to a local development secret if unset)
- `JWT_REFRESH_SECRET` (optional; falls back to a local development secret if unset)
- `JWT_ACCESS_TTL_SECONDS` (optional; defaults to `900`)
- `JWT_REFRESH_TTL_SECONDS` (optional; defaults to `604800`)
- `JWT_ISSUER` (optional; defaults to `swe-midterm-fastapi`)

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

Run backend integration tests:

```bash
npm test
```

The backend tests validate:
- `POST /v1/auth/register` hashes passwords and returns signed access + refresh tokens
- `POST /v1/auth/login` rejects invalid credentials and returns a fresh token pair on success
- `POST /v1/auth/refresh` rotates refresh sessions and rejects replayed refresh tokens
- `GET /v1/me` returns `401` without a bearer token and `200` with a valid access token
- `POST /documents` metadata response shape
- `GET /documents/{documentId}` detail response shape
- `/v1/documents` compatibility routes for the current frontend
- Standard error envelopes for validation, unknown documents, and unknown routes

## Repository Shape (PoC-relevant)

```text
apps/
  web/        # Vite frontend that calls the API
backend/
  app/        # FastAPI backend with create/load document endpoints
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
- Assignment 2 implementation plan: `docs/project-management/Assignment2_Implementation_Plan.md`
- Assignment 1 to 2 deviations log: `DEVIATIONS.md`

## Current Backend Scope

The FastAPI backend currently implements the baseline JWT auth lifecycle:
- `POST /v1/auth/register`
- `POST /v1/auth/login`
- `POST /v1/auth/refresh`
- `GET /v1/me` (protected bearer-token proof route)

It also keeps the migrated PoC document flow:
- `POST /documents`
- `GET /documents/{documentId}`
- Compatibility aliases for the existing frontend:
  - `POST /v1/documents`
  - `GET /v1/documents/{documentId}`

Storage is intentionally in-memory at this stage so the team can close the Assignment 2 FastAPI baseline before layering on persistent storage, protected CRUD, sharing, and version history.

Known limitation on this branch: the document endpoints remain open so the existing PoC frontend keeps working while protected CRUD and RBAC are implemented in follow-up Linear issues. The protected-route acceptance proof for this issue is `/v1/me`.
