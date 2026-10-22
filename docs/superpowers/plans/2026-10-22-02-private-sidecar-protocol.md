# Private Sidecar Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir FastAPI/WebSocket por um sidecar privado, enquadrado e versionado em `stdin/stdout`, acessível somente pelo Electron Main.

**Architecture:** TypeScript e Python compartilharão um protocolo JSON com prefixo unsigned big-endian de 4 bytes e frames de até 16 MiB. `PythonBackendManager` verificará o artefato, iniciará um caminho absoluto, concluirá handshake e gerenciará requisições, cancelamento e até três reinícios. O processo Python preservará o loop do agente e ferramentas, mas não abrirá sockets.

**Tech Stack:** Electron/Node child processes, TypeScript, Python 3.11, `asyncio`, PyInstaller-ready runtime, `node:test`, `unittest`.

**Spec:** `docs/superpowers/specs/2026-10-22-jarvis-commercial-total-control-design.md`

## Global Constraints

- Frame: 4 bytes unsigned big-endian + JSON UTF-8; máximo `16777216` bytes.
- Texto: máximo 20.000 caracteres; IDs e nomes de ferramenta: máximo 160 caracteres.
- Versão inicial do protocolo: `1`; incompatibilidade encerra a sessão.
- Produção resolve apenas `process.resourcesPath/jasper-backend/jasper-backend.exe`.
- Desenvolvimento exige `JASPER_PYTHON_EXECUTABLE` e entrypoint sob `app.getAppPath()/jasper-backend/main.py`; sem busca em `PATH`, `cwd`, `venv` ou `.venv`.
- `stdout` contém apenas frames; `stderr` contém logs redigidos.
- No máximo três reinícios por sessão, com backoff `250 ms`, `1000 ms`, `4000 ms`.

## Review Focus

- Prefixo fragmentado, corpo fragmentado e vários frames no mesmo chunk devem ser decodificados sem perda.
- Tamanho declarado acima do limite ou JSON inválido deve matar a sessão sem alocar o corpo anunciado.
- Resposta duplicada, tardia ou com ID desconhecido deve ser ignorada e registrada sem resolver outra requisição.
- Morte do processo deve rejeitar todas as promises pendentes e não reiniciar após licença expirada.
- Dados arbitrários em `cwd`, `PATH` ou porta 8765 não podem substituir nem interceptar o sidecar.

---

### Task 1: Versioned framing in TypeScript and Python

**Files:**
- Create: `src/shared/types/backend-protocol.ts`
- Modify: `src/shared/index.ts`
- Create: `src/main/services/backend-framing.ts`
- Create: `jasper-backend/protocol.py`
- Create: `test/backend-framing.test.ts`
- Create: `jasper-backend/tests/test_protocol.py`
- Modify: `package.json`

**Interfaces:**
- Produces: `BackendEnvelope { version: 1; id: string; type: BackendMessageType; payload: unknown }`.
- Produces: `encodeFrame(message: BackendEnvelope): Buffer` and `FrameDecoder.push(chunk: Buffer): BackendEnvelope[]`.
- Produces: Python `encode_frame(message: dict) -> bytes` and `FrameDecoder.feed(chunk: bytes) -> list[dict]`.

- [ ] **Step 1: Write failing framing tests**

Cover round-trip Unicode, split prefix, split body, coalesced frames, zero/oversized length, invalid UTF-8, invalid JSON, version mismatch, ID/type limits and 20.001-character chat.

- [ ] **Step 2: Verify RED in both runtimes**

Run: `npm.cmd test`, then `python -m unittest discover -s jasper-backend/tests -v`.
Expected: FAIL because framing modules are absent.

- [ ] **Step 3: Implement both decoders**

Use incremental byte buffers and reject an invalid length before allocating the declared body. Validate the envelope after JSON parsing; never accept arrays or unknown message types.

- [ ] **Step 4: Add Python test script**

Add `test:python` as `python -m unittest discover -s jasper-backend/tests -v` in `package.json`.

- [ ] **Step 5: Verify GREEN and commit**

Run: `npm.cmd test`, `npm.cmd run test:python`, then `npm.cmd run typecheck`.
Expected: PASS.

```powershell
git add package.json package-lock.json src/shared/index.ts src/shared/types/backend-protocol.ts src/main/services/backend-framing.ts jasper-backend/protocol.py jasper-backend/tests/test_protocol.py test/backend-framing.test.ts
git commit -m "feat: add framed sidecar protocol"
```

### Task 2: Convert the Python backend to stdio

**Files:**
- Modify: `jasper-backend/main.py`
- Create: `jasper-backend/runtime.py`
- Modify: `jasper-backend/tools_os.py`
- Modify: `jasper-backend/requirements.txt`
- Create: `jasper-backend/tests/test_runtime.py`
- Replace: `test/python-backend.test.ts`

**Interfaces:**
- Consumes: Python framing from Task 1.
- Produces: `JasperRuntime.handle(message: dict) -> AsyncIterator[dict]`.
- Produces message handlers for `hello`, `config`, `chat`, `audio_input`, `interrupt`, `memory_snapshot`, `shutdown`.
- Emits `hello_ack`, `status`, `user_transcript`, `response`, `audio_output`, `tool_execution`, `tool_result`, `memory_upsert`, `memory_clear`, `turn_complete`, `interrupted`, `error`.

