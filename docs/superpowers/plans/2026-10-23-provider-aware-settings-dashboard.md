# Provider-Aware Settings Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the misleading settings surface and single AI key with a Jasper-branded dashboard that securely supports independent Gemini and Groq credentials plus local Ollama.

**Architecture:** A shared allow-listed provider catalog defines legal provider/model pairs. `ConfigStore` owns separate encrypted credentials and legacy migration; public IPC exposes only masked summaries and dedicated credential removal. The main process derives one active runtime credential for the Python sidecar, while the renderer manages a reversible settings draft and displays only real capabilities and live state.

**Tech Stack:** Electron 44, TypeScript 5.7, Node.js 24 test runner, HTML/CSS, Electron `safeStorage`, Python 3.11, LiteLLM, Edge-TTS, TensorFlow.js

**Spec:** `docs/superpowers/specs/2026-10-23-settings-provider-credentials-design.md`

## Global Constraints

- Work on `main`; do not create a worktree unless the user changes this instruction.
- Preserve and do not include the existing uncommitted Task 7 release/signing files in these commits.
- Support only `gemini`, `groq`, and `ollama` in this release.
- Initial models are exactly `gemini/gemini-2.5-flash`, `groq/llama-3.3-70b-versatile`, and `ollama/qwen2.5:3b`.
- Gemini and Groq credentials are independent, encrypted with Electron `safeStorage`, and never returned in full to the renderer.
- Ollama uses the standard local LiteLLM endpoint behavior and requires no credential.
- Keep the lifetime license, signed 72-hour lease, one-time installation-bound operational consent, and confirmation-free commands unchanged.
- Use TDD for every task and commit only the files listed by that task.
- After every completed task, update `docs/superpowers/progress/2026-10-23-provider-aware-settings-dashboard.md` with commit, tests, and next task.

## File Structure

**Create**

- `src/shared/ai/provider-catalog.ts` — provider/model allow-list and pure lookup/validation helpers.
- `src/renderer/ui/settings-draft.ts` — pure draft, change classification, and provider-form helpers.
- `test/ai-provider-catalog.test.ts` — provider catalog contract.
- `test/provider-runtime-config.test.ts` — active-key isolation and sidecar sync payload contract.
- `test/settings-draft.test.ts` — draft rollback, model filtering, and reconnect classification.
- `test/settings-dashboard.test.ts` — customer-facing markup and no-secret/no-fake-surface assertions.
- `docs/superpowers/progress/2026-10-23-provider-aware-settings-dashboard.md` — resumable execution ledger.

**Modify**

- `src/shared/types/config.ts` — provider types, separate write-only credentials, summaries, and save result.
- `src/shared/index.ts` — export the provider catalog.
- `src/shared/constants/ipc-channels.ts` — dedicated credential-removal channel.
- `src/main/config/config-store.ts` — defaults, validation, encryption, masking, migration, removal, and active runtime derivation.
- `src/main/ipc/register-ipc.ts` — payload limits, missing-key behavior, removal handler, and sync outcome.
- `src/main/services/python-backend.ts` — send only the active provider key.
- `src/preload/index.ts` and `src/preload/index.d.ts` — safe renderer contract.
- `jasper-backend/runtime.py` — explicit provider validation and provider-specific runtime errors.
- `jasper-backend/tests/test_runtime.py` and `jasper-backend/tests/test_protocol.py` — sidecar provider contract.
- `src/renderer/index.html` — single navigation, five truthful sections, provider cards, and provider-aware onboarding.
- `src/renderer/styles/modal.css` — provider cards, dynamic status, responsive dashboard, and removed duplicate-tab layout.
- `src/renderer/ui/dom.ts` — new typed dashboard elements; remove legacy single-key elements.
- `src/renderer/ui/settings-modal.ts` — draft orchestration, credentials, dynamic headers, save/cancel, and live state.
- `src/renderer/ui/license-modal.ts` — provider-aware post-license onboarding.
- `src/renderer/main.ts` — live dashboard status and agent-error forwarding.
- `test/config.test.ts`, `test/agent-ipc.test.ts`, `test/preload-contract.test.ts`, and `test/product-surface.test.ts` — regression coverage.

## Review Focus

- A legacy encrypted key that cannot be decrypted must leave the original file byte-for-byte unchanged; Task 2 tests this.
- A legacy key with Ollama selected must be preserved as a Gemini credential instead of discarded; Task 2 tests this.
- Saving one provider's new key must not clear the other provider's existing key; Tasks 2 and 3 test this.
- Removing an inactive credential must not disconnect or resynchronize the active provider; Task 3 tests this.
- Closing the dashboard through either Cancel or the close button must clear typed secrets and restore visual previews; Task 7 tests this.

