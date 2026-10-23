# Commercial Audit Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir as falhas encontradas na auditoria do JARVIS comercial e produzir evidências reproduzíveis de que licenciamento, isolamento, atualizações, empacotamento e automação funcionam com segurança em uma instalação limpa.

**Architecture:** O Electron main process continua sendo a autoridade única de licença e ciclo de vida. O renderer recebe somente snapshots derivados dessa autoridade; o sidecar Python permanece inacessível enquanto bloqueado, recebe segredos pelo protocolo após o handshake e é encerrado por árvore de processos. Testes de fonte, artefato e smoke ficam separados, e o release comercial só é aprovado quando o binário assinado passa pelas verificações de CI e runtime.

**Tech Stack:** Electron, TypeScript, Node.js 24, Python 3.12, node:test, unittest, electron-builder, electron-updater, GitHub Actions, CodeQL, PowerShell e pip-audit.

**Spec:** docs/superpowers/specs/2026-10-22-jarvis-commercial-total-control-design.md

**Audit baseline:** commit 9a3c1b4 em 2026-10-23.

## Global Constraints

- O produto é Windows-only e não depende de Python ou Node instalados pelo cliente.
- O JARVIS inteiro permanece bloqueado sem licença válida. No estado bloqueado, somente ativação, consulta de licença/HWID e controles básicos da janela ficam disponíveis.
- A lease comercial é revalidada no servidor no máximo a cada 72 horas, mas expiração e revogação já conhecidas bloqueiam imediatamente.
- Nunca incluir chave privada, licença de teste, bypass, endpoint de desenvolvimento ou segredo de provedor no pacote comercial.
- O agente executa ferramentas autorizadas sem prompts internos de confirmação; licença, políticas do sistema operacional e limites do processo continuam obrigatórios.
- Toda mudança de comportamento começa por teste que falha. Não enfraquecer testes para aceitar comportamento inseguro.
- Executar a suíte Node com Node.js 24, conforme os workflows. Node.js 26 não serve como evidência de release.
- Cada tarefa termina com commit pequeno e reversível, sem mudanças não relacionadas.
- Atualizar os checkboxes e o runbook com evidências; não declarar conclusão com etapas pendentes.

## Review Focus

- Atomicidade das transições de licença.
- Origem assinada de expiresAt e resistência a rollback de relógio.
- Encerramento da árvore do sidecar e comandos PowerShell descendentes.
- Ausência de segredos em ambientes herdáveis e logs.
- Negação padrão no IPC e descarte de eventos tardios.
- Assinatura Authenticode do instalador, executáveis internos e atualização.
- Reprodutibilidade em checkout limpo.
- Evidência funcional para toda capacidade anunciada.

---

## Phase 1 — License authority and runtime containment

### Task 1: Make license state transitions atomic and unambiguous

**Files:**

- Modify: src/main/services/license-gate.ts
- Modify: src/main/index.ts
- Modify: src/main/ipc/register-ipc.ts
- Modify: src/shared/constants/ipc-channels.ts
- Modify: src/shared/types/license.ts
- Modify: src/preload/index.ts
- Modify: src/preload/index.d.ts
- Modify: src/renderer/main.ts
- Modify: src/renderer/ui/license-modal.ts
- Test: test/license-gate.test.ts
- Test: test/agent-ipc.test.ts
- Test: test/renderer-license-shell.test.ts

- [ ] Add failing tests proving successful activation cannot be followed by a synthetic revoked state, backend startup failure leaves the gate locked, and each transition emits exactly one canonical snapshot.
- [ ] Run the focused tests and record the expected failures:
      npx.cmd --yes node@24 scripts/run-tests.mjs license-gate
      npx.cmd --yes node@24 scripts/run-tests.mjs agent-ipc
      npx.cmd --yes node@24 scripts/run-tests.mjs renderer-license-shell
- [ ] Introduce one result contract:
      interface LicenseActivationOutcome {
        validation: LicenseValidationResult;
        snapshot: LicenseGateSnapshot;
      }
