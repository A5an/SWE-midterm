# apps/collab

Placeholder service directory for the planned real-time collaboration container.

Planned responsibilities:
- WebSocket room/session handling
- Presence fan-out
- CRDT operation sync and reconnect replay

Current baseline note:
- The Assignment 2 collaboration baseline is implemented in-process inside `apps/api/src/server.ts`.
- This keeps the current repo runnable with the existing single backend process while the dedicated `apps/collab` container remains planned.
- The architecture/process deviation is tracked in `DEVIATIONS.md`.
