# Jasper Settings and Provider Credentials Design

**Date:** 2026-10-23  
**Status:** Approved
**Scope:** Settings dashboard, provider-specific credentials, configuration migration, and runtime synchronization

## 1. Objective

Align the settings dashboard with the features that Jasper actually implements. The commercial application remains license-gated and uses a bring-your-own-key model: each customer supplies separate credentials for Google Gemini and Groq, while Ollama runs locally without a key.

The result must:

- present Jasper, not Gemini, as the product identity;
- expose only implemented settings and capabilities;
- store provider credentials separately and encrypted with Electron `safeStorage`;
- prevent complete credentials from reaching the renderer, logs, or public IPC responses;
- select only models supported by the active provider;
- preserve existing installations through an automatic legacy `apiKey` migration;
- retain Jasper's full Windows control after the one-time operational consent;
- retain the existing lifetime license and signed 72-hour lease validation.

## 2. Non-goals

This change does not add OpenAI, Anthropic, custom provider profiles, multiple credentials for one provider, a custom Ollama endpoint, fictitious tool switches, or per-command confirmation prompts. It also does not change the licensing protocol or release/signing pipeline.

## 3. Supported provider catalog

The application will define one allow-listed catalog shared by configuration validation and the renderer:

| Provider | Credential | Initial models |
| --- | --- | --- |
| `gemini` | Customer Google Gemini key | `gemini/gemini-2.5-flash` |
| `groq` | Customer Groq key | `groq/llama-3.3-70b-versatile` |
| `ollama` | None; local service | `ollama/qwen2.5:3b` |

The catalog is the source of truth for provider labels, whether a key is required, model membership, and the default model for each provider. Arbitrary provider or model strings from the renderer are rejected before persistence.

## 4. Configuration model

### 4.1 Public settings

The current `apiKey` setting is replaced with:

- `aiProvider: 'gemini' | 'groq' | 'ollama'`
- `geminiApiKey: string`
- `groqApiKey: string`
- the existing `model`, `voiceName`, `agentName`, update and feature flags

`geminiApiKey` and `groqApiKey` are write-only from the renderer's perspective. An empty submitted value means “leave the stored key unchanged”; credential removal uses a dedicated IPC operation so an omitted value cannot accidentally erase a key.

### 4.2 Renderer summary

`getConfig` returns no full credential. It exposes, for each remote provider:

- whether a key is configured;
- a short masked representation;
- the selected provider and model;
- the existing non-secret settings and connection state.

Masking is performed in the main process. The renderer must never derive a mask from a full key.

### 4.3 Secret persistence

Both provider keys are included in the main process secret-key allow-list and encrypted independently with `safeStorage`. Persistence remains atomic. If encryption is unavailable or an existing secret cannot be decrypted safely, the update fails closed and the prior configuration remains intact.

Environment defaults remain supported in development:

- `GOOGLE_API_KEY` or `GEMINI_API_KEY` seeds `geminiApiKey`;
- `GROQ_API_KEY` seeds `groqApiKey`;
- `JASPER_MODEL` may determine the initial provider when it names an allow-listed model.

Packaged customer credentials always use encrypted persisted storage.

## 5. Legacy migration

On the first successful load of a configuration containing legacy `apiKey`:

1. Decrypt it using the existing fail-closed path.
2. Determine its destination:
   - a `gsk_` prefix or a selected `groq/` model maps the key to `groqApiKey`;
   - every other non-empty key maps to `geminiApiKey`, including when Ollama is selected, so migration never discards a potentially usable remote credential.
3. Infer `aiProvider` from the selected model, falling back to `gemini`.
4. Normalize the model to an allow-listed model for that provider.
5. Atomically persist the new fields and omit `apiKey`.

Migration must never rewrite the file when a legacy encrypted value cannot be decrypted. Repeated startup after a completed migration is idempotent.

## 6. Main-process and sidecar data flow

When settings are saved, the main process validates the payload, encrypts any newly supplied credentials, persists the full configuration, and derives an active runtime configuration.

Only the active provider credential is placed in the private framed `config` message to the Python sidecar:

- `provider`
- allow-listed `model`
- `apiKey` for Gemini or Groq, or an empty value for Ollama
- `agent_name`
- `voice`
- `vision`

The inactive provider credential never crosses into the renderer or sidecar. Provider, model, and key are treated as one validated combination. A remote provider without a configured key is rejected before the agent attempts a turn.

The Python runtime keeps LiteLLM as the model router and Edge-TTS as speech synthesis. It accepts only the three supported provider families. Ollama uses LiteLLM's standard local connection behavior; a custom endpoint is outside this scope.

## 7. Dashboard information architecture

The existing visual language is retained. Duplicate horizontal tabs are removed; the left sidebar becomes the sole primary navigation. The header title, instruction, and status change with the selected section. Static “online” text is replaced by actual agent and license state.

### 7.1 General & Appearance

- Jasper product branding and assistant name.
- Facial-expression preview.
- Bloom, neural background, and eye tracking.
- Full-screen action.
- Visual previews are reversible: Cancel restores the values captured when the dashboard opened.

