# RELATÓRIO 5 — Qualidade, Performance e Bugs

Este relatório detalha todos os bugs funcionais, falhas de confiabilidade na comunicação com a API Gemini Live e áudio, e problemas de performance/recursos encontrados na aplicação, documentados no esquema de 14 campos.

---

### [BUG-01] Modelo Padrão Definido como `gemini-3.8-live` (Inexistente) e Resolução Prematura do Handshake Antes de `setupComplete`
- **ID:** `BUG-01`
- **Título:** Modelo Padrão Definido como `gemini-3.8-live` (Inexistente) e Resolução Prematura do Handshake Antes de `setupComplete`
- **Severidade:** `CRÍTICA`
- **Confiança:** `Alta`
- **Categoria:** `Bug funcional`
- **Arquivo e intervalo de linhas:**
  - [`src/main/config/config-store.ts#L8-L14`](../src/main/config/config-store.ts#L8-L14), [`#L75`](../src/main/config/config-store.ts#L75), [`#L132`](../src/main/config/config-store.ts#L132)
  - [`src/main/gemini-live.ts#L44`](../src/main/gemini-live.ts#L44), [`#L124-L190`](../src/main/gemini-live.ts#L124-L190), [`#L238-L249`](../src/main/gemini-live.ts#L238-L249)
  - [`src/renderer/index.html#L281-L286`](../src/renderer/index.html#L281-L286)
- **Descrição técnica:**
  1. **Modelo padrão inexistente na API:** `DEFAULT_LIVE_MODEL` em `config-store.ts#L8` e `gemini-live.ts#L44` foi configurado como `'gemini-3.8-live'`, e `'gemini-2.0-flash-live-001'` foi adicionado a `RETIRED_LIVE_MODELS` (`#L9-L14`). A função `normalizeGeminiModel()` força qualquer configuração anterior para `gemini-3.8-live`. Como a API Google Gemini Live (`BidiGenerateContent`) não reconhece esse modelo, o servidor fecha a conexão WebSocket imediatamente.
  2. **Resolução prematura em `GeminiLiveClient.connect()`:** A Promise de `connect()` chama `resolve()` no evento `ws.on('open')` logo após enviar `this.ws?.send(JSON.stringify(setupMessage))`, sem aguardar a confirmação `message.setupComplete` (`#L245`). Dessa forma, a interface exibe que a conexão foi estabelecida com sucesso mesmo quando o handshake é rejeitado milissegundos depois.
- **Evidência concreta:**
  - `src/main/config/config-store.ts#L8-L14`: `export const DEFAULT_LIVE_MODEL = 'gemini-3.8-live';`
  - `src/main/gemini-live.ts#L186-L189`: `this.ws?.send(JSON.stringify(setupMessage)); clearTimeout(timeout); resolve();`
- **Condições necessárias:** Iniciar o aplicativo ou tentar conectar ao Gemini Live.
- **Impacto potencial:** Bloqueio completo do recurso principal do assistente sob configurações padrão e falso feedback de sucesso na interface.
- **Forma segura de verificar:** Inspeção estática de `config-store.ts#L8-L14` e `gemini-live.ts#L186-L189`.
- **Recomendação de correção:** Restaurar modelo válido (`gemini-2.0-flash-live-001` ou `gemini-2.5-flash-native-audio-preview-12-2025`) e resolver a Promise de `connect()` somente quando `message.setupComplete` for recebido.
- **Estimativa de esforço:** Baixo (1 a 2 horas).
- **Possíveis efeitos colaterais:** Mocks de teste de WebSocket precisarão emitir `{ setupComplete: {} }`.

---

### [BUG-02] Condição de Corrida na Reconexão WebSocket do `GeminiLiveClient`
- **ID:** `BUG-02`
- **Título:** Condição de Corrida na Reconexão WebSocket do `GeminiLiveClient`
- **Severidade:** `ALTA`
- **Confiança:** `Confirmada`
- **Categoria:** `Confiabilidade`
- **Arquivo e intervalo de linhas:**
  - [`src/main/gemini-live.ts#L105-L108`](../src/main/gemini-live.ts#L105-L108), [`#L203-L229`](../src/main/gemini-live.ts#L203-L229), [`#L423-L442`](../src/main/gemini-live.ts#L423-L442)
- **Descrição técnica:**
  Ao chamar `connect()` enquanto já existe um socket ativo, o método invoca `this.disconnect()` e redefine imediatamente `this.intentionalDisconnect = false`. Como `disconnect()` chama `this.ws.close()` sem desregistrar os ouvintes do socket antigo, o evento assíncrono `ws.on('close')` da conexão anterior dispara momentos depois: ele sobrescreve `this.ws = null`, marca `this.isConnected = false` e agenda um timer de reconexão indevido contra a conexão recém-criada.
- **Evidência concreta:**
  - `src/main/gemini-live.ts#L207-L208`: `this.isConnected = false; this.ws = null;` executado pelo listener do socket antigo sobrescrevendo a nova instância atribuída em `#L108`.
- **Condições necessárias:** Salvar configurações de voz/personalidade com o Gemini conectado.
- **Impacto potencial:** Perda da referência do socket ativo, desconexão imediata e loops espúrios de reconexão.
- **Forma segura de verificar:** Inspeção estática das linhas citadas em `gemini-live.ts`.
- **Recomendação de correção:** Capturar a instância do socket localmente e ignorar eventos de fechamento se `this.ws !== socket`, além de invocar `oldWs.removeAllListeners()` no `disconnect()`.
- **Estimativa de esforço:** Baixo (1 hora).
- **Possíveis efeitos colaterais:** Nenhum.

---

### [BUG-03] `PresentationModeService` e `FocusModeService` Estão Completamente Desconectados do `AutonomyCoordinator`, do Áudio e das Notificações
- **ID:** `BUG-03`
- **Título:** `PresentationModeService` e `FocusModeService` Estão Completamente Desconectados do `AutonomyCoordinator`, do Áudio e das Notificações
- **Severidade:** `ALTA`
- **Confiança:** `Confirmada`
- **Categoria:** `Bug funcional`
- **Arquivo e intervalo de linhas:**
  - [`src/main/autonomous/coordinator.ts#L1-L163`](../src/main/autonomous/coordinator.ts#L1-L163)
  - [`src/main/autonomous/presentation-mode.ts#L31-L137`](../src/main/autonomous/presentation-mode.ts#L31-L137)
  - [`src/main/autonomous/focus-mode.ts#L24-L150`](../src/main/autonomous/focus-mode.ts#L24-L150)
  - [`src/main/tools/system-tools.ts#L316-L347`](../src/main/tools/system-tools.ts#L316-L347)
- **Descrição técnica:**
  1. **Modo Apresentação:** Nunca é inicializado (`setEnabled` nunca é chamado), seu timer de detecção de apps de videoconferência (`Zoom`, `Teams`, `OBS`) nunca roda, e o estado `isSilentAudio` nunca é consultado pelo `coordinator.dispatchNotification()` nem pelos módulos de áudio. A ferramenta `set_presentation_mode` afirma ter silenciado o sistema, mas isso é falso.
  2. **Modo Foco:** O callback `setOnNotification` nunca é registrado pelo coordenador. Conclusões de ciclos Pomodoro e alertas de distração são silenciados no vazio (`this.onNotification` permanece `undefined`).
- **Evidência concreta:** Busca global no repositório demonstra que `presentationMode` e `focusMode.setOnNotification` não são referenciados em `coordinator.ts`.
- **Condições necessárias:** Ativar o modo foco ou o modo apresentação.
- **Impacto potencial:** Notificações e áudio disparam normalmente durante reuniões ou apresentações, contradizendo o que foi anunciado ao usuário.
- **Forma segura de verificar:** Inspeção estática de `coordinator.ts`, `presentation-mode.ts` e `focus-mode.ts`.
- **Recomendação de correção:** Integrar ambos os serviços ao ciclo de vida de `AutonomyCoordinator` e suprimir áudio/notificações quando `presentationMode.getStatus().isSilentAudio` estiver ativo.
- **Estimativa de esforço:** Médio (3 a 4 horas).
- **Possíveis efeitos colaterais:** Nenhum.

---

### [BUG-04] `ReportGeneratorService.getTargetDirectory()` Ignora `securityBroker.resolveUserPath` e Polui `<cwd>/downloads`
- **ID:** `BUG-04`
- **Título:** `ReportGeneratorService.getTargetDirectory()` Ignora `securityBroker.resolveUserPath` e Polui `<cwd>/downloads`
- **Severidade:** `ALTA`
- **Confiança:** `Confirmada`
- **Categoria:** `Bug funcional`
- **Arquivo e intervalo de linhas:**
  - [`src/main/autonomous/report-generator.ts#L52-L68`](../src/main/autonomous/report-generator.ts#L52-L68)
  - [`src/main/config/config-store.ts#L120`](../src/main/config/config-store.ts#L120)
  - [`src/main/autonomous/qr-service.ts#L59`](../src/main/autonomous/qr-service.ts#L59)
- **Descrição técnica:**
  `configStore` define `folderDefaultTarget: 'downloads'`. `reportGenerator.getTargetDirectory()` não mapeia o alias `'downloads'` para a pasta real do usuário via `app.getPath('downloads')` ou `securityBroker.resolveUserPath()`, executando `fs.mkdirSync('downloads')` relativo ao diretório atual (`process.cwd()/downloads`).
  - Em desenvolvimento/testes, isso poluiu a raiz do repositório com 88 arquivos Excel e PNG.
  - Em produção (com o app instalado em `C:\Program Files\`), a criação falha por falta de permissão administrativa e cai no fallback `%TEMP%\Jasper_Relatorios`.
- **Evidência concreta:** Presença de 88 arquivos em `c:\Users\alisson.santos\Desktop\JASPER\jasper-avatar\downloads\`.
- **Condições necessárias:** Gerar relatórios ou QR codes com configuração padrão.
- **Impacto potencial:** Usuário final não localiza os arquivos gerados em produção, e o repositório é poluído durante testes.
- **Forma segura de verificar:** Inspecionar `report-generator.ts#L52-L68` e listar o diretório `downloads/`.
- **Recomendação de correção:** Resolver `folderDefaultTarget` através de `securityBroker.resolveUserPath()`.
- **Estimativa de esforço:** Trivial (30 minutos).
- **Possíveis efeitos colaterais:** Testes devem apontar para diretório temporário isolado.

---

### [BUG-05] Parser IMAP Manual Defeituoso em `CalendarEmailService.fetchRealImapEmails`
- **ID:** `BUG-05`
- **Título:** Parser IMAP Manual Defeituoso em `CalendarEmailService.fetchRealImapEmails`
- **Severidade:** `MÉDIA`
- **Confiança:** `Confirmada`
- **Categoria:** `Bug funcional`
- **Arquivo e intervalo de linhas:**
  - [`src/main/autonomous/calendar-email.ts#L234-L343`](../src/main/autonomous/calendar-email.ts#L234-L343)
- **Descrição técnica:**
  O parser assume que a linha `Subject:` sempre precede `From:`. Em servidores onde `From:` chega antes de `Subject:`, o primeiro remetente é descartado e o remetente do segundo e-mail sobrescreve o primeiro. Não decodifica palavras MIME RFC 2047 (`=?UTF-8?...`), ignora o cabeçalho `Date:` real e não extrai o corpo do e-mail.
- **Evidência concreta:** `calendar-email.ts#L314-L327`.
- **Condições necessárias:** Leitura de e-mails via IMAP real.
- **Impacto potencial:** Remetentes trocados, assuntos ilegíveis com caracteres Base64 e datas incorretas.
- **Forma segura de verificar:** Inspeção estática de `calendar-email.ts#L314-L328`.
- **Recomendação de correção:** Agrupar cabeçalhos por bloco de mensagem (`FETCH`), decodificar RFC 2047 e analisar a data real.
- **Estimativa de esforço:** Médio (3 horas).
- **Possíveis efeitos colaterais:** Nenhum.

---

### [BUG-06] `GitWatcher.runTests()` Falha com `spawn EINVAL` no Windows (Node 24) e `validateGitCommit` Bloqueia Mensagens com `"-f"`
- **ID:** `BUG-06`
- **Título:** `GitWatcher.runTests()` Falha com `spawn EINVAL` no Windows (Node 24) e `validateGitCommit` Bloqueia Mensagens com `"-f"`
- **Severidade:** `MÉDIA`
- **Confiança:** `Confirmada`
- **Categoria:** `Bug funcional`
- **Arquivo e intervalo de linhas:**
  - [`src/main/autonomous/git-watcher.ts#L180-L197`](../src/main/autonomous/git-watcher.ts#L180-L197)
  - [`src/main/autonomous/policy-engine.ts#L60-L69`](../src/main/autonomous/policy-engine.ts#L60-L69)
- **Descrição técnica:**
  1. `gitWatcher.runTests()` executa `execFile('npm.cmd', ['test'], { shell: false })`. No Windows com Node.js >=20.12.2 / 24, invocar `.cmd` com `shell: false` lança `Error: spawn EINVAL`.
  2. `validateGitCommit()` testa `if (lower.includes('-f'))` sobre o texto da mensagem de commit, rejeitando falsamente mensagens legítimas como `"fix: front-end"` ou `"feat: auto-format"`.
- **Evidência concreta:** `git-watcher.ts#L184` e `policy-engine.ts#L61-L63`.
- **Condições necessárias:** Executar testes via ferramenta de subagente ou criar commits com termos hifenizados em `f`.
- **Impacto potencial:** Falha sistemática de testes e recusa indevida de commits comuns.
- **Forma segura de verificar:** Inspeção estática dos arquivos indicados.
- **Recomendação de correção:** Usar `shell: true` seguro ou `cmd.exe /c` para npm no Windows e restringir o regex de flags do Git para não casar com o corpo da mensagem.
- **Estimativa de esforço:** Baixo (1 hora).
- **Possíveis efeitos colaterais:** Nenhum.

---

### [BUG-07] Trava Permanente de VAD (`this.hasSpoken`) no `MicRecorder` Quebra Timeout de 30s de Chamada e Ausência de Tratamento de Desconexão do Microfone
- **ID:** `BUG-07`
- **Título:** Trava Permanente de VAD (`this.hasSpoken`) no `MicRecorder` Quebra Timeout de 30s de Chamada e Ausência de Tratamento de Desconexão do Microfone
- **Severidade:** `ALTA`
- **Confiança:** `Confirmada`
- **Categoria:** `Bug funcional`
- **Arquivo e intervalo de linhas:**
  - [`src/renderer/audio/mic-recorder.ts#L20-L32`](../src/renderer/audio/mic-recorder.ts#L20-L32), [`#L66-L193`](../src/renderer/audio/mic-recorder.ts#L66-L193)
- **Descrição técnica:**
  Assim que o usuário fala pela primeira vez na chamada (`speechFramesCount >= 18`), `this.hasSpoken` torna-se `true` e nunca mais é resetado. A condição `else` para decrementar frames verifica `&& !this.hasSpoken`, de modo que `speechFramesCount` nunca mais cai abaixo de 18. Qualquer ruído de 8ms reseta o timer de inatividade de 30s, impedindo que a chamada seja encerrada automaticamente. Não há listener para o evento `ended` da faixa de microfone.
- **Evidência concreta:** `mic-recorder.ts#L169-L181`.
- **Condições necessárias:** Realizar chamada de voz e permanecer em silêncio.
- **Impacto potencial:** Chamadas de voz nunca expiram por inatividade, gerando consumo inútil de conexão e tokens do Gemini Live.
- **Forma segura de verificar:** Inspeção estática de `mic-recorder.ts#L169-L193`.
- **Recomendação de correção:** Resetar o estado de fala a cada turno concluído e adicionar listener `ended` na track de áudio.
- **Estimativa de esforço:** Baixo (2 horas).
- **Possíveis efeitos colaterais:** Nenhum.

---

### [BUG-08] Disparo Prematuro de `onPlaybackEnded` em `AudioPlayer` Corta Despedidas e Reativa Wake Word Durante a Fala
- **ID:** `BUG-08`
- **Título:** Disparo Prematuro de `onPlaybackEnded` em `AudioPlayer` Corta Despedidas e Reativa Wake Word Durante a Fala
- **Severidade:** `MÉDIA`
- **Confiança:** `Confirmada`
- **Categoria:** `Bug funcional`
- **Arquivo e intervalo de linhas:**
  - [`src/renderer/audio/audio-player.ts#L96-L111`](../src/renderer/audio/audio-player.ts#L96-L111)
  - [`src/renderer/main.ts#L297-L340`](../src/renderer/main.ts#L297-L340)
- **Descrição técnica:**
  O `AudioPlayer` emite `onPlaybackEnded` sempre que a fila de fontes ativas esvazia (`activeSources.length === 0`), sem saber se o servidor ainda está transmitindo novos chunks. Se houver um jitter de rede de 100ms, o handler em `main.ts` encerra a chamada antes da hora se detectar uma palavra de despedida no texto preliminar, cortando a fala do assistente.
- **Evidência concreta:** `audio-player.ts#L106-L110` e `main.ts#L297-L315`.
- **Condições necessárias:** Variação de latência durante respostas longas em streaming.
- **Impacto potencial:** Corte da fala final do assistente e ativação prematura da Wake Word enquanto o áudio ainda está sendo reproduzido.
- **Forma segura de verificar:** Inspeção estática dos trechos indicados.
- **Recomendação de correção:** Disparar encerramento de turno somente quando `turnComplete` do servidor tiver sido recebido E o player estiver inativo.
- **Estimativa de esforço:** Baixo (1 hora).
- **Possíveis efeitos colaterais:** Nenhum.

---

### [BUG-09] Modo Offline Quebrado em Cálculos Matemáticos (Bloqueio de `Function()` pela CSP), Comandos de Mídia Offline Descartados e Coleta de Lixo em `SpeechSynthesisUtterance`
- **ID:** `BUG-09`
- **Título:** Modo Offline Quebrado em Cálculos Matemáticos (Bloqueio de `Function()` pela CSP), Comandos de Mídia Offline Descartados e Coleta de Lixo em `SpeechSynthesisUtterance`
- **Severidade:** `MÉDIA`
- **Confiança:** `Confirmada`
- **Categoria:** `Bug funcional`
- **Arquivo e intervalo de linhas:**
  - [`src/renderer/offline/offline-handler.ts#L21`](../src/renderer/offline/offline-handler.ts#L21), [`#L36-L57`](../src/renderer/offline/offline-handler.ts#L36-L57), [`#L89-L111`](../src/renderer/offline/offline-handler.ts#L89-L111)
  - [`src/renderer/index.html#L6`](../src/renderer/index.html#L6)
- **Descrição técnica:**
  1. `offline-handler.ts#L93` avalia contas matemáticas com `Function(...)()`, o que é bloqueado pela CSP restritiva em `index.html` (`script-src 'self' blob:`), falhando 100% das vezes com `EvalError`.
  2. Comandos de mídia em modo offline invocam `sendTextMessage`, que é descartado pelo Main se o WebSocket estiver desconectado.
  3. `const utterance` é local; se for coletada pelo Garbage Collector durante a síntese de voz, o evento `onend` não dispara e o avatar fica movendo a boca indefinidamente.
- **Evidência concreta:** `offline-handler.ts#L89-L111` e `index.html#L6`.
- **Condições necessárias:** Usar voz ou chat em modo offline.
- **Impacto potencial:** Calculadora offline inoperante e animação de boca travada no avatar.
- **Forma segura de verificar:** Inspeção estática de `offline-handler.ts`.
- **Recomendação de correção:** Reutilizar o `math-evaluator.ts` existente no shared/renderer e reter a referência de `utterance` na instância da classe.
- **Estimativa de esforço:** Baixo (1 hora).
- **Possíveis efeitos colaterais:** Nenhum.

---

### [BUG-10] `loadMemory()` Apaga `userName` e `userPreferences` Após 30 Dias e `SemanticMemoryService` Nunca É Populado por `remember_fact`
- **ID:** `BUG-10`
- **Título:** `loadMemory()` Apaga `userName` e `userPreferences` Após 30 Dias e `SemanticMemoryService` Nunca É Populado por `remember_fact`
- **Severidade:** `MÉDIA`
- **Confiança:** `Confirmada`
- **Categoria:** `Bug funcional`
- **Arquivo e intervalo de linhas:**
  - [`src/main/memory.ts#L21-L41`](../src/main/memory.ts#L21-L41)
  - [`src/main/tools/system-tools.ts#L268-L272`](../src/main/tools/system-tools.ts#L268-L272)
  - [`src/main/autonomous/semantic-memory.ts#L57-L87`](../src/main/autonomous/semantic-memory.ts#L57-L87)
- **Descrição técnica:**
  1. Se o arquivo `jasper-memory.json` tiver mais de 30 dias sem modificação, `loadMemory()` sobrescreve o arquivo com a memória padrão, apagando o nome e as preferências do usuário.
  2. O módulo de memória semântica vetorial TF-IDF (`semantic-memory.ts`) nunca é alimentado por `remember_fact` em `system-tools.ts` (que grava apenas na memória clássica). Logo, a ferramenta `query_semantic_memory` sempre busca em um corpus vazio.
- **Evidência concreta:** `memory.ts#L23-L30` e `system-tools.ts#L268-L272`.
- **Condições necessárias:** Ausência de novos fatos por 30 dias ou consulta via `query_semantic_memory`.
- **Impacto potencial:** Perda do perfil do usuário e inutilidade da ferramenta de busca semântica em produção.
- **Forma segura de verificar:** Inspeção estática dos arquivos citados.
- **Recomendação de correção:** Limpar apenas fatos antigos sem sobrescrever nome/preferências e integrar `semanticMemory.addMemory()` em `remember_fact`.
- **Estimativa de esforço:** Baixo (30 minutos).
- **Possíveis efeitos colaterais:** Nenhum.

---

### [BUG-11] Inconsistências de UI/DOM, Duplicação do Atalho `F12`, Bloqueio no Fluxo do Modal de Licença e Roles Simulados no `SubagentOrchestrator`
- **ID:** `BUG-11`
- **Título:** Inconsistências de UI/DOM, Duplicação do Atalho `F12`, Bloqueio no Fluxo do Modal de Licença e Roles Simulados no `SubagentOrchestrator`
- **Severidade:** `MÉDIA`
- **Confiança:** `Confirmada`
- **Categoria:** `UX/UI`
- **Arquivo e intervalo de linhas:**
  - [`src/main/windows/main-window.ts#L139-L148`](../src/main/windows/main-window.ts#L139-L148), [`src/renderer/main.ts#L244-L248`](../src/renderer/main.ts#L244-L248)
  - [`src/renderer/ui/dom.ts#L23`](../src/renderer/ui/dom.ts#L23), [`src/renderer/ui/module-info-modal.ts#L442`](../src/renderer/ui/module-info-modal.ts#L442)
  - [`src/renderer/ui/license-modal.ts#L172-L181`](../src/renderer/ui/license-modal.ts#L172-L181)
  - [`src/main/autonomous/subagent-orchestrator.ts#L110-L113`](../src/main/autonomous/subagent-orchestrator.ts#L110-L113)
- **Descrição técnica:**
  1. Pressionar `F12` alterna tela cheia tanto no Main (`before-input-event`) quanto no Renderer (`keydown`), cancelando a ação a si mesma.
  2. Elementos DOM `#mic-status-label` e `#module-detail-category` são buscados pelo TypeScript mas não existem em `index.html`.
  3. `license-modal.ts#L178` força o usuário a digitar uma chave Gemini no Passo 2 mesmo quando já existe uma chave válida salva.
  4. Roles `coder` e `default` do `SubagentOrchestrator` retornam textos estáticos simulados.
- **Evidência concreta:** Linhas citadas nos respectivos arquivos.
- **Condições necessárias:** Interação padrão com a interface.
- **Impacto potencial:** Atalho de tela cheia quebrado, erros de console DOM e fluxo travado no modal de licença.
- **Forma segura de verificar:** Inspeção estática de UI.
- **Recomendação de correção:** Remover o listener duplicado de `F12`, alinhar seletores com o HTML e verificar `hasFullKey` no modal de licença.
- **Estimativa de esforço:** Baixo (2 a 3 horas).
- **Possíveis efeitos colaterais:** Nenhum.

---

### [PERF-01] Vazamento de Recursos de Hardware (`AudioContext`) em `audio-cues.ts`
- **ID:** `PERF-01`
- **Título:** Vazamento de Recursos de Hardware (`AudioContext`) em `audio-cues.ts`
- **Severidade:** `ALTA`
- **Confiança:** `Confirmada`
- **Categoria:** `Performance`
- **Arquivo e intervalo de linhas:**
  - [`src/renderer/audio/audio-cues.ts#L4-L45`](../src/renderer/audio/audio-cues.ts#L4-L45)
- **Descrição técnica:**
  `playTone()` e `playWakeChime()` instanciam um `new AudioContext()` nativo do navegador para cada beep ou chime sonoro e nunca invocam `ctx.close()`. O Chromium possui um limite rígido de instâncias nativas de contexto de áudio por processo; após repetidas interações sonoras, o áudio do Renderer degrada ou emite erros nativos.
- **Evidência concreta:** `src/renderer/audio/audio-cues.ts#L6` e `#L30`.
- **Condições necessárias:** Uso contínuo do assistente e ativação de alertas sonoros.
- **Impacto potencial:** Esgotamento de recursos de áudio do sistema operacional e falha de saída de som.
- **Forma segura de verificar:** Inspeção estática de `audio-cues.ts`.
- **Recomendação de correção:** Compartilhar uma única instância singleton de `AudioContext` reutilizável em `audio-cues.ts`.
- **Estimativa de esforço:** Trivial (15 minutos).
- **Possíveis efeitos colaterais:** Eliminação imediata do vazamento de handles de áudio.

---

### [PERF-02] Spawning Excessivo de Processos PowerShell + Compilação C# em Background e Vazamento de Memória/Disco em Serviços Autônomos
- **ID:** `PERF-02`
- **Título:** Spawning Excessivo de Processos PowerShell + Compilação C# em Background e Vazamento de Memória/Disco em Serviços Autônomos
- **Severidade:** `ALTA`
- **Confiança:** `Confirmada`
- **Categoria:** `Performance`
- **Arquivo e intervalo de linhas:**
  - [`src/main/autonomous/window-tracker.ts#L42-L85`](../src/main/autonomous/window-tracker.ts#L42-L85)
  - [`src/main/autonomous/scripts/get-active-window.ps1#L4-L16`](../src/main/autonomous/scripts/get-active-window.ps1#L4-L16)
  - [`src/main/autonomous/focus-mode.ts#L68-L70`](../src/main/autonomous/focus-mode.ts#L68-L70)
  - [`src/main/autonomous/system-health.ts#L56-L61`](../src/main/autonomous/system-health.ts#L56-L61), [`#L99-L104`](../src/main/autonomous/system-health.ts#L99-L104)
  - [`src/main/autonomous/calendar-email.ts#L115-L156`](../src/main/autonomous/calendar-email.ts#L115-L156)
- **Descrição técnica:**
  1. `WindowTrackerService` dispara `powershell.exe -File get-active-window.ps1` a cada **4 segundos**. Cada execução recompila código C# via `Add-Type` na inicialização do CLR. Quando `focusMode` está ativo, ele soma outro processo a cada **6 segundos** (total de 900 a 1.500 processos PowerShell/hora).
  2. `SystemHealthService` consulta `si.fsSize()` e `si.battery()` a cada 8 segundos continuamente.
  3. `calendarEmail.exportIcsFile()` cria arquivos `.ics` que nunca são excluídos na limpeza de retenção de 30 dias.
- **Evidência concreta:** `window-tracker.ts#L42` e `get-active-window.ps1#L4-L16`.
- **Condições necessárias:** Execução contínua do aplicativo em segundo plano.
- **Impacto potencial:** Picos recorrentes de uso de CPU, drenagem de bateria em notebooks e acúmulo desnecessário de arquivos em disco.
- **Forma segura de verificar:** Inspeção estática dos intervalos nos arquivos citados.
- **Recomendação de correção:** Utilizar processo PowerShell persistente ou aumentar intervalo para 15-30s com cache compartilhado em memória, e podar arquivos `.ics` antigos.
- **Estimativa de esforço:** Médio (3 a 4 horas).
- **Possíveis efeitos colaterais:** Redução substancial de CPU em repouso.

---

### [PERF-03] Loop de Renderização 3D Sem Delta-Time, Alocações por Frame e Geometrias Three.js Não Descartadas
- **ID:** `PERF-03`
- **Título:** Loop de Renderização 3D Sem Delta-Time, Alocações por Frame e Geometrias Three.js Não Descartadas
- **Severidade:** `MÉDIA`
- **Confiança:** `Confirmada`
- **Categoria:** `Performance`
- **Arquivo e intervalo de linhas:**
  - [`src/renderer/main.ts#L145-L177`](../src/renderer/main.ts#L145-L177)
  - [`src/renderer/scene/neural-background.ts#L163-L268`](../src/renderer/scene/neural-background.ts#L163-L268)
  - [`src/renderer/scene/avatar.ts#L209-L258`](../src/renderer/scene/avatar.ts#L209-L258)
- **Descrição técnica:**
  1. O loop `animate()` não utiliza `clock.getDelta()`. Em telas de alta frequência (144Hz/240Hz), o avatar pisca e gira 2 a 4 vezes mais rápido que em 60Hz. O loop continua rodando mesmo quando a janela está minimizada para a bandeja (tray).
  2. `neuralBackground.animate()` aloca novos arrays JavaScript para posições e cores de pulso a cada frame, gerando pressão constante sobre o Garbage Collector do V8.
  3. Ao alternar avatares, `avatarGroup.clear()` não descarta geometrias e materiais WebGL via `.dispose()`.
- **Evidência concreta:** Linhas citadas em `renderer/main.ts`, `neural-background.ts` e `avatar.ts`.
- **Condições necessárias:** Execução da interface 3D.
- **Impacto potencial:** Consumo de GPU desnecessário com o app minimizado e instabilidade de FPS em monitores de alta taxa de atualização.
- **Forma segura de verificar:** Inspeção estática dos módulos de cena 3D.
- **Recomendação de correção:** Pausar a renderização quando a janela estiver minimizada/oculta, aplicar delta-time e descartar geometrias explicitamente.
- **Estimativa de esforço:** Médio (3 horas).
- **Possíveis efeitos colaterais:** Comportamento 3D uniforme em qualquer monitor e economia de energia quando minimizado.

