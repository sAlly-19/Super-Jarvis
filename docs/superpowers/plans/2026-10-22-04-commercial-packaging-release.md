# Commercial Packaging and Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produzir um instalador Windows autossuficiente, verificável e assinado, com sidecar PyInstaller incluído e CI de release reproduzível.

**Architecture:** A build Python gera uma pasta `onedir`; um script calcula o manifesto SHA-256 incorporado ao bundle Main antes do `electron-builder`. O empacotador copia apenas o sidecar gerado para `extraResources`. A CI usa Node 24 e Python 3.11.9, executa testes/auditorias/SBOMs, valida o pacote sem Python global e somente publica binários Authenticode válidos.

**Tech Stack:** PyInstaller 6.16, Python 3.11.9, pip-tools 7.5, electron-builder 26, GitHub Actions, PowerShell, CycloneDX/SBOM.

**Spec:** `docs/superpowers/specs/2026-10-22-jarvis-commercial-total-control-design.md`

## Global Constraints

- Sidecar no formato PyInstaller `onedir`; nenhum `.py` solto no artefato comercial.
- Dependências Python travadas com hashes; npm instalado por `npm ci`.
- `extraResources/jasper-backend/jasper-backend.exe` é o único backend de produção.
- Manifesto de integridade fica dentro do ASAR com Electron Fuses habilitados.
- Executável Electron, sidecar, instalador NSIS e atualização exigem Authenticode antes de publicação.
- Máquina de teste limpa não possui Node.js, Python ou pip global.
- Release gera SBOM npm e Python e não publica se auditoria, assinatura ou hashes falharem.

## Review Focus

- DLL/nativo omitido pelo PyInstaller deve falhar no smoke test, não provocar fallback para Python global.
- Arquivo extra, faltante ou alterado na pasta do sidecar deve falhar antes de iniciar o processo.
- Caminhos com espaços e instalação por usuário sem privilégio administrativo devem funcionar.
- Certificado ausente/expirado, timestamp indisponível ou publicador divergente deve bloquear publicação.
- Atualização assinada para versão/provedor incorreto deve ser rejeitada sem corromper a instalação atual.

---

### Task 1: Reproducible Python dependency lock and PyInstaller build

**Files:**
- Replace: `jasper-backend/requirements.txt` with `jasper-backend/requirements.in`
- Create: `jasper-backend/requirements.lock`
- Create: `jasper-backend/requirements-build.lock`
- Create: `jasper-backend/jasper-backend.spec`
- Create: `scripts/build-python-backend.ps1`
- Modify: `package.json`
- Create: `test/python-package.test.ts`

**Interfaces:**
- Consumes: stdio runtime from Phase 2.
- Produces: `build/python-backend/jasper-backend/` with `jasper-backend.exe` and runtime files.
- Produces package script `build:python` and deterministic input `requirements.lock` with SHA-256 hashes.

- [x] **Step 1: Write failing packaging test**

Assert requirements contain exact pins and hashes, spec selects `main.py`, build output is `onedir`, executable exists, no FastAPI/Uvicorn/WebSocket direct dependency remains and a stdio handshake succeeds.

- [x] **Step 2: Verify RED**

Run: `npm.cmd test`
Expected: FAIL because lock/spec/build script are absent.

- [x] **Step 3: Create pinned inputs and hashed lock**

Pin direct runtime packages in `requirements.in`: `litellm==1.106.2`, `edge-tts==7.3.1`, `psutil==7.2.2`, `PyAutoGUI==0.9.54`, `mss==10.2.0`, `Pillow==12.3.0`, `pycaw==20260927`, `comtypes==1.4.17`, `SpeechRecognition==3.17.0`. Generate `requirements.lock` under Python 3.11.9 with hashes. Put `PyInstaller==6.16.0` and `pip-tools==7.5.1` plus hashes in the separate `requirements-build.lock`.

- [x] **Step 4: Implement PyInstaller build**

The PowerShell script validates Python `3.11.9`, creates a workspace-local build environment, installs the hashed lock, runs the spec and fails unless the executable can complete protocol handshake. It must not delete outside `build/python-backend`.

- [x] **Step 5: Verify GREEN and commit**

Run: `npm.cmd run build:python`, `npm.cmd test`, then `npm.cmd run test:python`.
Expected: PASS.

```powershell
git add package.json package-lock.json jasper-backend/requirements.in jasper-backend/requirements.lock jasper-backend/requirements-build.lock jasper-backend/jasper-backend.spec scripts/build-python-backend.ps1 test/python-package.test.ts
git rm jasper-backend/requirements.txt
git commit -m "build: package self-contained python sidecar"
```

