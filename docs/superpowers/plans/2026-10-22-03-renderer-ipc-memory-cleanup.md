# Renderer IPC, Memory and Product Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer toda interação do renderer passar por APIs de alto nível do preload, exibir somente ativação quando bloqueado e consolidar memória, consentimento e logs locais.

**Architecture:** O Electron Main traduz IPC validado para o protocolo privado e persiste memória. O preload expõe somente operações do produto; o antigo cliente WebSocket é removido. A UI deriva do snapshot do `LicenseGate`, monta capacidades somente em `unlocked` e exige um consentimento comercial único antes do primeiro uso.

**Tech Stack:** Electron IPC/contextBridge, TypeScript, DOM/CSS existente, armazenamento atômico em `userData`, `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-22-jarvis-commercial-total-control-design.md`

## Global Constraints

- Renderer nunca recebe caminho, pipe, processo, token integral, device secret ou lease integral.
- Todo canal valida `sender`, `senderFrame`, URL, schema, tamanho e estado `unlocked`.
- Texto máximo 20.000 caracteres; áudio/frame máximo 16 MiB.
- Memória única em `userData`, escrita atômica, retenção de 30 dias.
- Sem licença: ativação e controles básicos de janela; capacidades operacionais não são montadas.
- Consentimento único menciona controle integral, comandos, entrada, captura de tela e provedores de IA/STT/TTS.
- Sem confirmações por ação e sem controles falsos de módulos removidos.

## Review Focus

- Evento vindo de iframe, DevTools ou janela antiga deve ser rejeitado mesmo com URL aparente válida.
- Um payload transferido/detached, `SharedArrayBuffer` ou áudio acima de 16 MiB não deve alcançar o sidecar.
- Expiração durante áudio/chat deve cancelar a operação e impedir eventos tardios de repovoar a UI.
- Memória com timestamp inválido, futuro ou mais antigo que 30 dias deve ser normalizada sem perder itens válidos.
- Reabrir o aplicativo após consentimento válido não deve pedir novamente; trocar instalação não deve herdar o aceite.

---

### Task 1: High-level agent IPC and preload API

**Files:**
- Modify: `src/shared/constants/ipc-channels.ts`
- Create: `src/shared/types/agent-api.ts`
- Modify: `src/shared/index.ts`
- Replace: `src/main/ipc/register-ipc.ts`
- Replace: `src/preload/index.ts`
- Replace: `src/preload/index.d.ts`
- Create: `test/agent-ipc.test.ts`

**Interfaces:**
- Consumes: `LicenseGate.requireUnlocked()` and `PythonBackendManager.request/notify/onMessage`.
- Produces preload methods `connectAgent`, `disconnectAgent`, `sendText`, `sendAudio`, `interruptAgent`, `getAgentStatus`, `getMemory`, `clearMemory`.
- Produces events `onAgentStatus`, `onAgentText`, `onUserTranscript`, `onAgentAudio`, `onToolExecution`, `onTurnComplete`, `onInterrupted`, `onLicenseState`.

- [x] **Step 1: Write failing IPC tests**

Test trusted main frame acceptance, iframe/untrusted rejection, locked-state rejection for every operational channel, text/audio boundaries, backend error propagation and listener disposal.

- [x] **Step 2: Verify RED**

Run: `npm.cmd test`
Expected: FAIL because high-level channels do not exist and current chat/audio handlers are no-ops.

- [x] **Step 3: Define typed channel contracts**

Replace `GEMINI_*` with `AGENT_*`; keep license, update and window channels. Remove `AUTONOMY_*` placeholders. Define discriminated payloads for status, text, audio, tool execution and errors.

- [x] **Step 4: Implement Main broker and preload facade**

Translate IPC to sidecar messages in Main only. Clone/copy binary audio before validation, enforce limits, attach one listener per backend event, and return unsubscribe functions from preload event registrations.

- [x] **Step 5: Verify GREEN and commit**

Run: `npm.cmd run typecheck`, then `npm.cmd test`.
Expected: PASS.