---

### Task 1: Provider Catalog and Shared Contracts

**Files:**
- Create: `src/shared/ai/provider-catalog.ts`
- Create: `test/ai-provider-catalog.test.ts`
- Modify: `src/shared/types/config.ts:1-69`
- Modify: `src/shared/index.ts:1-9`
- Modify: `test/product-surface.test.ts:9-17,94-98`
- Modify: `docs/superpowers/progress/2026-10-23-provider-aware-settings-dashboard.md`

**Interfaces:**
- Produces: `AIProvider`, `RemoteAIProvider`, `AIProviderDefinition`, `AI_PROVIDER_CATALOG`, `isAIProvider(value)`, `isSupportedProviderModel(provider, model)`, `defaultModelForProvider(provider)`, and `providerForModel(model)`.
- Produces: `UpdateConfigPayload` with `aiProvider`, `geminiApiKey`, and `groqApiKey`; `ConfigSummary.credentials`; `ConfigSaveResult`.

- [ ] **Step 1: Write the failing provider catalog tests**

Assert the three exact providers/models, remote-key requirements, provider inference, default models, and rejection of unknown or cross-provider models.

```ts
assert.equal(isSupportedProviderModel('gemini', 'gemini/gemini-2.5-flash'), true)
assert.equal(isSupportedProviderModel('gemini', 'groq/llama-3.3-70b-versatile'), false)
assert.equal(providerForModel('ollama/qwen2.5:3b'), 'ollama')
assert.throws(() => defaultModelForProvider('openai' as never), /provedor/i)
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npm test -- ai-provider-catalog`

Expected: FAIL because the catalog module and new types do not exist.

- [ ] **Step 3: Implement the catalog and shared types**

Use readonly data and pure helpers. Replace public `apiKey` with `aiProvider`, `geminiApiKey`, and `groqApiKey`. Define credential summaries as `{ configured: boolean; masked: string }` for Gemini and Groq. Do not expose a full-key property in `ConfigSummary`.

- [ ] **Step 4: Run focused contract tests**

Run: `npm test -- ai-provider-catalog`

Run: `npm test -- product-surface`

Expected: PASS; the exact public configuration allow-list contains the three new fields and no legacy `apiKey`.

- [ ] **Step 5: Update progress and commit**

```powershell
git add src/shared/ai/provider-catalog.ts src/shared/types/config.ts src/shared/index.ts test/ai-provider-catalog.test.ts test/product-surface.test.ts docs/superpowers/progress/2026-10-23-provider-aware-settings-dashboard.md
git commit -m "feat: define supported AI provider catalog"
```

### Task 2: Secure Credential Storage and Legacy Migration

**Files:**
- Modify: `src/main/config/config-store.ts:14-300`
- Modify: `test/config.test.ts`
- Modify: `docs/superpowers/progress/2026-10-23-provider-aware-settings-dashboard.md`

**Interfaces:**
- Consumes: provider catalog and shared config types from Task 1.
- Produces: `ActiveAIConfig { provider: AIProvider; model: string; apiKey: string; ready: boolean; error?: string }`.
- Produces: `resolveActiveAIConfig(config: JasperConfig): ActiveAIConfig` and `ConfigStore.removeProviderCredential(provider: RemoteAIProvider): JasperConfig`.

- [ ] **Step 1: Add failing storage and migration tests**

Cover independent encrypted persistence, masked summaries, active config selection, unsupported provider/model rejection, preservation of the other provider key, and these exact migrations:

```ts
// gsk_ or a groq/ model -> groqApiKey
// every other legacy non-empty key -> geminiApiKey, including an ollama/ model
// undecryptable enc: value -> original file unchanged
```

Assert a second initialization is idempotent and persisted JSON contains no `apiKey` after successful migration.

- [ ] **Step 2: Run configuration tests and confirm RED**

Run: `npm test -- config`

Expected: FAIL on missing provider fields, migration, or `resolveActiveAIConfig`.

- [ ] **Step 3: Implement defaults, validation, encryption, masking, and migration**

Add both new key names to `SECRET_KEYS`; infer `aiProvider` from `JASPER_MODEL`; seed environment credentials separately. Validate provider/model pairs before applying an update. Treat omitted or empty credential update fields as unchanged. Implement removal only through `removeProviderCredential`.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run: `npm test -- config`

Expected: PASS, including byte-for-byte no-rewrite behavior when decryption is unavailable.

