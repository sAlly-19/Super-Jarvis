# Development Python Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `npm run dev` start the licensed Python sidecar with a validated absolute Python 3.11 executable without weakening packaged-runtime controls.

**Architecture:** Keep `PythonBackendManager` fail-closed and unchanged. A Node launcher resolves Python only from an explicit environment value or deterministic development locations, verifies version 3.11, injects the canonical absolute path into the Electron process, and invokes the repository-local `electron-vite` CLI without a shell.

**Tech Stack:** Node.js 24 ESM, Electron Vite 5, Python 3.11, Node test runner.

**Spec:** `docs/superpowers/plans/2026-10-22-02-private-sidecar-protocol.md`

## Global Constraints

- Development must provide an absolute existing `JASPER_PYTHON_EXECUTABLE` to `PythonBackendManager`.
- Do not search arbitrary `PATH`, current-working-directory, `venv`, `.venv`, or personal hardcoded usernames inside the runtime manager.
- Packaged mode continues to execute only the integrity-verified bundled sidecar.
- Keep unrelated Task 7 release-signing changes out of this hotfix commit.

## Review Focus

- Missing Python: fail before Electron starts with an actionable error.
- Wrong Python version: reject anything other than major/minor 3.11.
- Explicit override: validate and prefer `JASPER_PYTHON_EXECUTABLE` without silently falling back.
- Command injection: execute the repository-local CLI with an argument array and `shell: false`.
- Cross-process propagation: the Electron child receives the canonical absolute Python path.

---

### Task 1: Add a secure development launcher

**Files:**

- Create: `scripts/development-python.mjs`
- Create: `scripts/run-development.mjs`
- Modify: `package.json`
- Modify: `README.md`
- Test: `test/development-launcher.test.ts`

**Interfaces:**

- Produces: `resolveDevelopmentPython(options?): string`
- Produces: `createDevelopmentLaunch(pythonExecutable, options?): { command, args, cwd, env, shell }`
- Consumes: repository-local `node_modules/electron-vite/bin/electron-vite.js`

- [x] **Step 1: Write the failing test**

Add tests proving the resolver prefers a validated explicit path, selects a deterministic Python 3.11 candidate when the environment variable is absent, rejects a wrong version, and creates a shell-free launch specification containing the canonical `JASPER_PYTHON_EXECUTABLE`.

- [x] **Step 2: Run test to verify it fails**

Run: `npm.cmd test -- development-launcher`

Expected: FAIL because the development bootstrap module does not exist.

- [x] **Step 3: Implement the resolver and launcher**

Implement the two exported interfaces in `scripts/development-python.mjs`. Implement signal/exit forwarding in `scripts/run-development.mjs`, and point the `dev` script to it while retaining `predev` asset setup.

- [x] **Step 4: Document the development contract**

Explain automatic deterministic resolution and the explicit override in `README.md`; do not claim packaged customers need Python.

- [x] **Step 5: Verify**

Run:

```powershell
npm.cmd test -- development-launcher
npm.cmd run typecheck
npm.cmd test
node scripts/run-development.mjs --check
```

Expected: all tests pass, typecheck exits 0, and `--check` reports a canonical Python 3.11 executable without opening Electron.

- [x] **Step 6: Commit**

```powershell
git add scripts/development-python.mjs scripts/run-development.mjs test/development-launcher.test.ts package.json README.md docs/superpowers/plans/2026-10-23-development-python-bootstrap.md
git commit -m "fix: bootstrap Python for development runtime"
```

### Final review amendments

- [x] Reject a present but empty/whitespace `JASPER_PYTHON_EXECUTABLE` without falling back to another interpreter.
- [x] Forward termination signals to Electron Vite, remove handlers on exit, and preserve conventional signal exit codes.
- [x] Verify focused tests 7/7, isolated Python handshake 6/6, TypeScript typecheck, development check, and full Node suite 153/153.
