#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required but not found in PATH." >&2
  exit 1
fi

if [[ ! -f .env && -f .env.example ]]; then
  cp .env.example .env
fi

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

cleanup() {
  if [[ -n "${API_PID:-}" ]]; then
    kill "$API_PID" 2>/dev/null || true
  fi
  if [[ -n "${FASTAPI_PID:-}" ]]; then
    kill "$FASTAPI_PID" 2>/dev/null || true
  fi
  if [[ -n "${WEB_PID:-}" ]]; then
    kill "$WEB_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

PYTHON_BIN="${PYTHON_BIN:-}"
if [[ -z "$PYTHON_BIN" && -x "$ROOT_DIR/.venv/bin/python3" ]]; then
  PYTHON_BIN="$ROOT_DIR/.venv/bin/python3"
elif [[ -z "$PYTHON_BIN" && -x "$ROOT_DIR/.venv/bin/python" ]]; then
  PYTHON_BIN="$ROOT_DIR/.venv/bin/python"
elif [[ -z "$PYTHON_BIN" ]]; then
  PYTHON_BIN="python3"
fi

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "A Python interpreter is required to start the FastAPI auth backend." >&2
  exit 1
fi

if ! "$PYTHON_BIN" -c "import fastapi, uvicorn" >/dev/null 2>&1; then
  echo "FastAPI dependencies are missing. Install them with:" >&2
  echo "$PYTHON_BIN -m pip install -r backend/requirements.txt" >&2
  exit 1
fi

FASTAPI_PORT="${FASTAPI_PORT:-4021}"

echo "Starting Node API (http://localhost:${PORT:-4000}), FastAPI auth backend (http://127.0.0.1:${FASTAPI_PORT}), and web app (http://localhost:5173)..."
npm run dev:api &
API_PID=$!
"$PYTHON_BIN" -m uvicorn backend.app.main:app --reload --port "$FASTAPI_PORT" &
FASTAPI_PID=$!
npm run dev:web &
WEB_PID=$!

wait "$API_PID" "$FASTAPI_PID" "$WEB_PID"
