# RELATÓRIO 8 — Plano de Correções Priorizado

Este roteiro organiza todas as ações corretivas recomendadas pela auditoria em ordem de severidade técnica e dependência de execução.

---

## P0 — Bloqueadores Imediatos (Impedem o uso ou expõem vulnerabilidades críticas)

### 1. [BUG-01] Restauração do Modelo Gemini Live e Validação do Handshake
- **Arquivos:** `src/main/config/config-store.ts`, `src/main/gemini-live.ts`, `src/renderer/index.html`
- **Ação:** Reverter `DEFAULT_LIVE_MODEL` para modelo oficial ativo (ex.: `gemini-2.0-flash-live-001` ou `gemini-2.5-flash-native-audio-preview-12-2025`); remover de `RETIRED_LIVE_MODELS`; em `GeminiLiveClient.connect()`, só resolver a Promise após receber `setupComplete`.
- **Dependências:** Nenhuma. Deve ser a primeira ação para restabelecer a conexão de IA.

### 2. [SEC-01] Blindagem do Licenciamento e Proteção de Segredos
- **Arquivos:** `src/main/services/license-manager.ts`, `src/main/config/config-store.ts`, `src/main/index.ts`
- **Ação:** Embutir a chave pública Ed25519 de produção diretamente no binário; ignorar `process.env.JASPER_API_URL` quando `app.isPackaged === true`; criptografar lease tokens via DPAPI (`safeStorage`); chamar `autonomyCoordinator.stopAll()` dentro de `licenseManager.onRevoked`.
- **Dependências:** Nenhuma.

### 3. [SEC-02] Correção de Segurança em `ProcessManagerService.launchProgram`
- **Arquivos:** `src/main/autonomous/process-manager.ts`, `src/main/autonomous/scripts/search-programs.ps1`
- **Ação:** Resolver o caminho completo do binário antes de chamar `securityBroker.confirmOperation` e exibir o caminho completo na caixa de diálogo; restringir `explorer.exe` apenas a arquivos `.lnk` do Menu Iniciar; expandir lista de executáveis e scripts bloqueados.
- **Dependências:** Nenhuma.

### 4. [SEC-03] Blindagem da Automação de UI e Correção de Regex UTF-8
- **Arquivos:** `src/main/autonomous/ui-automation.ts`, `src/main/autonomous/scripts/ui-automation.ps1`
- **Ação:** Corrigir os caracteres acentuados no regex UTF-8 de `SENSITIVE_WINDOW_PATTERN`; validar no PowerShell o título completo e o processo (`ProcessName` / `ProcessId`) da janela alvo; proibir automação contra o PID do próprio Jasper.
- **Dependências:** Nenhuma.

### 5. [SEC-04] Contenção de Repositórios e Confirmação de Testes em `GitWatcher`
- **Arquivos:** `src/main/autonomous/git-watcher.ts`, `src/main/tools/autonomous-tools.ts`, `src/main/autonomous/subagent-orchestrator.ts`
- **Ação:** Validar que `repoPath` pertença à lista de repositórios autorizados pelo usuário; exigir confirmação de segurança com risco crítico antes de executar `gitWatcher.runTests()`; incluir `--no-verify` nos commits automáticos.
- **Dependências:** Nenhuma.

---

## P1 — Alta Prioridade (Bugs funcionais severos, SSRF e vazamento de recursos)

### 6. [BUG-02] Eliminação da Condição de Corrida no WebSocket
- **Arquivos:** `src/main/gemini-live.ts`
- **Ação:** Desregistrar todos os listeners antigos ao desconectar e comparar a referência local da instância do socket (`this.ws === socket`) em todos os callbacks para ignorar eventos de fechamento de conexões obsoletas.
- **Dependências:** Deve ser feito logo após a correção de [BUG-01].

### 7. [BUG-03] Integração de `PresentationMode` e `FocusMode` ao `AutonomyCoordinator`
- **Arquivos:** `src/main/autonomous/coordinator.ts`, `src/main/autonomous/presentation-mode.ts`, `src/main/autonomous/focus-mode.ts`
- **Ação:** Inicializar ambos no `coordinator.init()`; registrar o callback `setOnNotification` do modo foco; suprimir notificações e áudio do assistente quando `presentationMode.getStatus().isSilentAudio` estiver verdadeiro.
- **Dependências:** Nenhuma.

### 8. [BUG-04] Resolução Correta do Diretório de Relatórios e QR Codes
- **Arquivos:** `src/main/autonomous/report-generator.ts`, `src/main/autonomous/qr-service.ts`
- **Ação:** Resolver `cfg.folderDefaultTarget` através de `securityBroker.resolveUserPath(cfg.folderDefaultTarget)` para mapear `'downloads'` para a pasta real `Downloads` do usuário; atualizar os testes automatizados para usarem um diretório temporário isolado.
- **Dependências:** Nenhuma.