- [ ] **Step 1: Replace network tests with failing stdio runtime tests**

Assert source contains no `FastAPI`, `uvicorn`, `WebSocket`, `/health`, `/config` or port `8765`; handshake echoes correlation ID and protocol `1`; shutdown exits cleanly; malformed frame exits nonzero.

- [ ] **Step 2: Verify RED**

Run: `npm.cmd test`, then `npm.cmd run test:python`.
Expected: FAIL while the HTTP server remains.

- [ ] **Step 3: Extract agent runtime and implement stdio loop**

Move session/model/STT/TTS orchestration into `runtime.py`. In `main.py`, connect `sys.stdin.buffer` and `sys.stdout.buffer` to the decoder/encoder; route all logging to `stderr`; serialize writes through one async lock.

- [ ] **Step 4: Preserve total-control tools with stability limits**

Remove `_is_destructive_command` and semantic command denial. Keep schema checks, output cap, process timeout and typed errors. PowerShell executes with `-NoProfile -NonInteractive`; cancellation terminates the process tree.

- [ ] **Step 5: Remove network dependencies**

Delete `fastapi`, `uvicorn` and `websockets` from direct requirements. Retain only dependencies used by runtime, model, audio, screen and OS tools.

- [ ] **Step 6: Verify GREEN and commit**

Run: `npm.cmd test`, then `npm.cmd run test:python`.
Expected: PASS and no listener on `127.0.0.1:8765` during tests.

```powershell
git add jasper-backend/main.py jasper-backend/runtime.py jasper-backend/tools_os.py jasper-backend/requirements.txt jasper-backend/tests/test_runtime.py test/python-backend.test.ts
git commit -m "refactor: move backend to private stdio runtime"
```

### Task 3: Secure Electron sidecar manager

**Files:**
- Create: `src/main/services/backend-integrity.ts`
- Create: `src/main/generated/backend-manifest.ts`
- Replace: `src/main/services/python-backend.ts`
- Modify: `src/main/services/license-gate.ts`
- Create: `test/python-backend-manager.test.ts`

**Interfaces:**
- Consumes: `LicenseGate.requireUnlocked()` and TypeScript framing.
- Produces: `PythonBackendManager.start(): Promise<void>`, `stop(reason?: string): Promise<void>`, `request<T>(type, payload, timeoutMs?): Promise<T>`, `notify(type, payload): void`, `onMessage(listener): () => void`, `getState(): BackendState`.
- Consumes: injected `isExecutionAllowed(): boolean` callback supplied by the composition root, avoiding a circular import with `LicenseGate` while preventing restart after lock.
- Produces: `verifyBackendIntegrity(root: string, manifest: BackendManifest): Promise<void>`.

- [ ] **Step 1: Write failing manager tests**

Inject `spawn`, clock, paths and manifest. Assert packaged absolute path, required development executable, minimal environment, hash failure before spawn, handshake failure, timeout cleanup, late response isolation, stop rejection and exact three-restart backoff.

- [ ] **Step 2: Verify RED**

Run: `npm.cmd test`
Expected: FAIL because the current manager discovers Python and probes HTTP.

- [ ] **Step 3: Implement integrity and launch resolution**

Manifest types contain `protocolVersion`, `backendVersion` and sorted `{ path, sha256 }[]`. Production verifies every declared file, rejects missing/extra executable mismatch and launches `jasper-backend.exe`. Development uses only explicit `JASPER_PYTHON_EXECUTABLE` with the repository entrypoint.

- [ ] **Step 4: Implement request lifecycle and recovery**

Maintain one decoder and `Map<string, PendingRequest>`. Complete handshake before state `ready`; reject every pending request on process exit; restart only while injected `isExecutionAllowed()` returns true and the three-attempt budget remains.

- [ ] **Step 5: Verify GREEN and commit**

Run: `npm.cmd run typecheck`, `npm.cmd test`, then `npm.cmd run test:python`.
Expected: PASS.

```powershell
git add src/main/generated/backend-manifest.ts src/main/services/backend-integrity.ts src/main/services/python-backend.ts src/main/services/license-gate.ts test/python-backend-manager.test.ts
git commit -m "feat: supervise verified private sidecar"
```

### Task 4: Phase verification and handoff

**Files:**
- Modify: `docs/superpowers/plans/2026-10-22-02-private-sidecar-protocol.md`
- Modify: `docs/superpowers/plans/2026-10-22-jarvis-commercial-remediation-runbook.md`

**Interfaces:**
- Produces: private backend manager consumed by Phase 3.

- [ ] **Step 1: Run full protocol verification**

Run: `npm.cmd run typecheck`, `npm.cmd test`, `npm.cmd run test:python`, then `npm.cmd run scan:secrets`.
Expected: all commands exit `0` and test logs contain no Uvicorn/FastAPI/WebSocket listener.

- [ ] **Step 2: Prove removal and cleanliness**

Run: `git grep -n -E "FastAPI|uvicorn|ws://127\\.0\\.0\\.1:8765|new WebSocket" -- src jasper-backend test`
Expected: no runtime matches and exit code `1`. Then run `git diff --check`.

- [ ] **Step 3: Update runbook and commit**

```powershell
git add docs/superpowers/plans/2026-10-22-02-private-sidecar-protocol.md docs/superpowers/plans/2026-10-22-jarvis-commercial-remediation-runbook.md
git commit -m "docs: record private sidecar completion"
```