- [ ] Make LicenseGate.activate return LicenseActivationOutcome instead of the raw HTTP result.
- [ ] Replace competing LICENSE_STATE and LICENSE_REVOKED paths with one LICENSE_STATUS_CHANGED event carrying a complete LicenseGateSnapshot.
- [ ] Remove renderer logic that fabricates a revoked snapshot from an event name.
- [ ] Use this transition order: validate lease, persist authoritative lease, start backend, publish unlocked. On failure, stop backend, publish one locked/error snapshot and return failure.
- [ ] Close the activation modal only when outcome.snapshot.state equals unlocked.
- [ ] Run focused tests and type checking:
      npx.cmd --yes node@24 scripts/run-tests.mjs license-gate
      npx.cmd --yes node@24 scripts/run-tests.mjs agent-ipc
      npx.cmd --yes node@24 scripts/run-tests.mjs renderer-license-shell
      npm.cmd run typecheck
- [ ] Commit:
      git add src/main/services/license-gate.ts src/main/index.ts src/main/ipc/register-ipc.ts src/shared/constants/ipc-channels.ts src/shared/types/license.ts src/preload/index.ts src/preload/index.d.ts src/renderer/main.ts src/renderer/ui/license-modal.ts test/license-gate.test.ts test/agent-ipc.test.ts test/renderer-license-shell.test.ts
      git commit -m "fix: make license transitions atomic"

### Task 2: Enforce monotonic lease time and exact expiry

**Files:**

- Modify: src/main/services/license-manager.ts
- Modify: src/main/services/lease-verifier.ts
- Modify: src/main/services/license-gate.ts
- Modify: src/shared/types/license.ts
- Test: test/license-manager.test.ts
- Create: test/lease-verifier.test.ts
- Test: test/license-gate.test.ts

- [ ] Add failing tests for rollback from a previously observed time to an earlier instant, including one still between signed iat and exp.
- [ ] Add a failing test proving unsigned API expiresAt cannot override signed JWT exp.
- [ ] Add fake-clock tests proving the gate locks at signed expiry without waiting for the hourly refresh loop.
- [ ] Add a failing test proving offline validation advances the last-observed monotonic time.
- [ ] Run the focused tests and confirm red:
      npx.cmd --yes node@24 scripts/run-tests.mjs license-manager
      npx.cmd --yes node@24 scripts/run-tests.mjs lease-verifier
- [ ] Persist signed server time and local monotonic observation separately with licenseLastTrustedAt and licenseLastObservedAt.
- [ ] Derive effective expiry only from verified signed claims. Reject or explicitly ignore conflicting unsigned metadata.
- [ ] On every accepted online or offline validation persist max(previousLastObservedAt, now); reject a current clock earlier than the stored observation.
- [ ] Inject clock and timer functions into LicenseGate so tests never sleep.
- [ ] Schedule a one-shot lock at signed expiry and reschedule after each accepted lease. Clear the timer on shutdown/revocation.
- [ ] Keep the 72-hour server revalidation independent from local expiry enforcement.
- [ ] Run focused tests and type checking:
      npx.cmd --yes node@24 scripts/run-tests.mjs license-manager
      npx.cmd --yes node@24 scripts/run-tests.mjs lease-verifier
      npx.cmd --yes node@24 scripts/run-tests.mjs license-gate
      npm.cmd run typecheck
- [ ] Commit:
      git add src/main/services/license-manager.ts src/main/services/lease-verifier.ts src/main/services/license-gate.ts src/shared/types/license.ts test/license-manager.test.ts test/lease-verifier.test.ts test/license-gate.test.ts
      git commit -m "fix: enforce signed lease expiry and clock monotonicity"

### Task 3: Terminate process trees and prevent secret inheritance

**Files:**

- Create: src/main/services/process-tree.ts
- Modify: src/main/services/python-backend.ts
- Modify: jasper-backend/tools_os.py
- Create: test/process-tree.test.ts
- Test: test/python-backend-manager.test.ts
- Create: jasper-backend/tests/test_tools_os.py

