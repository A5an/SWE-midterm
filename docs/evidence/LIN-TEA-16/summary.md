# LIN-TEA-16 Evidence Summary

## What changed
- Added collaboration session bootstrap contracts and WebSocket event contracts.
- Implemented signed short-lived collaboration session tokens, authenticated WebSocket upgrade handling, presence broadcasting, and replay-safe reconnect logic in `apps/api/src/server.ts`.
- Expanded the frontend PoC into a two-window collaboration demo with join/disconnect/reconnect controls and an online user list.
- Added backend integration coverage for invalid-token rejection, presence join/leave, reconnect, and duplicate replay suppression.

## Why it changed
- This Linear issue targets the Assignment 2 collaboration baseline first: authenticated WebSocket, basic presence, and reconnect state reconciliation.
- The implementation uses a simple in-memory full-text sync model so the baseline works now without pulling bonus-tier CRDT work into the same PR.

## Acceptance criteria coverage
- WS rejects invalid token: covered by `docs/evidence/LIN-TEA-16/ws-test-log.txt`.
- Online users shown: covered by the presence assertions in `docs/evidence/LIN-TEA-16/ws-test-log.txt`.
- Reconnect resync works: covered by the reconnect replay assertions in `docs/evidence/LIN-TEA-16/ws-test-log.txt`.
