#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required but not found in PATH." >&2
  exit 1
fi

if [[ ! -d node_modules ]]; then
  if [[ -f package-lock.json ]]; then
    echo "Installing workspace dependencies with npm ci..."
    npm ci
  else
    echo "Installing workspace dependencies with npm install..."
    npm install
  fi
fi

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example."
fi

cleanup() {
  if [[ -n "${API_PID:-}" ]]; then
    kill "$API_PID" 2>/dev/null || true
  fi
  if [[ -n "${WEB_PID:-}" ]]; then
    kill "$WEB_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

echo "Starting API (default http://localhost:4000) and web app (default http://localhost:5173)..."
npm run dev:api &
API_PID=$!
npm run dev:web &
WEB_PID=$!

echo "Run script is now attached to both dev servers."
echo "Press Ctrl+C to stop them."

wait "$API_PID" "$WEB_PID"
