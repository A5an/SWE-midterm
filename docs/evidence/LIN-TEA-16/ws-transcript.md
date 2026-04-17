# WebSocket Transcript

Representative happy-path message flow exercised by `apps/api/src/contract-test.ts`:

1. `POST /v1/auth/demo-login` returns a signed API access token for a demo user.
2. `POST /v1/documents/{documentId}/sessions` with `Authorization: Bearer <accessToken>` returns:
   - `sessionId`
   - `wsUrl`
   - `sessionToken`
   - `documentText`
   - `serverRevision`
   - `presence`
3. Client opens `ws://.../v1/collab?token=<sessionToken>`.
4. Server sends `server.bootstrap` with the current text, revision, and participants.
5. Server broadcasts `server.presence` whenever a user joins, disconnects, reconnects, or changes activity.
6. Client sends `client.update` with `clientSeq`, `mutationId`, `baseRevision`, and full text.
7. Server replies with `server.ack` to the sender and `server.update` to the other connected collaborators.
8. On reconnect, the client can resend the same `mutationId`; the server deduplicates it and returns `server.ack` without rebroadcasting a duplicate `server.update`.