```powershell
git add src/shared/constants/ipc-channels.ts src/shared/types/agent-api.ts src/shared/index.ts src/main/ipc/register-ipc.ts src/preload/index.ts src/preload/index.d.ts test/agent-ipc.test.ts
git commit -m "feat: broker agent traffic through main IPC"
```

### Task 2: Renderer migration and locked activation shell

**Files:**
- Modify: `src/renderer/main.ts`
- Modify: `src/renderer/index.html`
- Modify: `src/renderer/ui/license-modal.ts`
- Modify: `src/renderer/styles/modal.css`
- Delete: `src/renderer/src/services/jasperSocket.ts`
- Modify: `test/security-hardening.test.ts`
- Create: `test/renderer-license-shell.test.ts`

**Interfaces:**
- Consumes: high-level `window.electronAPI` from Task 1.
- Produces: `applyLicenseSnapshot(snapshot: LicenseGateSnapshot): void` and `mountAgentRuntime(): Promise<() => void>`.

- [x] **Step 1: Write failing renderer tests**

Assert no `WebSocket`, `ws://`, port 8765 or `jasperSocket` remains; locked boot does not construct mic, wake word, audio runtime or operational listeners; unlocked transition mounts once; revoke transition disposes and returns to activation.

- [x] **Step 2: Verify RED**

Run: `npm.cmd test`
Expected: FAIL while the renderer auto-connects the WebSocket.

- [x] **Step 3: Replace direct socket usage**

Map existing callbacks and microphone output to the preload API. Centralize all cleanup returned by `mountAgentRuntime()`. Ignore late events unless the current license snapshot remains `unlocked`.

- [x] **Step 4: Implement activation-only shell**

At locked boot, mount license modal plus minimize/maximize/close only. Remove operational controls from the DOM or keep templates inert until unlock; hiding with CSS alone is insufficient.

- [x] **Step 5: Remove legacy client and verify**

Run: `npm.cmd run typecheck`, then `npm.cmd test`.
Expected: PASS and `git grep -n "jasperSocket\|new WebSocket\|8765" -- src` returns no matches.

- [x] **Step 6: Commit**

```powershell
git add -A src/renderer test/security-hardening.test.ts test/renderer-license-shell.test.ts
git commit -m "refactor: route renderer through licensed preload API"
```

### Task 3: Single persistent memory

**Files:**
- Modify: `src/shared/types/memory.ts`
- Modify: `src/main/memory.ts`
- Modify: `src/main/ipc/register-ipc.ts`
- Modify: `src/main/services/python-backend.ts`
- Modify: `jasper-backend/runtime.py`
- Create: `test/memory-sync.test.ts`

**Interfaces:**
- Produces: `MemoryStore.load(now?: number): JasperMemory`, `upsert(event: MemoryUpsert): JasperMemory`, `clear(): JasperMemory`, `snapshot(): JasperMemory`.
- Consumes/emits sidecar messages `memory_snapshot`, `memory_upsert`, `memory_clear`.

- [x] **Step 1: Write failing retention and synchronization tests**

Cover atomic persistence, deduplication, 30-day pruning, invalid timestamps, installation binding, snapshot on sidecar ready, upsert persistence and clear in both directions.

- [x] **Step 2: Verify RED**

Run: `npm.cmd test`, then `npm.cmd run test:python`.
Expected: FAIL because current memory stores string facts without event synchronization.

- [x] **Step 3: Implement `MemoryStore`**

Inject file path, installation ID and clock. Normalize every item to stable ID, text, created/updated timestamps; prune at `30 * 24 * 60 * 60 * 1000`; write atomically using the existing utility.

- [x] **Step 4: Wire sidecar synchronization**

Send snapshot after handshake/config. Persist sidecar upserts/clear before notifying renderer. Clearing through IPC updates disk and sidecar in one serialized operation.

- [x] **Step 5: Verify GREEN and commit**

Run: `npm.cmd run typecheck`, `npm.cmd test`, then `npm.cmd run test:python`.
Expected: PASS.

```powershell
git add src/shared/types/memory.ts src/main/memory.ts src/main/ipc/register-ipc.ts src/main/services/python-backend.ts jasper-backend/runtime.py test/memory-sync.test.ts
git commit -m "feat: persist one synchronized agent memory"
```