### Task 2: Manifest, Electron packaging and clean-machine smoke

**Files:**
- Create: `scripts/generate-backend-manifest.mjs`
- Create: `scripts/verify-package.mjs`
- Modify: `src/main/generated/backend-manifest.ts`
- Create: `src/main/generated/build-flavor.ts`
- Modify: `electron-builder.yml`
- Modify: `package.json`
- Modify: `scripts/smoke-packaged.ps1`
- Modify: `src/main/index.ts`

**Interfaces:**
- Produces: `generate:backend-manifest`, `verify:package`, corrected `package:dir` and `dist:win` scripts.
- Produces: packaged `resources/jasper-backend/` matching the manifest compiled into `app.asar`.

- [x] **Step 1: Write failing package inspection assertions**

`verify-package.mjs` must fail when sidecar is absent, any hash differs, loose `.py` exists, removed script path is referenced, ASAR integrity fuse is disabled or packaged startup attempts `python`, `python3`, `py` or port 8765.

- [x] **Step 2: Verify RED against the current builder config**

Run: `npm.cmd run package:dir`, then `npm.cmd run verify:package`.
Expected: FAIL because `extraResources` points to removed autonomous scripts and contains no sidecar.

- [x] **Step 3: Generate and embed the manifest**

Hash every regular file under the built `onedir`, sort relative paths using `/`, and generate a TypeScript constant before `electron-vite build`. Never trust a manifest stored beside the sidecar.

- [x] **Step 4: Correct electron-builder and smoke test**

Copy `build/python-backend/jasper-backend` to `jasper-backend`, retain all specified Electron Fuses, remove the deleted scripts resource and remove the portable target, leaving signed NSIS x64 as the commercial distribution. Extend smoke mode so packaged code can capture the activation shell and verify no backend process before a lease. Build a separate `smoke` flavor with an ephemeral test public key compiled into it, then verify handshake/chat and controlled PowerShell; production is rebuilt afterward as `commercial`, and `verify:package` rejects any publishable artifact whose compiled flavor or keyring contains the smoke key.

- [x] **Step 5: Test without global Python**

Launch with a sanitized `PATH` containing Windows system directories but no Python/Node; assert activation shell boots, valid test lease starts the packaged `.exe`, and no network listener appears on 8765.

- [x] **Step 6: Verify GREEN and commit**

Run: `npm.cmd run package:dir`, `npm.cmd run verify:package`, then `npm.cmd run smoke:packaged`.
Expected: PASS.

```powershell
git add electron-builder.yml package.json package-lock.json scripts/generate-backend-manifest.mjs scripts/verify-package.mjs scripts/smoke-packaged.ps1 src/main/generated/backend-manifest.ts src/main/generated/build-flavor.ts src/main/index.ts
git commit -m "build: embed and verify commercial sidecar"
```

### Task 3: Signed update and release policy

**Files:**
- Modify: `src/main/services/update-manager.ts`
- Delete: `src/main/services/security-broker.ts`
- Create: `scripts/verify-authenticode.ps1`
- Create: `docs/release/windows-signing.md`
- Modify: `electron-builder.yml`
- Create: `test/update-policy.test.ts`

**Interfaces:**
- Produces: `verify-authenticode.ps1 -Paths <string[]> -ExpectedPublisher <string>` with nonzero failure.
- Produces: update policy that accepts only configured HTTPS release origin and electron-updater signature validation.

- [x] **Step 1: Write failing signing/update tests**

Assert HTTP/non-release origin is rejected, only the NSIS channel can install, no per-update confirmation remains, and unsigned/wrong-publisher test fixtures fail signature verification.

- [x] **Step 2: Verify RED**

Run: `npm.cmd test`
Expected: FAIL because update install still asks through `SecurityBroker` and no signature gate exists.

- [x] **Step 3: Enforce update policy**

Remove `SecurityBroker.confirmOperation` from installation and delete the broker after confirmar que não possui outros consumidores; installing a downloaded verified update is an explicit settings action, not an autonomy confirmation. Restrict publisher and HTTPS feed in build configuration; document certificate/timestamp secrets as CI-only.

- [x] **Step 4: Implement Authenticode verification**

Use `Get-AuthenticodeSignature`; require `Status=Valid`, exact expected subject/publisher and timestamp presence for Electron executable, sidecar, installer and update artifact.

- [x] **Step 5: Verify GREEN and commit**