### 7.2 AI & Voice

- Provider selector for Gemini, Groq, and Ollama.
- Separate credential cards for Gemini and Groq with configured/masked state, replace action, and explicit remove action.
- Ollama card explaining that no key is required and showing local availability when known.
- Model selector filtered by active provider.
- Edge-TTS voice selector.
- Local TensorFlow.js wake-word enablement and training controls.
- Actual connection feedback associated with the active provider.

### 7.3 System & Automation

- Screen-context toggle.
- Read-only list of implemented capabilities: PowerShell, keyboard/mouse GUI automation, system volume, system telemetry, and screen capture.
- Operational-consent state. The consent remains installation-bound and is not converted into repeated per-command prompts.
- Update preference and the existing check, download, and install actions.

### 7.4 Memory

- Persisted facts, count, empty state, and clear-memory action.
- No unsupported semantic-memory or memory-mode controls.

### 7.5 License

- Lifetime-license status, owner, current HWID, activation date, and last successful validation.
- Explicit signed-lease validation interval of 72 hours.
- Activation field and action only when activation or replacement is applicable.
- Locked or revoked state remains fail-closed and stops operational services.

## 8. Save, cancel, and synchronization semantics

The dashboard owns a draft initialized from the configuration summary when opened.

- **Save changes** validates and persists the draft.
- Newly typed credential fields are sent only on save and then cleared from the DOM.
- Non-secret runtime changes are synchronized with the ready sidecar.
- Provider, model, or active credential changes update the active runtime configuration. If the agent is disconnected, Jasper attempts to connect and reports the real outcome.
- Pure visual changes do not trigger a backend reconnect.
- **Cancel** discards the draft, clears typed credentials, restores visual previews, and closes the dashboard.
- Closing via the sidebar close button has the same rollback semantics as Cancel.

Credential removal is a separate destructive action with a confirmation prompt. Removing the active remote provider key disconnects the agent after persistence. Removing an inactive key does not disturb the active session.

## 9. Error handling and customer feedback

Errors are actionable and provider-specific:

- Gemini or Groq without a key: saving the provider selection is allowed, but connection is not attempted; the UI identifies the missing credential.
- Invalid provider/model pair: rejected before persistence.
- Ollama unavailable: settings remain saved and the dashboard reports that the local service did not respond.
- Secret-storage failure: no partial write; the prior configuration remains active.
- Backend synchronization failure: persisted settings remain visible, while connection state reports the failure and offers a retry through Save.
- License lock or revocation: sidecar and operational renderer lifecycle are stopped as they are today.

Error messages and audit logs must pass through existing redaction rules and must not contain credentials, lease tokens, or device secrets.

## 10. Component boundaries

- Shared configuration types define providers, public update payloads, masked summaries, and the allow-listed catalog shape.
- `ConfigStore` owns defaults, validation, encryption, atomic persistence, and legacy migration.
- IPC handlers own authorization, payload limits, credential removal, and runtime synchronization.
- `PythonBackendManager` derives and sends only the active sidecar configuration.
- The Python runtime owns provider routing, remote/local availability errors, Edge-TTS, tools, and memory behavior.
- `SettingsModal` owns draft state and orchestration; small provider and tab helpers may be extracted when doing so makes behavior independently testable.
- HTML and CSS own structure and presentation but do not encode provider validation rules independently of the catalog.

## 11. Security requirements

- No full AI key in config summaries, preload return types, DOM placeholders, logs, errors, telemetry, or tests.
- Renderer input values are cleared after save, cancel, close, or removal.
- Provider and model values are strict allow-list values.
- IPC string length and NUL-byte validation remains enforced.
- Only an unlocked license and accepted installation-bound operational consent allow backend access.
- The design does not add per-command confirmation or weaken existing process, protocol, CSP, or sidecar-integrity boundaries.

## 12. Verification strategy

Automated coverage will include:

- configuration defaults and provider catalog validation;
- encrypted independent Gemini/Groq persistence;
- idempotent legacy-key migration for Gemini, Groq, and Ollama selections;
- migration failure without destructive rewrite;
- masked summaries and absence of full credentials from renderer/preload contracts;
- dedicated credential removal behavior;
- rejection of unsupported providers and mismatched models;
- sidecar payload containing only the active credential;
- renderer provider/model filtering and credential-field clearing;
- save/cancel/close rollback behavior for visual previews;
- no backend reconnect for purely visual changes;
- provider-specific missing-key and Ollama-unavailable states;
- regression coverage for license gating, wake word, memory, updates, and backend startup;
- typecheck, Node tests, Python tests, and production build.

## 13. Acceptance criteria

The work is accepted when a licensed customer can configure Gemini and Groq independently, switch among Gemini, Groq, and local Ollama models without re-entering stored keys, and see only genuine Jasper capabilities and states. Legacy installations migrate without losing a usable key. Secrets remain confined to encrypted main-process storage and only the active key reaches the sidecar in memory. All verification suites pass without modifying or committing unrelated release-workflow work.