- [ ] Add a failing manager test proving revoke/stop rejects pending requests before process termination completes.
- [ ] Add a failing Windows integration fixture that starts a child and grandchild process and verifies both PIDs disappear after stop.
- [ ] Add failing tests proving provider keys and JARVIS secrets are absent from the sidecar spawn environment and tool subprocess environments.
- [ ] Add a failing development test proving startup fails unless JASPER_PYTHON_EXECUTABLE points to an executable and the backend entrypoint is inside repository/app resources.
- [ ] Run focused Node and Python tests and confirm red:
      npx.cmd --yes node@24 scripts/run-tests.mjs process-tree
      npx.cmd --yes node@24 scripts/run-tests.mjs python-backend-manager
      python -m unittest discover -s jasper-backend/tests -v
- [ ] Implement a Windows process-tree terminator using argument-array spawn of taskkill.exe /PID pid /T /F; expose an injectable interface for tests.
- [ ] Stop sequence: block requests, detach output, reject pending work, request graceful shutdown with a bounded timeout, terminate the tree and await exit.
- [ ] Give Python tool commands bounded tree termination on timeout.
- [ ] Remove provider keys from the sidecar spawn environment. Send them only in the post-handshake configuration frame.
- [ ] Build an explicit minimal environment for tool subprocesses excluding provider keys, license material and internal secrets.
- [ ] Remove discovery via PATH, .venv, venv and personal hardcoded paths. Development uses only validated JASPER_PYTHON_EXECUTABLE; packaged mode uses the bundled sidecar.
- [ ] Run affected tests and verify no orphan PID remains:
      npx.cmd --yes node@24 scripts/run-tests.mjs process-tree
      npx.cmd --yes node@24 scripts/run-tests.mjs python-backend-manager
      python -m unittest discover -s jasper-backend/tests -v
      npm.cmd run typecheck
- [ ] Commit:
      git add src/main/services/process-tree.ts src/main/services/python-backend.ts jasper-backend/tools_os.py test/process-tree.test.ts test/python-backend-manager.test.ts jasper-backend/tests/test_tools_os.py
      git commit -m "fix: contain backend process trees and secrets"

### Task 4: Make the backend protocol strict and supervision deterministic

**Files:**

- Modify: src/main/services/backend-framing.ts
- Modify: src/main/services/python-backend.ts
- Modify: src/shared/types/backend-protocol.ts
- Modify: jasper-backend/protocol.py
- Test: test/backend-framing.test.ts
- Test: test/python-backend-manager.test.ts
- Test: jasper-backend/tests/test_protocol.py

- [ ] Add failing parity tests for every allowed message type in TypeScript and Python.
- [ ] Add failing tests for invalid UTF-8, unknown message type, missing payload fields, oversized frames and wrong direction/state.
- [ ] Add a failing test proving protocol violations tear down the session and reject pending requests.
- [ ] Replace restart tests that use sleeps with an injected scheduler/fake clock.
- [ ] Add failing tests for exactly three restart attempts at 250 ms, 1 s and 4 s, with no reset after an arbitrary healthy interval.
- [ ] Run focused suites and confirm red:
      npx.cmd --yes node@24 scripts/run-tests.mjs backend-framing
      npx.cmd --yes node@24 scripts/run-tests.mjs python-backend-manager
      python -m unittest jasper-backend.tests.test_protocol -v
