# Provider-Aware Settings Dashboard Progress

**Spec:** `docs/superpowers/specs/2026-10-23-settings-provider-credentials-design.md`  
**Plan:** `docs/superpowers/plans/2026-10-23-provider-aware-settings-dashboard.md`  
**Branch:** `main`  
**Status:** Execution in progress — Task 4 verified; Task 5 is next

## Completed

- [x] Audited the current settings UI against implemented Jasper capabilities.
- [x] Confirmed BYOK commercial model.
- [x] Confirmed separate Gemini and Groq credentials plus keyless local Ollama.
- [x] Approved provider architecture, five-section dashboard, save/cancel behavior, migration, and security boundaries.
- [x] Wrote and committed the design spec in commit `bc1099f`.
- [x] Created the TDD implementation plan.
- [x] Baseline verification: `npm.cmd test` — 153 tests, 29 suites, 0 failures.

## Implementation Tasks

- [x] Task 1 — Provider catalog and shared contracts
- [x] Task 2 — Secure credential storage and legacy migration
- [x] Task 3 — Credential-safe IPC and preload boundary
- [x] Task 4 — Active provider sidecar synchronization
- [ ] Task 5 — Python provider routing and actionable errors
- [ ] Task 6 — Truthful dashboard structure and styling
- [ ] Task 7 — Renderer draft, provider UX, and onboarding
- [ ] Task 8 — Full verification and handoff

## Working Tree Constraint

Do not stage or commit the pre-existing Task 7 release/signing changes in `.github/workflows/release.yml`, `electron-builder.yml`, `scripts/verify-authenticode.ps1`, `src/main/services/update-manager.ts`, `test/update-policy.test.ts`, `test/release-workflow.test.ts`, or `test/verify-authenticode.test.ps1` as part of this feature.

## Task 1 Verification

- Commit: `4d7bad1` (`feat: define supported AI provider catalog`).
- `npm.cmd test -- ai-provider-catalog` — 4 tests, 0 failures.
- `npm.cmd test -- product-surface` — 8 tests, 0 failures.
- `npm.cmd test` — 157 tests, 30 suites, 0 failures.
- Next: Task 2 — secure credential storage and legacy migration.

## Task 2 Verification

- Commit: `0187a83` (`feat: store provider credentials independently`).
- `npm.cmd test -- config` — 10 tests, 0 failures.
- `npm.cmd test` — 163 tests, 30 suites, 0 failures.
- Verified independent encrypted credentials, masked summaries, active-key selection, provider/model allow-listing, idempotent legacy migration, and byte-for-byte preservation when decryption is unavailable.
- Next: Task 3 — credential-safe IPC and preload boundary.

## Task 3 Verification

- Commit: `b972c2b` (`feat: add credential-safe provider IPC`).
- `npm.cmd test -- agent-ipc` — 14 tests, 0 failures.
- `npm.cmd test -- preload-contract` — 2 tests, 0 failures.
- `npm.cmd test` — 168 tests, 30 suites, 0 failures.
- Verified locked-license gating for credential removal, 512-character key limits, missing-key refusal before health probing, active/inactive removal behavior, and selective backend synchronization.
- Next: Task 4 — active provider sidecar synchronization.

## Task 4 Verification

- `npm.cmd test -- provider-runtime-config` — 4 tests, 0 failures.
- `npm.cmd test -- python-backend-manager` — 17 tests, 0 failures.
- `npm.cmd test` — 172 tests, 31 suites, 0 failures.
- Verified that Gemini and Groq frames contain only the active key, Ollama sends an empty key, and missing remote credentials send no frame.
- Next: Task 5 — Python provider routing and actionable errors.

## Resume Instructions

Read the spec and plan above, inspect `git status`, then start at the first unchecked task using the execution skill selected by the user. After each task, record the commit hash, focused tests, result, and next task in this file.