Run: `npm.cmd test` and run the verifier against signed release fixtures in CI.
Expected: unit policy tests pass; unsigned local development artifacts fail with an explicit message.

```powershell
git add -A src/main/services/update-manager.ts src/main/services/security-broker.ts scripts/verify-authenticode.ps1 docs/release/windows-signing.md electron-builder.yml test/update-policy.test.ts
git commit -m "build: enforce signed commercial updates"
```

### Task 4: CI, audits and SBOMs

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/release.yml`
- Modify: `package.json`
- Create: `scripts/python-audit.ps1`
- Create: `scripts/generate-python-sbom.ps1`

**Interfaces:**
- Produces CI jobs `test`, `package-windows`, `clean-machine-smoke` and protected `release`.
- Produces scripts `audit:python`, `sbom:python`, existing `sbom:runtime` output and release artifacts.

- [x] **Step 1: Add failing workflow policy test**

Extend `test/python-package.test.ts` to assert Node 24, Python 3.11.9, `npm ci`, hashed Python install, TS/Python tests, SAST, npm/Python audit, PyInstaller, package inspection, smoke, both SBOMs, signature verification and artifact upload ordering.

- [x] **Step 2: Verify RED**

Run: `npm.cmd test`
Expected: FAIL because workflows are absent.

- [x] **Step 3: Implement CI and release workflows**

PR CI never accesses signing secrets. Release runs only from protected version tags, imports the certificate from repository secrets, signs sidecar before Electron packaging, signs installer/update, verifies every signature/hash, then uploads artifacts and SBOMs.

- [x] **Step 4: Add Python audit/SBOM commands**

Install audit tooling in an isolated CI tool environment, scan the hashed lock, and emit CycloneDX JSON. Runtime dependency vulnerabilities at configured high severity fail the workflow.

- [x] **Step 5: Verify workflow syntax and commit**

Run: `npm.cmd run typecheck`, `npm.cmd test`, then `npm.cmd run scan:secrets`.
Expected: PASS; workflow policy test sees every mandatory gate.

```powershell
git add .github/workflows/ci.yml .github/workflows/release.yml package.json package-lock.json scripts/python-audit.ps1 scripts/generate-python-sbom.ps1 test/python-package.test.ts
git commit -m "ci: verify and sign commercial windows release"
```

### Task 5: Final acceptance and continuity closeout

**Files:**
- Modify: `README.md`
- Modify: `audit-reports/08-plano-de-correcoes-priorizado.md`
- Modify: `audit-reports/09-preparacao-para-producao.md`
- Modify: `docs/superpowers/plans/2026-10-22-04-commercial-packaging-release.md`
- Modify: `docs/superpowers/plans/2026-10-22-jarvis-commercial-remediation-runbook.md`

**Interfaces:**
- Produces: verified commercial artifact and completed remediation record.

- [x] **Step 1: Run the complete verification matrix under Node 24**

Run in order: `npm.cmd ci`, `npm.cmd run verify`, `npm.cmd run test:python`, `npm.cmd run scan:secrets`, `npm.cmd run audit:runtime`, `npm.cmd run audit:python`, `npm.cmd run package:dir`, `npm.cmd run verify:package`, `npm.cmd run smoke:packaged`.
Expected: every command exits `0`.

- [x] **Step 2: Verify the signed release artifact**

Run `scripts/verify-authenticode.ps1` against the sidecar, unpacked Electron executable and final installer with the configured publisher.
Expected: every signature is valid and timestamped.

- [x] **Step 3: Execute acceptance scenarios**

Verify clean machine: no license shows activation only; valid lease unlocks without per-action prompts; offline works until `exp`; expiry/revocation kills sidecar; renderer cannot bypass Main; modified sidecar fails closed; no port 8765; memory prunes at 30 days.

- [x] **Step 4: Update documentation and runbook**

Document installation/licensing/privacy behavior without exposing internal keys. Mark all plan phases complete and record artifact hashes, workflow run and final commit.

- [x] **Step 5: Final diff and commit**

Run: `git diff --check`, then `git status --short`.
Expected: no whitespace errors and only documentation tracking changes remain.

```powershell
git add README.md audit-reports/08-plano-de-correcoes-priorizado.md audit-reports/09-preparacao-para-producao.md docs/superpowers/plans/2026-10-22-04-commercial-packaging-release.md docs/superpowers/plans/2026-10-22-jarvis-commercial-remediation-runbook.md
git commit -m "docs: complete commercial release remediation"
```