- [ ] **Step 5: Update progress and commit**

```powershell
git add src/main/config/config-store.ts test/config.test.ts docs/superpowers/progress/2026-10-23-provider-aware-settings-dashboard.md
git commit -m "feat: store provider credentials independently"
```

### Task 3: Credential-Safe IPC and Preload Boundary

**Files:**
- Modify: `src/shared/constants/ipc-channels.ts:1-68`
- Modify: `src/main/ipc/register-ipc.ts:104-132,241-315`
- Modify: `src/preload/index.ts:1-108`
- Modify: `src/preload/index.d.ts:1-40`
- Modify: `test/agent-ipc.test.ts`
- Modify: `test/preload-contract.test.ts`
- Modify: `docs/superpowers/progress/2026-10-23-provider-aware-settings-dashboard.md`

**Interfaces:**
- Consumes: `RemoteAIProvider`, `UpdateConfigPayload`, `ConfigSaveResult`, and `ConfigStore.removeProviderCredential`.
- Produces: `IPC_CHANNELS.CONFIG_REMOVE_CREDENTIAL` and `electronAPI.removeProviderCredential(provider)`.
- Produces: `saveConfig(config): Promise<ConfigSaveResult>`.

- [ ] **Step 1: Write failing IPC boundary tests**

Assert 512-character limits for both credential fields, allow-list validation for `aiProvider`, rejection of NUL bytes/unknown fields, the new channel's license gate, and a preload surface that contains removal but never returns credential values.

Test handler outcomes for missing active remote key, active removal, and inactive removal. Assert inactive removal does not call backend synchronization.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `npm test -- agent-ipc`

Run: `npm test -- preload-contract`

Expected: FAIL because the removal channel and typed results do not exist.

- [ ] **Step 3: Implement the IPC and preload contracts**

Add strict provider validation and the dedicated removal handler. `CONFIG_SAVE` returns `ConfigSaveResult` distinguishing `synced`, `offline`, and `missing-credential`. Synchronize the backend only when the sparse payload contains `aiProvider`, `model`, `geminiApiKey`, `groqApiKey`, `agentName`, `voiceName`, or `enableScreenAwareness`; visual and update-only payloads persist without a backend call. `AGENT_CONNECT` must refuse a remote provider without its key before health probing.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run: `npm test -- agent-ipc`

Run: `npm test -- preload-contract`

Expected: PASS with no full secret in any returned object.

- [ ] **Step 5: Update progress and commit**

```powershell
git add src/shared/constants/ipc-channels.ts src/main/ipc/register-ipc.ts src/preload/index.ts src/preload/index.d.ts test/agent-ipc.test.ts test/preload-contract.test.ts docs/superpowers/progress/2026-10-23-provider-aware-settings-dashboard.md
git commit -m "feat: add credential-safe provider IPC"
```

### Task 4: Active Provider Sidecar Synchronization

**Files:**
- Create: `test/provider-runtime-config.test.ts`
- Modify: `src/main/services/python-backend.ts:376-390`
- Modify: `docs/superpowers/progress/2026-10-23-provider-aware-settings-dashboard.md`

**Interfaces:**
- Consumes: `resolveActiveAIConfig(config)` from Task 2.
- Produces: private sidecar `config` payload `{ provider, model, apiKey, agent_name, voice, vision }` containing only the active key.

- [ ] **Step 1: Write failing active-key isolation tests**

