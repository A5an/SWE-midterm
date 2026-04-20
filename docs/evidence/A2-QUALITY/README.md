# A2-QUALITY Evidence Bundle

- Issue: `A2-QUALITY`
- Workspace branch state: `chore/A2-QUALITY-submission-hardening`
- Implementation commit: see `commit-hash.txt`
- PR: `https://github.com/A5an/SWE-midterm/pull/17`

## What changed and why

- Hardened `run.sh` so a reviewer can start from a clean clone without manually installing Node dependencies or creating `.env` first.
- Expanded the root `.env.example` to document the variables actually used by the integrated Node baseline and the FastAPI auth proof.
- Rewrote the root README into a submission-ready runbook covering quick start, manual startup, FastAPI docs, validation commands, demo order, and evidence expectations.
- Added a deviation entry that records the quality-freeze hardening as an explicit implementation change with evidence links instead of leaving the setup process implicit.

These changes were made because Assignment 2 grading explicitly requires a single-command local run path, `.env.example`, comprehensive setup documentation, and documented deviations from the Assignment 1 architecture/process.

## Acceptance coverage

- Single-command run works: covered by `clean-clone-run.log`.
- `.env.example` exists and is documented: covered by `.env.example`, `README.md`, and `final-docs-diff.txt`.
- README is complete enough for reviewer setup and demo prep: covered by `README.md` and `final-docs-diff.txt`.
- DEVIATIONS updated with real evidence links: covered by `DEVIATIONS.md` and `final-docs-diff.txt`.

## Artifacts

- `clean-clone-run.log`: working-tree clean-clone bootstrap log showing `npm ci`, `.env` creation, API startup, detected Vite URL, and HTTP checks.
- `final-docs-diff.txt`: diff snapshot for the quality-ticket docs and run-script changes.
- `typecheck-log.txt`: repo typecheck output.
- `api-contract-tests.txt`: Node API/WebSocket contract test output.
- `backend-pytest.txt`: FastAPI pytest output.
- `build-log.txt`: production web build output.
- `commit-hash.txt`: implementation commit reference for this quality/docs bundle.
- `pr-link.txt`: GitHub pull request URL for this quality/docs bundle.
