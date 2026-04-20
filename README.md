# SWE Midterm - Assignment 2 Baseline

Repository for the Assignment 2 implementation of the **Collaborative Document Editor with AI Writing Assistant**.

This repo currently contains:
- a runnable Node/Vite baseline used for the integrated document, collaboration, and AI demo
- a FastAPI auth/document proof in `backend/` for the required Python backend direction
- assignment documentation, deviations, and per-issue evidence bundles in `docs/`

## Current Baseline Scope

Implemented and demo-ready in the main runnable baseline:
- authenticated document create/load flow
- dashboard list and rich-text editor shell
- autosave status and version history restore flow
- document sharing with `owner` / `editor` / `viewer`
- authenticated collaboration session bootstrap, presence, and reconnect replay
- AI rewrite/summarize streaming with cancel, compare, apply/reject/edit/undo, and history
- a minimal React shell in `apps/web` that mounts the existing imperative UI without a full rewrite
- an env-configurable AI provider boundary that supports LM Studio via OpenAI-compatible streaming

Known implementation boundary:
- collaboration and AI still run inside `apps/api`
- `apps/collab` and `apps/ai-worker` remain placeholders while the baseline stays single-backend runnable
- the FastAPI backend currently covers canonical auth plus protected create/load proof, not full collaboration and AI parity

Deviations from the Assignment 1 architecture are tracked in [DEVIATIONS.md](DEVIATIONS.md).

## Prerequisites

- Node.js `>= 22`
- npm `>= 10`
- Python `>= 3.9` (`3.11+` preferred for the FastAPI proof)
- `make` is optional

## Quick Start

From a clean clone:

```bash
./run.sh
```

What `./run.sh` does:
- installs workspace dependencies with `npm ci` when `node_modules/` is missing
- creates `.env` from `.env.example` when `.env` is missing
- sources `.env` so local overrides are applied consistently
- starts the Node API at `http://localhost:4000`
- starts the FastAPI auth backend at `http://127.0.0.1:4021`
- starts the web app on Vite's default port (`http://localhost:5173`) or the next free port if `5173` is already in use

Alternative entrypoint:

```bash
make run
```

Stop all dev servers with `Ctrl+C`.

## Environment Setup

The repo root includes a documented template:

```bash
cp .env.example .env
```

Important variables:
- `PORT`: Node API port used by `apps/api`
- `VITE_API_BASE_URL`: web app base URL for the Node API
- `VITE_AUTH_API_BASE_URL`: web app base URL for the FastAPI auth workspace
- `JWT_ACCESS_SECRET`: shared signing secret for FastAPI access tokens; `apps/api` uses it to validate FastAPI-issued Bearer tokens and to mint only short-lived local fallback/session tokens
- `JWT_REFRESH_SECRET`, `JWT_ACCESS_TTL_SECONDS`, `JWT_REFRESH_TTL_SECONDS`, `JWT_ISSUER`: used by the FastAPI auth flow; `JWT_ACCESS_TTL_SECONDS` is the short-lived access-token TTL also reflected by the Node demo-login bridge
- `FASTAPI_AUTH_BASE_URL`: Node auth-bridge target for canonical FastAPI user resolution
- `AI_PROVIDER`: `demo` by default, `openai-compatible` for LM Studio
- `AI_PROVIDER_API_KEY`, `AI_PROVIDER_BASE_URL`, `AI_MODEL`: OpenAI-compatible AI provider settings

The committed defaults are for local development only. Replace the JWT secrets outside local demo use.

LM Studio example:

```bash
AI_PROVIDER=openai-compatible
AI_PROVIDER_BASE_URL=http://127.0.0.1:1234/v1
AI_PROVIDER_API_KEY=lm-studio
AI_MODEL=nvidia.nemotron-mini-4b-instruct
```

The frontend contract does not change when you switch providers. The existing `/v1/documents/{id}/ai/jobs` API, SSE stream, cancel flow, compare/apply/reject/edit/undo controls, and history panel remain the same.

## Manual Run

Install dependencies:

```bash
npm install
```