Capture the payload sent by `PythonBackendManager.syncConfig` and assert Gemini sends only the Gemini key, Groq sends only the Groq key, and Ollama sends an empty key. Assert missing remote credentials return `false` without sending a frame.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npm test -- provider-runtime-config`

Expected: FAIL because `syncConfig` still reads the legacy `cfg.apiKey` and sends no provider.

- [ ] **Step 3: Implement active provider derivation in `syncConfig`**

Call `resolveActiveAIConfig`; refuse `ready === false`; send the exact provider/model/key triple plus existing name, voice, and vision settings. Do not log the payload or key.

- [ ] **Step 4: Run backend-manager regression tests**

Run: `npm test -- provider-runtime-config`

Run: `npm test -- python-backend-manager`

Expected: PASS.

- [ ] **Step 5: Update progress and commit**

```powershell
git add src/main/services/python-backend.ts test/provider-runtime-config.test.ts docs/superpowers/progress/2026-10-23-provider-aware-settings-dashboard.md
git commit -m "feat: isolate active provider runtime key"
```

### Task 5: Python Provider Routing and Actionable Errors

**Files:**
- Modify: `jasper-backend/runtime.py:17-58,128-191,207-443,468-485`
- Modify: `jasper-backend/tests/test_runtime.py`
- Modify: `jasper-backend/tests/test_protocol.py`
- Modify: `docs/superpowers/progress/2026-10-23-provider-aware-settings-dashboard.md`

**Interfaces:**
- Consumes: sidecar config payload from Task 4.
- Produces: runtime config field `provider` and `validate_provider_model(provider, model)`.
- Produces: sanitized provider-specific error messages for missing Gemini/Groq credentials and unavailable Ollama.

- [ ] **Step 1: Write failing Python tests**

Assert config accepts each legal provider/model pair, rejects mismatches, requires a key for Gemini/Groq, requires no key for Ollama, and never includes the submitted key in raised or emitted errors. Mock LiteLLM connection failure for Ollama and assert the customer-facing message identifies the unavailable local service.

- [ ] **Step 2: Run Python tests and confirm RED**

Run: `npm run test:python`

Expected: FAIL because provider validation and sanitized availability errors do not exist.

- [ ] **Step 3: Implement explicit provider routing**

Store `provider` separately, validate against the exact model prefixes, use `api_base=http://127.0.0.1:11434` only for Ollama, and translate provider failures without including credential or raw secret-bearing exception text.

- [ ] **Step 4: Run Python and framing regression tests**

Run: `npm run test:python`

Run: `npm test -- backend-framing`

Expected: PASS.

- [ ] **Step 5: Update progress and commit**

```powershell
git add jasper-backend/runtime.py jasper-backend/tests/test_runtime.py jasper-backend/tests/test_protocol.py docs/superpowers/progress/2026-10-23-provider-aware-settings-dashboard.md
git commit -m "feat: route supported AI providers in sidecar"
```

### Task 6: Truthful Dashboard Structure and Styling

**Files:**
- Create: `test/settings-dashboard.test.ts`
- Modify: `src/renderer/index.html:112-778,858-981`
- Modify: `src/renderer/styles/modal.css:36-1370`
- Modify: `src/renderer/ui/dom.ts:35-108`
- Modify: `test/product-surface.test.ts`
- Modify: `docs/superpowers/progress/2026-10-23-provider-aware-settings-dashboard.md`

**Interfaces:**
- Consumes: provider IDs and input names from Tasks 1 and 3.
- Produces: sole sidebar navigation for `general`, `ai-voice`, `system`, `memory`, and `license`.
- Produces: exact controller IDs `settings-section-title`, `settings-section-description`, `select-ai-provider`, `input-gemini-key`, `input-groq-key`, `gemini-credential-status`, `groq-credential-status`, `ollama-provider-status`, `select-model`, `settings-connection-status`, and `operational-consent-status`.
- Produces: onboarding IDs `select-onboarding-provider`, `input-onboarding-provider-key`, `onboarding-provider-key-group`, and `onboarding-provider-feedback`.

- [ ] **Step 1: Write failing customer-surface tests**

Assert one navigation control per section, Jasper product branding, provider cards and separate password inputs, filtered model control, real capability labels, 72-hour license copy, and provider-aware onboarding. Assert the duplicate horizontal tabs, product title `GEMINI`, `gemini-key-masked-display`, legacy `input-api-key`, and unsupported feature controls are absent.

- [ ] **Step 2: Run the dashboard tests and confirm RED**

Run: `npm test -- settings-dashboard`

Expected: FAIL against the current duplicate navigation and single Gemini key form.

- [ ] **Step 3: Replace markup and targeted modal styles**

Keep the existing monochrome HUD language. Use semantic buttons, labels, password inputs with autocomplete disabled, status elements with `aria-live`, and responsive cards. Remove inline styles from the rewritten settings area when an equivalent class is introduced. Do not alter the license activation key format.

- [ ] **Step 4: Run surface tests and typecheck**

Run: `npm test -- settings-dashboard`

Run: `npm test -- product-surface`

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Update progress and commit**

```powershell
git add src/renderer/index.html src/renderer/styles/modal.css src/renderer/ui/dom.ts test/settings-dashboard.test.ts test/product-surface.test.ts docs/superpowers/progress/2026-10-23-provider-aware-settings-dashboard.md
git commit -m "feat: align settings dashboard with Jasper capabilities"
```

### Task 7: Renderer Draft, Provider UX, and Onboarding

