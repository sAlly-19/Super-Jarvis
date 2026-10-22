# License-Gated Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o processo Main bloquear todo o agente até validar um lease Ed25519 de até 72 horas vinculado à instalação e à máquina.

**Architecture:** Um `LicenseGate` será a única autoridade de estado e coordenará `LicenseManager` e o ciclo de vida do backend. A verificação criptográfica usará um keyring compilado por `kid`; configuração editável nunca fornecerá chave pública. IPC operacional chamará `requireUnlocked()` antes de acessar configuração sensível, memória ou backend.

**Tech Stack:** Electron 44, TypeScript 5.7, Node 24, WebCrypto Ed25519, `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-22-jarvis-commercial-total-control-design.md`

## Global Constraints

- Estados exatos: `locked`, `validating`, `unlocked`, `expired`, `revoked`, `backend_error`.
- `iss=jasper-license-api`, `aud=jasper-avatar-desktop`, duração máxima `259200` segundos.
- Lease deve conter `kid`, `installationId`, `machineHash`, `iat` e `exp` válidos.
- Relógio mais antigo que o último horário confiável bloqueia até validação online.
- Somente licença e controles básicos de janela ficam disponíveis antes de `unlocked`.
- Node `>=24 <25`; nenhuma nova dependência de runtime nesta fase.

## Review Focus

- JWT malformado, JSON inválido ou assinatura em formato incorreto deve retornar `INVALID_LEASE`, nunca lançar para o renderer.
- `kid` ausente/desconhecido deve falhar fechado mesmo que a assinatura seja matematicamente válida com outra chave.
- Mudança de `installationId` ou `machineHash` deve invalidar o lease e parar o backend ativo.
- Regressão de relógio deve bloquear o cache offline, mas uma resposta online válida deve atualizar o horário confiável.
- Ativação concorrente ou refresh concorrente deve iniciar no máximo um processo de backend.

---

### Task 1: Test runner and shared license contracts

**Files:**
- Create: `src/shared/types/license.ts`
- Modify: `src/shared/index.ts`
- Modify: `src/shared/types/config.ts`
- Modify: `scripts/run-tests.mjs`
- Create: `test/license-manager.test.ts`

**Interfaces:**
- Produces: `LicenseState`, `LicenseGateSnapshot`, `LeaseClaims`, `LicenseValidationResult`, `LicenseInfo` from `@shared`.
- Produces: automatic discovery of every `test/**/*.test.ts` file by `scripts/run-tests.mjs`.

- [x] **Step 1: Write the failing contract tests**

Add tests named `exports_the_six_license_states` and `test_runner_discovers_new_test_files`; assert the exact state union and that `license-manager.test.ts` is included without a hard-coded entry.

- [x] **Step 2: Run the focused test and verify RED**

Run: `npm.cmd test`
Expected: FAIL because the shared license module and automatic discovery do not exist.

- [x] **Step 3: Implement the shared types and discovery**

Define `LicenseState = 'locked' | 'validating' | 'unlocked' | 'expired' | 'revoked' | 'backend_error'`; define `LeaseClaims` with `iss`, `aud`, `installationId`, `machineHash`, `iat`, `exp`; define `LicenseGateSnapshot` with `state`, `message`, `expiresAt?`. Move license result/info declarations out of `config.ts`, remove `licensePublicJwk`, and add `licenseLastTrustedAt?: string`. Discover tests deterministically by sorted filename.

- [x] **Step 4: Run tests and typecheck**

Run: `npm.cmd test`, then `npm.cmd run typecheck`.
Expected: PASS.

- [x] **Step 5: Commit**

```powershell
git add scripts/run-tests.mjs src/shared/index.ts src/shared/types/config.ts src/shared/types/license.ts test/license-manager.test.ts
git commit -m "test: define license runtime contracts"
```

### Task 2: Compiled Ed25519 keyring and strict lease verifier

**Files:**
- Create: `src/main/services/license-keyring.ts`
- Create: `src/main/services/lease-verifier.ts`
- Modify: `src/main/services/license-manager.ts`
- Modify: `src/main/config/config-store.ts`
- Test: `test/license-manager.test.ts`

**Interfaces:**
- Consumes: `LeaseClaims`, `LicenseValidationResult` from Task 1.
- Produces: `verifySignedLease(token: string, context: LeaseVerificationContext): Promise<VerifiedLease>`.
- Produces: `LICENSE_KEYRING: Readonly<Record<string, JsonWebKey>>` with `prod-2026-01` mapped to the production Ed25519 public coordinate `P_BiXYVYZ7nJ7Awagp-Q-qQBGEJ5w_4wJEr5qZ1JVCs`.
- Produces: `LicenseManager.verifyCurrentLicense(forceOnline?: boolean): Promise<LicenseValidationResult>` with `expiresAt?` and `trustedServerTime?`.

- [x] **Step 1: Add failing lease tests**

Use an ephemeral Ed25519 test key injected through `LeaseVerificationContext.keyring`. Cover valid claims, `exp-iat > 259200`, expired lease, future `iat > now+300`, missing/unknown `kid`, wrong installation, wrong machine, bad signature, malformed token and clock rollback.

- [x] **Step 2: Run the focused test and verify RED**

