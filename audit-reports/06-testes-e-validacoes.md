# RELATÓRIO 6 — Testes e Validações

## 6.1 Diagnósticos Somente-Leitura Executados

Durante a auditoria, foram executados exclusivamente testes e comandos estáticos comprovadamente seguros e não destrutivos:

| Comando | Resultado | Análise Técnica |
| :--- | :--- | :--- |
| `node scripts/scan-secrets.mjs` | **Aprovado (Exit Code 0)** | 121 arquivos rastreados foram inspecionados. Nenhum segredo óbvio foi encontrado nos padrões existentes. *(Nota: o script não verifica chaves Google `AIza...` nem tokens GitHub fine-grained, ver [DIST-02]).* |
| `npx tsc --noEmit -p tsconfig.json` | **Aprovado (Exit Code 0)** | Compilação estática do Renderer, Preload e Shared livre de erros de tipagem TypeScript. |
| `npx tsc --noEmit -p tsconfig.node.json` | **Aprovado (Exit Code 0)** | Compilação estática do Main, Autonomy e Tools livre de erros de tipagem TypeScript. |
| `git log --all --full-history --stat` | **Concluído** | Histórico completo de commits inspecionado para verificação de segredos e credenciais pregressas. |

---

## 6.2 Motivo da Não Execução de `npm test` Durante a Auditoria

Em estrita conformidade com a **Regra Obrigatória nº 8** (*"Não execute comandos de automação do Jasper que possam alterar o Windows, periféricos, arquivos ou serviços externos"*), a suíte automatizada `npm test` não foi disparada no terminal do host.

A inspeção estática do arquivo [`test/os-automation.test.ts`](../test/os-automation.test.ts#L23-L30) e [`test/zero-config-real-modules.test.ts`](../test/zero-config-real-modules.test.ts#L31-L34) revelou que esses testes:
1. Executam `mediaController.executeMediaCommand('mute')`, que dispara o script PowerShell nativo `media-control.ps1` no Windows real da máquina do usuário, **alterando o volume e silenciando o áudio físico do sistema operacional**.
2. Executam rotinas de geração de relatórios e QR codes sem isolar o diretório de destino, gravando dezenas de arquivos reais na pasta `./downloads/` do repositório.

---

## 6.3 Análise Crítica dos Mocks e da Suíte de Testes Existente

### 1. Mock Global Permissivo do Electron (`scripts/run-tests.mjs`)
O executor de testes intercepta o carregamento interno de módulos do Node (`Module._load`) e substitui o binário nativo do Electron por um mock sintético em memória:
- `dialog.showMessageBox`: Retorna sempre `{ response: 0 }`. Isso faz com que **qualquer confirmação de segurança crítica solicitada pelo `SecurityBroker` seja aprovada automaticamente**, mascarando possíveis bloqueios de segurança em testes de integração.
- `safeStorage.encryptString`: Utiliza uma conversão simples para Base64 em vez da DPAPI real do Windows.
- `BrowserWindow`: Simula métodos gráficos (`loadURL`, `printToPDF`) retornando buffers e strings vazias, impossibilitando a validação real do comportamento de navegadores headless ou do gerador de relatórios PDF.

### 2. Poluição Sistemática da Pasta `./downloads/`
Como identificado no achado **[BUG-04]**, a configuração padrão `folderDefaultTarget: 'downloads'` faz com que `ReportGeneratorService` e `QrService` criem pastas relativas a `process.cwd()`.
A execução de `test/zero-config-real-modules.test.ts` grava repetidamente arquivos reais `Tabela_de_Custos_<timestamp>.xlsx` e `qrcode_<timestamp>.png` na raiz do projeto. Como não há rotina de limpeza (`after()` ou `teardown()`), a pasta acumulou **88 arquivos residuais**.

### 3. Falsos Positivos e Asserções Fracas
- **Docker Sandbox:** O teste de execução em sandbox (`test/os-automation.test.ts#L45-L60`) aceita a string de retorno `"Docker Indisponível"` como sucesso, permitindo que a suíte passe com 100% de sucesso mesmo em máquinas onde o Docker Desktop sequer está instalado ou em execução.
- **Navegador Headless:** `test/headless-browser.test.ts` testa apenas a casca de TypeScript do mock de `BrowserWindow`, sem validar a eficácia real do bloqueador `onBeforeRequest` contra conexões WebSockets ou DNS Rebinding.

---

## 6.4 Principais Lacunas de Cobertura (0% Testados)

| Módulo Crítico | Importância no Sistema | Estado Atual de Cobertura |
| :--- | :--- | :--- |
| `src/main/gemini-live.ts` | **Núcleo de Voz e IA:** Ciclo de vida WebSocket, troca de áudio e roteamento de chamadas. | **0% de testes automatizados.** Permitiu que o modelo inválido `gemini-3.8-live` e a condição de corrida de reconexão passassem despercebidos. |
| `src/main/services/license-manager.ts` | **Segurança de Distribuição:** Ativação de licenças, leases offline e HWID. | **0% de testes unitários isolados.** Testado apenas via script externo que deliberadamente contorna a chave pública. |
| `src/main/autonomous/coordinator.ts` | **Orquestração Central:** Inicialização e sincronização de 23 módulos. | **0% de testes.** Permitiu que `PresentationMode` e `FocusMode` ficassem esquecidos fora da aplicação. |
| `src/renderer/audio/*` | **Pipeline de Áudio do Usuário:** `mic-recorder.ts`, `audio-player.ts`, `audio-cues.ts`. | **0% de testes automatizados.** O vazamento de `AudioContext` e o travamento de VAD nunca foram detectados. |
| `src/renderer/offline/offline-handler.ts` | **Confiabilidade Sem Conexão:** Respostas locais de calculadora e comandos de mídia. | **0% de testes.** O bloqueio de `Function()` pela CSP nunca havia sido testado. |

