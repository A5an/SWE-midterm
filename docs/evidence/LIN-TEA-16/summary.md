# LIN-TEA-16 Evidence Summary

## What changed
- Added collaboration session bootstrap contracts and WebSocket event contracts.
- Implemented demo login access tokens, server-authorized session bootstrap with workspace checks, authenticated WebSocket upgrade handling, presence broadcasting, and replay-safe reconnect logic in `apps/api/src/server.ts`.
- Expanded the frontend PoC into a two-window collaboration demo with sign-in, join/disconnect/reconnect controls, and an online user list.
- Added backend integration coverage for invalid-token rejection, missing-auth rejection, workspace access denial, presence join/leave, reconnect, and duplicate replay suppression.

## Why it changed
- This Linear issue targets the Assignment 2 collaboration baseline first: authenticated session bootstrap, basic presence, and reconnect state reconciliation.
- The implementation uses a simple in-memory full-text sync model so the baseline works now without pulling bonus-tier CRDT work into the same PR.

## Acceptance criteria coverage
- WS rejects invalid token: covered by `docs/evidence/LIN-TEA-16/ws-test-log.txt`.
- Session bootstrap requires trusted API identity and rejects unauthorized access: covered by `docs/evidence/LIN-TEA-16/ws-test-log.txt`.
- Online users shown: covered by the presence assertions in `docs/evidence/LIN-TEA-16/ws-test-log.txt`.
- Reconnect resync works: covered by the reconnect replay assertions in `docs/evidence/LIN-TEA-16/ws-test-log.txt`.