Run: `npm.cmd test`
Expected: FAIL because `verifySignedLease` does not exist.

- [x] **Step 3: Implement verifier and production keyring**

Parse all three JWT segments defensively, require `alg='EdDSA'`, select only `LICENSE_KEYRING[header.kid]`, and return typed claims only after signature and invariant validation. Use signed `iat * 1000` as trusted server time, monotonically persist it as `licenseLastTrustedAt`, store lease secrets with the existing `safeStorage` path, and remove `/v1/licenses/public-key` plus every read/write of `licensePublicJwk`.

- [x] **Step 4: Implement online/offline classification**

Map server revocation/suspension to `REVOKED`, elapsed `exp` to `EXPIRED`, absence to `NO_LICENSE`, and network failure before `exp` to valid offline access. Online success records a trusted server time from the authenticated response contract; rollback blocks offline access.

- [x] **Step 5: Run tests and typecheck**

Run: `npm.cmd test`, then `npm.cmd run typecheck`.
Expected: PASS with all lease cases covered.

- [x] **Step 6: Commit**

```powershell
git add src/main/services/license-keyring.ts src/main/services/lease-verifier.ts src/main/services/license-manager.ts src/main/config/config-store.ts test/license-manager.test.ts
git commit -m "feat: verify signed commercial leases"
```

### Task 3: LicenseGate state machine

**Files:**
- Create: `src/main/services/license-gate.ts`
- Create: `test/license-gate.test.ts`
- Modify: `src/main/index.ts`
- Modify: `src/main/ipc/register-ipc.ts`
- Modify: `src/main/services/python-backend.ts`

**Interfaces:**
- Consumes: `LicenseManager.verifyCurrentLicense()`, `LicenseManager.activateLicense(key)` and backend `start(): Promise<void>`, `stop(reason?: string): Promise<void>`.
- Produces: `LicenseGate.initialize(): Promise<LicenseGateSnapshot>`.
- Produces: `LicenseGate.activate(key: string): Promise<LicenseValidationResult>`.
- Produces: `LicenseGate.refresh(forceOnline?: boolean): Promise<LicenseGateSnapshot>`.
- Produces: `LicenseGate.requireUnlocked(): void`, `getSnapshot()`, `markBackendError(message)`, `shutdown()` and `onStateChanged(listener)`.

- [x] **Step 1: Add failing state-transition tests**

Assert: boot without lease never calls backend start; valid boot calls it once; concurrent initialize calls share one promise; expiry/revocation calls stop and transitions correctly; failed start becomes `backend_error`; successful activation becomes `unlocked`.

- [x] **Step 2: Run the focused test and verify RED**

Run: `npm.cmd test`
Expected: FAIL because `LicenseGate` does not exist.

- [x] **Step 3: Implement the state machine**

Inject `LicenseAuthority` and `BackendLifecycle` interfaces in the constructor for deterministic tests. Serialize transitions with one in-flight promise. `requireUnlocked()` throws a typed `LICENSE_REQUIRED` error for every non-unlocked state. Adapt the existing backend manager to the same `Promise<void>` lifecycle contract; failure to become ready throws.

- [x] **Step 4: Rewire application startup**

Register minimal IPC, create the window, then call `licenseGate.initialize()`. Remove unconditional `pythonBackend.start()`. Periodic checks call `licenseGate.refresh()`; `before-quit` and `window-all-closed` call `shutdown()`.

- [x] **Step 5: Gate IPC by category**

Keep `LICENSE_*` and `WINDOW_*` available. Require `unlocked` for chat, audio, configuration secrets, memory and update mutation. Activation goes through `licenseGate.activate()` and emits one state snapshot event.

- [x] **Step 6: Run verification**

Run: `npm.cmd run typecheck`, then `npm.cmd test`.
Expected: PASS; tests prove zero backend starts without a valid lease.

- [x] **Step 7: Commit**

```powershell
git add src/main/services/license-gate.ts src/main/services/python-backend.ts src/main/index.ts src/main/ipc/register-ipc.ts test/license-gate.test.ts
git commit -m "feat: gate runtime behind valid license"
```

### Task 4: Phase verification and handoff

**Files:**
- Modify: `docs/superpowers/plans/2026-10-22-jarvis-commercial-remediation-runbook.md`
- Modify: `docs/superpowers/plans/2026-10-22-01-license-gated-runtime.md`

**Interfaces:**
- Produces: verified `licenseGate` consumed by Phases 2 and 3.

- [x] **Step 1: Run the full phase gate under Node 24**

Run: `npm.cmd run typecheck`, `npm.cmd test`, then `npm.cmd run scan:secrets`.
Expected: all commands exit `0`; no test starts a backend for `locked`, `expired` or `revoked`.

- [x] **Step 2: Inspect the diff and update tracking**

Run: `git diff --check`, then `git status --short`.
Expected: no whitespace errors; only intended files remain modified. Mark completed checkboxes and set the runbook's next action to Phase 2.

- [x] **Step 3: Commit tracking updates**

```powershell
git add docs/superpowers/plans/2026-10-22-01-license-gated-runtime.md docs/superpowers/plans/2026-10-22-jarvis-commercial-remediation-runbook.md
git commit -m "docs: record license gate completion"
```