### Task 4: Consent, local audit log and obsolete product surface

**Files:**
- Create: `src/main/services/audit-log.ts`
- Create: `src/main/services/operational-access.ts`
- Create: `src/renderer/ui/control-consent-modal.ts`
- Modify: `src/main/config/config-store.ts`
- Modify: `src/shared/types/config.ts`
- Modify: `src/main/ipc/register-ipc.ts`
- Modify: `src/renderer/main.ts`
- Modify: `src/renderer/index.html`
- Modify: `src/renderer/ui/settings-modal.ts`
- Delete: `src/renderer/ui/module-info-modal.ts`
- Create: `test/audit-log.test.ts`
- Create: `test/product-surface.test.ts`

**Interfaces:**
- Produces: `AuditLog.write(event: AuditEvent): Promise<void>` with redaction and rotation.
- Produces: `controlConsentAcceptedAt?: string` and `controlConsentInstallationId?: string` in protected configuration.
- Produces: `OperationalAccess.requireAgentAccess(): void`, requiring both `LicenseGate` state `unlocked` and installation-bound consent.
- Produces: `acceptControlConsent(): Promise<void>` preload operation available only after a valid license.

- [x] **Step 1: Write failing audit/consent/cleanup tests**

Assert redaction of API keys, JWTs, authorization headers, passwords and device secrets; no command text/audio/screenshot persistence; consent is installation-bound; legacy confirmation mode, botão/atalho de emergência, fake autonomy fields/channels and fake success handlers are absent.

- [x] **Step 2: Verify RED**

Run: `npm.cmd test`
Expected: FAIL because audit log and consent do not exist and obsolete fields remain.

- [x] **Step 3: Implement redacted local audit log**

Write JSONL under `userData/logs`, cap each file at 5 MiB and retain five files. Record timestamp, event, tool name, duration and summarized outcome only. Never log raw command, recognized text, audio, screenshot or full model response.

- [x] **Step 4: Implement one-time commercial consent**

After license unlock and before mounting runtime, require explicit acceptance of the exact capabilities listed in the spec. Persist acceptance for the same installation; do not add per-action confirmations. Every agent/chat/audio/memory mutation handler calls `OperationalAccess.requireAgentAccess()` so a renderer adulterado cannot bypass the modal.

- [x] **Step 5: Remove obsolete configuration and UI**

Delete `ConfirmationMode`, `confirmationMode`, removed autonomy toggles and their settings markup/handlers. Remove fake smart-home/webhook/reflexion IPC success responses and module cards that no longer have implementations.

- [x] **Step 6: Verify GREEN and commit**

Run: `npm.cmd run typecheck`, `npm.cmd test`, then `npm.cmd run scan:secrets`.
Expected: PASS.

```powershell
git add -A src test/audit-log.test.ts test/product-surface.test.ts
git commit -m "feat: add consent logs and remove fake surfaces"
```

### Task 5: Phase verification and handoff

**Files:**
- Modify: `docs/superpowers/plans/2026-10-22-03-renderer-ipc-memory-cleanup.md`
- Modify: `docs/superpowers/plans/2026-10-22-jarvis-commercial-remediation-runbook.md`

**Interfaces:**
- Produces: product runtime and UI ready for packaging in Phase 4.

- [x] **Step 1: Run the full application verification under Node 24**

Run: `npm.cmd run typecheck`, `npm.cmd test`, `npm.cmd run test:python`, `npm.cmd run build`, then `npm.cmd run scan:secrets`.
Expected: all commands exit `0`; renderer bundle completes without the Node 26 memory failure.

- [x] **Step 2: Inspect forbidden legacy references**

Run: `git grep -n -E "jasperSocket|FastAPI|AUTONOMY_|confirmationMode|licensePublicJwk" -- src jasper-backend test`
Expected: no runtime matches (exit code `1`). Run `git diff --check` afterward.

- [x] **Step 3: Update runbook and commit**

```powershell
git add docs/superpowers/plans/2026-10-22-03-renderer-ipc-memory-cleanup.md docs/superpowers/plans/2026-10-22-jarvis-commercial-remediation-runbook.md
git commit -m "docs: record renderer broker completion"
```
