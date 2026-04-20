# SWE Midterm - Assignment 2 Baseline

Repository for the Assignment 2 implementation of the **Collaborative Document Editor with AI Writing Assistant**.

This repo currently contains:
- a runnable Node/Vite baseline used for the integrated collaboration + AI demo
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

Known implementation boundary:
- collaboration and AI still run inside `apps/api`
- `apps/collab` and `apps/ai-worker` remain placeholders while the baseline stays single-backend runnable
- the FastAPI backend currently covers auth plus protected create/load proof, not full collaboration and AI parity

Deviations from the Assignment 1 architecture are tracked in [DEVIATIONS.md](DEVIATIONS.md).

## Prerequisites

- Node.js `>= 22`
- npm `>= 10`
- Python `>= 3.11` if you want to run the FastAPI proof in `backend/`
- `make` is optional

## Quick Start

From a clean clone:

```bash
./run.sh
```

What `./run.sh` does:
- installs workspace dependencies with `npm ci` when `node_modules/` is missing
- creates `.env` from `.env.example` when `.env` is missing
- starts the API at `http://localhost:4000`
- starts the web app on Vite's default port (`http://localhost:5173`) or the next free port if `5173` is already in use

Alternative entrypoint:

```bash
make run
```

Stop both dev servers with `Ctrl+C`.

## Environment Setup

The repo root includes a documented template:

```bash
cp .env.example .env
```

Important variables:
- `PORT`: Node API port used by `apps/api`
- `VITE_API_BASE_URL`: web app base URL for the Node API
- `JWT_ACCESS_SECRET`: used by the Node API demo auth/session flow and by the FastAPI auth proof
- `JWT_REFRESH_SECRET`, `JWT_ACCESS_TTL_SECONDS`, `JWT_REFRESH_TTL_SECONDS`, `JWT_ISSUER`: used by the FastAPI auth flow
- `AI_PROVIDER_API_KEY`, `AI_PROVIDER_BASE_URL`: optional overrides for AI integration experiments

The committed defaults are for local development only. Replace the JWT secrets outside local demo use.

## Manual Run

Install dependencies:

```bash
npm install
```

Start the integrated baseline:

```bash
npm run dev:api
npm run dev:web
```

Open the app at the Vite URL printed in the terminal (`http://localhost:5173` by default).

Demo users for the integrated baseline:
- `usr_assanali` / `demo-assanali`
- `usr_alaa` / `demo-alaa`
- `usr_dachi` / `demo-dachi`
- `usr_editor` / `demo-editor`
- `usr_viewer` / `demo-viewer`

## FastAPI Proof

The Assignment 2 FastAPI proof lives in `backend/`.

Install Python dependencies:

```bash
python3 -m pip install -r backend/requirements.txt
```

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