### 9. [SEC-05] Endurecimento do Navegador Headless contra SSRF e WebSockets
- **Arquivos:** `src/main/autonomous/headless-browser.ts`, `src/main/autonomous/webhook-manager.ts`
- **Ação:** Corrigir a validação de endereços IPv6-mapped IPv4 hexadecimais em `isPrivateOrLoopbackIP`; incluir interceptação de URLs `ws://*/*` e `wss://*/*` no `onBeforeRequest`; utilizar partição de sessão isolada.
- **Dependências:** Nenhuma.

### 10. [BUG-07] & [BUG-08] Estabilização do VAD no Microfone e Fim de Turno de Áudio
- **Arquivos:** `src/renderer/audio/mic-recorder.ts`, `src/renderer/audio/audio-player.ts`, `src/renderer/main.ts`
- **Ação:** Resetar a flag `hasSpoken` em cada turno para restaurar o timeout de inatividade de 30s; aguardar o evento `turnComplete` do Gemini Live antes de processar palavras de despedida ou reativar a Wake Word.
- **Dependências:** Nenhuma.

### 11. [PERF-01] & [PERF-02] Reutilização de `AudioContext` e Otimização do Rastreador de Janelas
- **Arquivos:** `src/renderer/audio/audio-cues.ts`, `src/main/autonomous/window-tracker.ts`, `src/main/autonomous/system-health.ts`
- **Ação:** Reutilizar instância única de `AudioContext` em `audio-cues.ts`; migrar o `get-active-window.ps1` para um processo persistente ou aumentar o intervalo para 15-30s compartilhando o estado com o modo foco; diminuir a frequência de checagem de espaço em disco no `SystemHealth`.
- **Dependências:** Nenhuma.

---

## P2 — Média Prioridade (Bugs secundários, empacotamento e testes)

### 12. Blindagem Secundária de Segurança ([SEC-06] a [SEC-10])
- **Arquivos:** `report-generator.ts`, `system-tools.ts`, `qr-service.ts`, `ocr-service.ts`, `file-summarizer.ts`, `src/main/index.ts`, `main-window.ts`
- **Ações:**
  - Adicionar meta CSP restritiva ao HTML de geração de PDF.
  - Aplicar `ReflexionEngine` e verificação de toggles ativos em `executeSystemTool`.
  - Aplicar `securityBroker.resolveUserPath` em `readQrCode`.
  - Aplicar `redactSecrets` em e-mails lidos, documentos e textos extraídos via OCR.
  - Adicionar `path.isAbsolute(relativePath)` na verificação do protocolo `app://`.
  - Condicionar `--capture-screenshot` a `!app.isPackaged`.

### 13. Correções Funcionais Secundárias ([BUG-05], [BUG-06], [BUG-09], [BUG-10], [BUG-11])
- **Arquivos:** `calendar-email.ts`, `policy-engine.ts`, `offline-handler.ts`, `memory.ts`, `subagent-orchestrator.ts`, `settings-modal.ts`, `license-modal.ts`
- **Ações:**
  - Corrigir parser IMAP e decodificação MIME RFC 2047.
  - Corrigir execução do npm no Windows para testes e remover falso positivo de `-f` no commit.
  - Reutilizar `math-evaluator.ts` no `OfflineHandler` (eliminando o `Function()`).
  - Preservar nome e preferências do usuário em `memory.ts` após 30 dias.
  - Alimentar a memória semântica vetorial dentro de `remember_fact`.
  - Corrigir seletores DOM e duplicação do atalho `F12`.

### 14. Otimização de Empacotamento e CI/CD ([DIST-01], [DIST-02])
- **Arquivos:** `package.json`, `electron-builder.yml`, `electron.vite.config.ts`, `.github/workflows/ci.yml`
- **Ações:**
  - Mover dependências exclusivas do Renderer (`three`, `@tensorflow/*`) para `devDependencies`.
  - Empacotar modelos de idioma do Tesseract em `extraResources`.
  - Criar workflow `.github/workflows/release.yml` para publicação no repositório de releases.
  - Habilitar `bytecodePlugin` no `electron-vite` para proteger o código do Main/Preload.

---

## P3 — Melhorias Opcionais (Refinamento visual e otimizações 3D)

### 15. [PERF-03] Suavização e Gestão de Recursos Three.js
- **Arquivos:** `src/renderer/main.ts`, `src/renderer/scene/neural-background.ts`, `src/renderer/scene/avatar.ts`
- **Ação:** Aplicar `clock.getDelta()` nas animações para manter a taxa de física independente da frequência do monitor; pausar a renderização quando o app estiver oculto no tray; invocar `.dispose()` em geometrias e materiais Three.js ao alternar de avatar.