- [ ] Define one readonly allowlist of message names on each side and reject unknown types before dispatch.
- [ ] Decode TypeScript payloads with fatal UTF-8 handling and validate the payload shape associated with every type.
- [ ] Enforce handshake/direction rules: no operational messages before hello, no second hello, and no host-only messages from the backend.
- [ ] Treat protocol violations as fatal for that process, governed by the three-attempt session budget.
- [ ] Inject scheduler functions and remove timing sleeps from tests.
- [ ] Run focused tests ten times, then type checking:
      npx.cmd --yes node@24 scripts/run-tests.mjs backend-framing
      1..10 | ForEach-Object { npx.cmd --yes node@24 scripts/run-tests.mjs python-backend-manager; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
      python -m unittest jasper-backend.tests.test_protocol -v
      npm.cmd run typecheck
- [ ] Commit:
      git add src/main/services/backend-framing.ts src/main/services/python-backend.ts src/shared/types/backend-protocol.ts jasper-backend/protocol.py test/backend-framing.test.ts test/python-backend-manager.test.ts jasper-backend/tests/test_protocol.py
      git commit -m "fix: harden sidecar protocol and supervision"

### Task 5: Deny IPC and late events while locked

**Files:**

- Modify: src/main/ipc/register-ipc.ts
- Modify: src/main/index.ts
- Modify: src/renderer/main.ts
- Modify: src/shared/constants/ipc-channels.ts
- Test: test/agent-ipc.test.ts
- Test: test/renderer-license-shell.test.ts
- Test: test/memory-sync.test.ts

- [ ] Add a table-driven failing test that invokes every IPC channel while locked.
- [ ] Assert the only allowed locked channels are license status, activation, HWID and basic window controls.
- [ ] Add failing tests proving config, consent, dialogs, updates, agent status, tools, chat, memory and settings are denied while locked.
- [ ] Add failing tests proving late backend output, memory writes, audio and tool results are discarded after expiry/revocation.
- [ ] Add a failing bootstrap test proving operational config and services are not requested before unlocked.
- [ ] Run focused tests and confirm red:
      npx.cmd --yes node@24 scripts/run-tests.mjs agent-ipc
      npx.cmd --yes node@24 scripts/run-tests.mjs renderer-license-shell
      npx.cmd --yes node@24 scripts/run-tests.mjs memory-sync
- [ ] Centralize LOCKED_ALLOWED_CHANNELS and make every other handler call requireUnlocked before reading or mutating state.
- [ ] Guard outbound sidecar forwarding with the current gate snapshot; invalidate the session token on every lock transition.
- [ ] Defer renderer operational initialization until unlocked and tear it down on each transition away from unlocked.
- [ ] Run focused and complete Node suites:
      npx.cmd --yes node@24 scripts/run-tests.mjs agent-ipc
      npx.cmd --yes node@24 scripts/run-tests.mjs renderer-license-shell
      npx.cmd --yes node@24 scripts/run-tests.mjs memory-sync
      npm.cmd test
- [ ] Commit:
      git add src/main/ipc/register-ipc.ts src/main/index.ts src/renderer/main.ts src/shared/constants/ipc-channels.ts test/agent-ipc.test.ts test/renderer-license-shell.test.ts test/memory-sync.test.ts
      git commit -m "fix: enforce locked IPC boundary"

---

## Phase 2 — Honest product surface and trusted delivery

### Task 6: Remove nonfunctional commercial features and compatibility stubs

**Files:**

- Modify: src/shared/types/config.ts
- Modify: src/main/config/config-store.ts
- Modify: src/main/ipc/register-ipc.ts
- Modify: src/preload/index.ts
- Modify: src/renderer/index.html
- Modify: src/renderer/ui/settings-modal.ts
- Modify: src/renderer/main.ts
- Test: test/product-surface.test.ts
- Create: test/config.test.ts
- Create: test/preload-contract.test.ts

- [ ] Define the supported public configuration whitelist in a test: apiKey, voiceName, model, agentName, checkUpdatesDaily, enableWakeWord, enableBloom, enableNeuralBg, enableEyeTracking and enableScreenAwareness.
- [ ] Keep license, consent and migration fields internal rather than presenting them as customer features.
- [ ] Add failing tests scanning DOM, shared types, preload and settings for unsupported smart-home, webhook, subagent, semantic-memory, command-approval and inactive tool toggles.
- [ ] Add a failing round-trip test proving unknown config keys are rejected and not persisted.
- [ ] Run product/config tests and confirm red:
      npx.cmd --yes node@24 scripts/run-tests.mjs product-surface
      npx.cmd --yes node@24 scripts/run-tests.mjs config
      npx.cmd --yes node@24 scripts/run-tests.mjs preload-contract
- [ ] Remove unsupported cards, toggles, labels, type fields, IPC handlers and compatibility stubs instead of leaving no-ops.
- [ ] Preserve only capabilities with working implementations and automated functional tests.
- [ ] Add an explicit migration that drops obsolete keys without deleting license or consent data.
- [ ] Run tests, type checking and build:
      npx.cmd --yes node@24 scripts/run-tests.mjs product-surface
      npx.cmd --yes node@24 scripts/run-tests.mjs config
      npx.cmd --yes node@24 scripts/run-tests.mjs preload-contract
      npm.cmd run typecheck
      npm.cmd run build
- [ ] Commit:
      git add src/shared/types/config.ts src/main/config/config-store.ts src/main/ipc/register-ipc.ts src/preload/index.ts src/renderer/index.html src/renderer/ui/settings-modal.ts src/renderer/main.ts test/product-surface.test.ts test/config.test.ts test/preload-contract.test.ts
      git commit -m "fix: align commercial UI with implemented features"

### Task 7: Enforce publisher identity for installation and updates

**Files:**

- Modify: electron-builder.yml
- Modify: src/main/services/update-manager.ts
- Modify: scripts/verify-authenticode.ps1
- Modify: .github/workflows/release.yml
- Test: test/update-policy.test.ts
- Create: test/release-workflow.test.ts
- Create: test/verify-authenticode.test.ps1

- [ ] Add a failing test proving publisherName is mandatory and exactly matches the approved certificate subject.
- [ ] Add failing PowerShell tests proving substring or partial subject matches are rejected.
- [ ] Add a failing workflow test reproducing multiple executable paths and proving the script receives the complete array in one PowerShell process.
- [ ] Add a failing updater test proving an update with a different signer is rejected before installation.
- [ ] Run focused tests and confirm red:
      npx.cmd --yes node@24 scripts/run-tests.mjs update-policy
      npx.cmd --yes node@24 scripts/run-tests.mjs release-workflow
      pwsh -NoProfile -File test/verify-authenticode.test.ps1
- [ ] Set publisherName from one documented commercial certificate subject and assert packaged app-update.yml contains it.
- [ ] Pin updater owner, repository and channel. Reject runtime overrides from renderer, config or environment in commercial builds.
- [ ] Compare Authenticode signer subject exactly after canonical whitespace normalization; require Status equal to Valid for every executable and installer.
- [ ] Invoke verify-authenticode.ps1 with the call operator inside the existing release pwsh step so arrays remain arrays.
- [ ] Verify installed binaries and the downloaded update before quitAndInstall.
- [ ] Run focused tests and build:
      npx.cmd --yes node@24 scripts/run-tests.mjs update-policy
      npx.cmd --yes node@24 scripts/run-tests.mjs release-workflow
      pwsh -NoProfile -File test/verify-authenticode.test.ps1
      npm.cmd run build
- [ ] Commit:
      git add electron-builder.yml src/main/services/update-manager.ts scripts/verify-authenticode.ps1 .github/workflows/release.yml test/update-policy.test.ts test/release-workflow.test.ts test/verify-authenticode.test.ps1
      git commit -m "fix: enforce signed update publisher identity"

---

## Phase 3 — Reproducible verification and release evidence

### Task 8: Separate source tests from artifact tests and make security CI fail closed

**Files:**

- Modify: package.json
- Modify: scripts/run-tests.mjs
- Create: scripts/run-package-tests.mjs
- Move: test/python-package.test.ts to test-artifact/python-package.test.ts
- Modify: scripts/python-audit.ps1
- Create: jasper-backend/requirements-audit.lock
- Modify: .github/workflows/ci.yml
- Modify: .github/workflows/release.yml
- Create: .github/workflows/codeql.yml
- Create: test/ci-workflow.test.ts
- Create: test/python-audit-script.test.ts

- [ ] Add a failing clean-checkout test proving npm test does not require a prebuilt sidecar.
- [ ] Add a failing artifact test proving npm run test:package fails without a sidecar and passes only after build:python.
- [ ] Add a failing static test proving Python audit cannot report success when pip-audit is unavailable or skipped.
- [ ] Add failing workflow assertions for source-test-before-build ordering, artifact tests after sidecar build, and CodeQL analysis of javascript-typescript and python.
- [ ] Run new tests and confirm red:
      npx.cmd --yes node@24 scripts/run-tests.mjs ci-workflow
      npx.cmd --yes node@24 scripts/run-tests.mjs python-audit-script
- [ ] Make npm test execute source tests only and add test:package for compiled assets.
- [ ] Make package:dir self-contained. If release optimization is needed, add an internal package:dir:from-build command used only after explicit build steps.
- [ ] Pin pip-audit==2.10.1 with hashes in requirements-audit.lock, install it in an isolated audit environment, and fail closed on install, network, invocation or report errors. Remove the hash-only fallback.
- [ ] Add CodeQL v4 with a language matrix for TypeScript/JavaScript and Python, least-privilege permissions, pull-request/protected-branch triggers and a schedule.
- [ ] Order CI/release as: locked install, source verification, sidecar build, artifact tests, directory package, package verification, smoke, then signing/release checks.
- [ ] Run the clean-build sequence:
      npm.cmd run verify
      npm.cmd run build:python
      npm.cmd run test:package
      pwsh -NoProfile -File scripts/python-audit.ps1
- [ ] Commit:
      git add package.json scripts/run-tests.mjs scripts/run-package-tests.mjs test/python-package.test.ts test-artifact/python-package.test.ts scripts/python-audit.ps1 jasper-backend/requirements-audit.lock .github/workflows/ci.yml .github/workflows/release.yml .github/workflows/codeql.yml test/ci-workflow.test.ts test/python-audit-script.test.ts
      git commit -m "ci: make clean builds and security audits reproducible"

### Task 9: Verify actual Electron fuses and smoke the packaged product end to end

**Files:**

- Modify: scripts/verify-package.mjs
- Modify: scripts/smoke-packaged.ps1
- Create: scripts/fixtures/license-server.mjs
- Create: scripts/fixtures/smoke-license-keypair.mjs
- Modify: package.json
- Modify: .github/workflows/release.yml
- Create: test/package-verification.test.ts
- Create: test/smoke-contract.test.ts

- [ ] Add a failing test proving package verification reads fuse values from the generated Electron executable rather than trusting YAML.
- [ ] Add failing smoke-contract tests requiring activation, sidecar PID, framed handshake, chat response, audio event, controlled PowerShell result, expiry/revocation lock and descendant cleanup.
- [ ] Add a failing test proving smoke fixture keys and private material are absent from a normal commercial package.
- [ ] Run focused tests and confirm red:
      npx.cmd --yes node@24 scripts/run-tests.mjs package-verification
      npx.cmd --yes node@24 scripts/run-tests.mjs smoke-contract
- [ ] Use @electron/fuses APIs to read the packaged executable and assert exact required fuse values.
- [ ] Add a smoke-only build flavor gated at build time. Generate an ephemeral keypair in CI and start a loopback-only fixture license service.
- [ ] Drive the packaged app through its public surface: activate signed test lease, wait for sidecar, send chat, observe audio event, execute a harmless PowerShell nonce and record evidence.
- [ ] Assert no listener on port 8765, Python is not resolved from PATH, then revoke/expire the lease and verify sidecar plus descendants exit.
- [ ] Destroy ephemeral private material, rebuild the commercial artifact without the smoke flag, and scan it for fixture endpoints, keys and bypass markers.
- [ ] Run local unsigned directory smoke, labeling signature checks as release-only:
      npm.cmd run package:dir
      npm.cmd run verify:package
      npm.cmd run smoke:packaged
- [ ] Commit:
      git add scripts/verify-package.mjs scripts/smoke-packaged.ps1 scripts/fixtures/license-server.mjs scripts/fixtures/smoke-license-keypair.mjs package.json .github/workflows/release.yml test/package-verification.test.ts test/smoke-contract.test.ts
      git commit -m "test: exercise packaged commercial runtime end to end"

### Task 10: Run the release gate and replace stale completion claims with evidence

**Files:**

- Modify: docs/superpowers/plans/2026-10-22-01-license-gated-runtime.md
- Modify: docs/superpowers/plans/2026-10-22-02-private-sidecar-protocol.md
- Modify: docs/superpowers/plans/2026-10-22-03-renderer-ipc-memory-cleanup.md
- Modify: docs/superpowers/plans/2026-10-22-04-commercial-packaging-release.md
- Modify: docs/superpowers/plans/2026-10-22-jarvis-commercial-remediation-runbook.md
- Modify: docs/superpowers/plans/2026-10-23-commercial-audit-remediation.md

- [ ] At implementation start, mark the commercial runbook REABERTA, list unresolved blockers and remove unsupported “100%” and “no failures” claims.
- [ ] Reconcile old unchecked tasks with the new implementation instead of silently marking them done.
- [ ] Run the complete Node 24 and Python matrix from a clean checkout:
      npm.cmd ci
      npm.cmd run verify
      python -m unittest discover -s jasper-backend/tests -v
      pwsh -NoProfile -File scripts/python-audit.ps1
      npm.cmd audit --audit-level=high
      npm.cmd run build:python
      npm.cmd run test:package
      npm.cmd run package:dir
      npm.cmd run verify:package
      npm.cmd run smoke:packaged
- [ ] Trigger the protected release workflow and require green source tests, artifact tests, CodeQL, audits, package verification and packaged smoke.
- [ ] Verify Authenticode on installer and every shipped executable, then test a signed update from the approved feed on a clean Windows VM.
- [ ] Confirm the VM has no Python available to the application and repeat activation, chat, audio, PowerShell nonce, refresh simulation, expiry and revocation.
- [ ] Record commit SHA, workflow URL, artifact SHA-256, certificate subject/thumbprint, timestamps, exit codes, smoke evidence and residual risk in the runbook.
- [ ] Mark this plan and runbook complete only when every checkbox has evidence. If a release-only check cannot run, leave the plan open and name its owner.
- [ ] Commit:
      git add docs/superpowers/plans/2026-10-22-01-license-gated-runtime.md docs/superpowers/plans/2026-10-22-02-private-sidecar-protocol.md docs/superpowers/plans/2026-10-22-03-renderer-ipc-memory-cleanup.md docs/superpowers/plans/2026-10-22-04-commercial-packaging-release.md docs/superpowers/plans/2026-10-22-jarvis-commercial-remediation-runbook.md docs/superpowers/plans/2026-10-23-commercial-audit-remediation.md
      git commit -m "docs: record commercial release evidence"

## Definition of Done

- [ ] Licença válida desbloqueia uma vez; licença ausente, inválida, revogada, expirada ou com rollback mantém todo o produto bloqueado.
- [ ] Expiração/revogação encerra sidecar e descendentes sem aguardar o ciclo de 72 horas.
- [ ] Nenhum segredo de provedor é herdado por sidecar ou comandos.
- [ ] Frames inválidos encerram a sessão; três reinícios usam 250 ms, 1 s e 4 s deterministicamente.
- [ ] Interface e configuração anunciam somente funcionalidades implementadas e testadas.
- [ ] Atualizações e binários são aceitos apenas com publisher exato e Authenticode válido.
- [ ] npm test passa em checkout limpo; testes de artefato falham fechados se o artefato não existe.
- [ ] Auditoria Python executa pip-audit real e CodeQL cobre TypeScript/JavaScript e Python.
- [ ] Smoke empacotado comprova ativação, sidecar, chat, áudio, PowerShell, bloqueio e encerramento da árvore.
- [ ] O runbook contém evidência verificável e nunca apresenta conclusão com gates pendentes.