**Files:**
- Create: `src/renderer/ui/settings-draft.ts`
- Create: `test/settings-draft.test.ts`
- Modify: `src/renderer/ui/settings-modal.ts:1-255`
- Modify: `src/renderer/ui/license-modal.ts:1-255`
- Modify: `src/renderer/main.ts:30-64,153-207,442-499`
- Modify: `src/preload/index.ts:25-95`
- Modify: `src/preload/index.d.ts:15-34`
- Modify: `test/preload-contract.test.ts`
- Modify: `docs/superpowers/progress/2026-10-23-provider-aware-settings-dashboard.md`

**Interfaces:**
- Consumes: `ConfigSummary`, provider catalog, `ConfigSaveResult`, `removeProviderCredential`, and Task 6 DOM IDs.
- Produces: `SettingsDraft`, `createSettingsDraft(summary)`, `modelsForProvider(provider)`, `classifySettingsChanges(before, after)`, and `buildSettingsUpdate(draft, typedCredentials)`.
- Produces: `electronAPI.onAgentError(callback: (error: { message: string }) => void): () => void`.

- [ ] **Step 1: Write failing pure draft and source-contract tests**

Assert provider switches select a legal default model, blank credential inputs mean unchanged, typed credentials appear only in the update payload, and `buildSettingsUpdate` emits only changed fields. Visual-only changes return `requiresBackendSync: false`; provider/model/key changes return `true`; rollback restores the opening snapshot. Source assertions must verify both close paths clear credential inputs and call the same rollback routine.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `npm test -- settings-draft`

Run: `npm test -- settings-dashboard`

Expected: FAIL because the draft helper and provider-aware controller do not exist.

- [ ] **Step 3: Implement settings orchestration**

Populate masked status without full keys, update model options from the catalog, keep credentials transient, share `rollbackAndClose()` between Cancel and close, skip backend synchronization for visual-only updates, and display `synced`, `offline`, or `missing-credential` results. Removing the active key disconnects the UI state; inactive removal leaves it unchanged.

- [ ] **Step 4: Update post-license onboarding and live status**

Let the customer choose Gemini, Groq, or Ollama after activation. Gemini/Groq require their own transient credential; Ollama proceeds without a key. Forward sanitized agent errors into dashboard status, and keep product branding as Jasper while naming providers only in provider-specific copy.

- [ ] **Step 5: Run renderer and contract regression tests**

Run: `npm test -- settings-draft`

Run: `npm test -- settings-dashboard`

Run: `npm test -- preload-contract`

Run: `npm test -- renderer-license-shell`

Expected: PASS.

- [ ] **Step 6: Update progress and commit**

```powershell
git add src/renderer/ui/settings-draft.ts src/renderer/ui/settings-modal.ts src/renderer/ui/license-modal.ts src/renderer/main.ts src/preload/index.ts src/preload/index.d.ts test/settings-draft.test.ts test/settings-dashboard.test.ts test/preload-contract.test.ts docs/superpowers/progress/2026-10-23-provider-aware-settings-dashboard.md
git commit -m "feat: add provider-aware settings workflow"
```

### Task 8: Full Verification and Handoff

**Files:**
- Modify: `README.md:17-33`
- Modify: `docs/superpowers/progress/2026-10-23-provider-aware-settings-dashboard.md`
- Test: all TypeScript and Python suites

**Interfaces:**
- Consumes: completed Tasks 1-7.
- Produces: verified release-ready settings feature and final resumable ledger.

- [ ] **Step 1: Run secret and legacy surface scans**

Run: `npm run scan:secrets`

Run: `Get-ChildItem src,test -Recurse -File | Select-String -Pattern 'hasFullKey|input-api-key|gemini-key-masked-display|saveConfig\(\{ apiKey'`

Expected: secret scan passes; legacy tokens occur only in explicit migration tests or compatibility comments that justify them.

- [ ] **Step 2: Run all verification suites**

Run: `npm run typecheck`

Run: `npm test`

Run: `npm run test:python`

Run: `npm run build`

Expected: every command exits 0.

- [ ] **Step 3: Perform a packaged-boundary review**

Inspect the production bundle sources and confirm the renderer receives only masked summaries, the sidecar config contains one active credential, the locked IPC allow-list is unchanged except for no operational additions, and unrelated Task 7 release/signing changes remain uncommitted by this feature.

- [ ] **Step 4: Update documentation and final progress ledger**

Record all commands and results, known environmental warnings, final commit hashes, and any manual UI check still required. Add a concise README section documenting separate Gemini/Groq credentials, keyless local Ollama, and encrypted local storage.

- [ ] **Step 5: Commit verification documentation**

```powershell
git add README.md docs/superpowers/progress/2026-10-23-provider-aware-settings-dashboard.md
git commit -m "docs: document provider-aware settings verification"
```