Recommended Python setup for the FastAPI proof:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements.txt
```

Start the integrated baseline:

```bash
npm run dev:api
python3 -m uvicorn backend.app.main:app --reload --port 4021
npm run dev:web
```

Open the app at the Vite URL printed in the terminal (`http://localhost:5173` by default).

Recommended sign-in flow:
- use `#auth/register` or `#auth/login` against the FastAPI backend for the canonical Assignment 2 auth path
- use the seeded-user quick sign-in panel only when you need a fast local reset with known users; it bridges into the same short-lived FastAPI-style access-token model instead of issuing a separate long-lived demo token

Seeded users for fast local verification:
- `usr_assanali` / `demo-assanali`
- `usr_alaa` / `demo-alaa`
- `usr_dachi` / `demo-dachi`
- `usr_editor` / `demo-editor`
- `usr_viewer` / `demo-viewer`

## FastAPI Proof

The Assignment 2 FastAPI proof lives in `backend/`.

Run the FastAPI app:

```bash
python3 -m uvicorn backend.app.main:app --reload --port 4021
```

Available FastAPI docs once running:
- Swagger UI: `http://127.0.0.1:4021/docs`
- ReDoc: `http://127.0.0.1:4021/redoc`

Frontend auth proof routes in `apps/web`:
- `#auth/login`
- `#auth/register`
- `#auth/workspace`

The FastAPI proof now requires `Authorization: Bearer <access token>` on `POST /v1/documents` and `GET /v1/documents/{documentId}` and returns the standard 401 error envelope when auth is missing or invalid.

The integrated app also reuses the FastAPI session for Node-backed documents, collaboration, and AI because `apps/api` accepts the same access token. The seeded `POST /v1/auth/demo-login` bridge returns the real short-lived JWT lifetime from that access token rather than presenting a separate 8-hour access window. Collaboration session tokens and AI stream tokens remain separate short-lived service tokens inside `apps/api`.

To exercise the FastAPI auth flow from the web app:
1. Start the FastAPI app on port `4021`.
2. Open the web app.
3. Set `Auth API Base URL` to `http://127.0.0.1:4021`.
4. Register or log in.
5. Refresh `#auth/workspace` to verify persisted session restore.

## Validation Commands

Type checks:

```bash
npm run typecheck
```

Backend contract/integration test suite:

```bash
npm test
```

Focused frontend and AI provider tests:

```bash
npm --workspace @swe-midterm/web run test
npm --workspace @swe-midterm/api run test:provider
```

Production build checks:

```bash
npm run build
```

FastAPI tests:

```bash
python3 -m pytest backend/tests
```

## Demo Sequence

Use this order for the required Assignment 2 demo:
1. Registration/login with protected route proof in the FastAPI auth workspace.
2. Document creation and rich-text editing in the integrated baseline.
3. Sharing and role enforcement (`owner`, `editor`, `viewer`).
4. Two-window collaboration with presence and reconnect.
5. AI streaming with rewrite/summarize, cancel, and suggestion controls.
6. Version history restore.

## Repository Layout

```text
apps/
  api/        Node baseline API for documents, sharing, collaboration, and AI
  web/        Vite + React frontend
  collab/     Placeholder for planned collaboration service split
  ai-worker/  Placeholder for planned AI worker split
backend/
  app/        FastAPI auth + protected document proof
  tests/      FastAPI pytest suite
packages/
  contracts/  Shared request/response/event contracts
docs/
  requirements/
  architecture/
  project-management/
  evidence/
```

## Evidence and Documentation

- Requirements: `docs/requirements/Part1_Requirements_Engineering.md`
- Architecture: `docs/architecture/Part2_System_Architecture.md`
- Project management: `docs/project-management/Part3_Project_Management_and_Team_Collaboration.md`
- Assignment 2 implementation plan: `docs/project-management/Assignment2_Implementation_Plan.md`
- Deviation log: `DEVIATIONS.md`
- Evidence bundles: `docs/evidence/<issue-key>/`

Each evidence bundle should include test logs, transcripts/screenshots/video notes as applicable, the implementation commit hash, PR link note, and a short summary of what changed and why.
