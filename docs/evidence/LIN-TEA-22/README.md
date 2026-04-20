# LIN-TEA-22 Evidence

- Linear issue: `LIN-TEA-22`
- Branch used in this workspace: `feat/LIN-TEA-22-ai-provider-prompts`
- Implementation commit: see `commit-hash.txt`
- PR: pending branch push and PR creation. Placeholder recorded in `pr-link.txt`.

## What Changed

- Extracted AI prompt-building helpers from `apps/api/src/server.ts` into `apps/api/src/ai/prompts.ts`.
- Added `apps/api/src/ai/provider.ts` with a small `AiSuggestionProvider` interface and the current demo generator as the default implementation.
- Rewired the Node API server to use the provider module for AI suggestion generation while keeping the same streaming lifecycle, model name, request parsing, and response contracts.
- Kept the refactor scoped to the API backend only. No frontend behavior or shared contracts changed for this issue.

## Why

- Part 1 maps AI prompt assembly and provider routing to `AC-08` and `AC-09`, so keeping that logic buried in `server.ts` was harder to defend architecturally.
- Part 2 explicitly calls for template-based prompt logic and a provider boundary, even though the current baseline still runs inside `apps/api`.
- This refactor improves modularity and oral defensibility without changing the existing AI UX or SSE behavior.

## Acceptance Coverage

- Server still streams AI as before: covered by `backend-test-log.txt` and `ai-stream-transcript.txt`.
- AI tests still pass: covered by `backend-test-log.txt`.
- AI behavior is now centralized in one place: covered by `changed-files.txt` and the extracted `apps/api/src/ai/*` modules.
- Prompt and provider responsibilities are no longer buried in `server.ts`: covered by `changed-files.txt` and the implementation commit in `commit-hash.txt`.

## Evidence Files

- `backend-test-log.txt`: full `npm test` output for the API/WebSocket contract suite.
- `typecheck.txt`: full `npm run typecheck` output.
- `ai-stream-transcript.txt`: concise transcript of the unchanged AI create/stream/cancel lifecycle observed in the passing tests.
- `changed-files.txt`: exact files changed for this issue.
- `commit-hash.txt`: implementation commit hash for the code refactor.
- `pr-link.txt`: placeholder for the pull request URL.
- `notes.txt`: non-applicable evidence notes and documentation decisions.
