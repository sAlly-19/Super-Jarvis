# Jasper AI Desktop

Aplicativo desktop para Windows com avatar 3D, conversa por voz via Gemini Live e ferramentas locais de produtividade. O renderer roda isolado do processo principal do Electron e as operacoes privilegiadas passam por validacao e, quando produzem efeitos externos ou capturam tela, por confirmacao do usuario.

## Estado atual

- Plataforma suportada: Windows 10/11 x64.
- Runtime de desenvolvimento: Node.js 24 LTS e npm 11.
- Desktop: Electron 44, TypeScript, Vite, Three.js e TensorFlow.js.
- Licenciamento: API do Cloudflare Worker com lease Ed25519 de ate 72 horas offline.
- Code Interpreter: removido. O Jasper nao executa Python ou JavaScript fornecido pelo modelo.
- DevTools: desativado em builds de producao.
- Assinatura de codigo: ainda nao configurada. Builds locais nao devem ser publicados como release final.

## Recursos

- Avatar 3D com lip sync e visualizacao de audio.
- Conversa continua pelo Gemini Live.
- Wake word local treinado com TensorFlow.js.
- Lembretes, agenda local, foco e modo apresentacao.
- Saude do sistema, janela ativa e observacao opcional do clipboard.
- Relatorios PDF, planilhas, documentos e QR Code.
- Leitura/OCR de arquivos limitados a Downloads, Desktop e Documentos.
- Organizacao de arquivos com simulacao previa e confirmacao para mover.
- Navegacao web isolada com bloqueio de SSRF e confirmacao para click, preenchimento e screenshot.
- Webhooks HTTPS cadastrados com validacao de destino.
- Home Assistant com allowlist de dominios e servicos.

## Limites de seguranca

O Jasper nao e um sandbox de sistema operacional. A antiga funcao de execucao de codigo foi removida. Interpretadores de comando nao podem ser abertos pelo assistente, processos externos exigem PID e confirmacao, e automacao de interface bloqueia campos de credenciais, Secure Desktop e terminais.

O Home Assistant nao possui modo de demonstracao. Sem URL e token validos, consultas retornam vazias e comandos falham com `NOT_CONFIGURED`. Cada comando real exige confirmacao individual. Entidades de acesso fisico, como fechaduras, alarmes, cameras e garagens, sao bloqueadas.

O suporte offline de licenca e um lease temporario, nao uma licenca permanente sem internet. Depois de no maximo 72 horas sem renovacao valida, o acesso falha fechado.

## Privacidade

Dados locais, como configuracoes, memoria, agenda e grafo de conhecimento, ficam no diretorio de dados do aplicativo. Segredos suportados sao protegidos com `electron.safeStorage`; logs e memorias possuem retencao maxima de 30 dias.

Nem todo processamento e local:

- Audio e prompts da conversa sao enviados ao Gemini Live.
- Uma captura de tela so e produzida apos confirmacao por operacao e pode ser enviada ao Gemini quando essa foi a acao solicitada.
- Conteudo de paginas, arquivos ou clipboard usado em uma conversa pode ser enviado ao Gemini.
- Licenciamento consulta a API Jasper no Cloudflare Worker.
- Home Assistant e webhooks recebem apenas as chamadas explicitamente configuradas e autorizadas.

Nunca use credenciais reais em testes ou arquivos versionados. `.env`, chaves privadas e credenciais Firebase devem permanecer fora do Git.

## Desenvolvimento

Requisitos:

- Node.js 24 LTS
- npm 11+
- Windows PowerShell 5.1+

Instalacao e execucao:

```powershell
npm ci
npm run dev
```

Use `.env.example` como referencia. A chave Gemini tambem pode ser configurada pela interface. Nao distribua um `.env` junto ao instalador.

## Verificacao

```powershell
npm run verify
npm run audit:runtime
```

`npm run verify` executa typecheck, testes e build. A suite cobre os modulos reais com mocks apenas das fronteiras Electron e de rede quando necessario.

`npm run test:wake` testa o TensorFlow real em Electron com microfone simulado,
rede externa bloqueada e a CSP de producao. Cobre falha de carregamento,
gravacao, treino, recarga do modelo salvo, reset, novo treino e liberacao de memoria.
Depois de empacotar, `node scripts/test-wake-lifecycle.mjs --packaged` repete
o teste lendo os assets de `release/win-unpacked/resources/app.asar`.

O modelo base de voz acompanha o aplicativo em `public/speech-model` e funciona
offline. Os scripts de desenvolvimento e build verificam seus checksums;
somente arquivos ausentes ou corrompidos precisam ser baixados durante o build.

Para validar o aplicativo empacotado:

```powershell
npm run package:dir
npm run smoke:packaged
```

O smoke test abre o pacote, confirma que o avatar carregou, valida IPC/CSP e grava a evidencia fora do repositorio.

## Empacotamento

```powershell
npm run dist:win
```

O build inclui os scripts PowerShell necessarios como `extraResources` e ativa Electron Fuses para desabilitar RunAsNode, `NODE_OPTIONS`, inspector CLI e carregamento fora do ASAR.

Antes de uma release publica ainda e obrigatorio:

1. Adquirir um certificado de assinatura de codigo.
2. Assinar instalador e executaveis.
3. Executar a CI em Node 24 e o smoke test do pacote assinado.
4. Publicar hashes do artefato e procedimento de verificacao.

## Estrutura

```text
src/main/       processo principal, IPC e servicos privilegiados
src/preload/    ponte minima e tipada para o renderer
src/renderer/   interface, audio e avatar 3D
src/shared/     tipos e constantes compartilhados
test/           testes de integracao e seguranca
scripts/        setup, runner e smoke test empacotado
```

## macOS

O codigo possui algumas abstracoes multiplataforma, mas a versao atual depende de PowerShell, UI Automation do Windows, controles de midia e empacotamento NSIS. Uma versao macOS exige adaptadores equivalentes, permissoes de Accessibility/Screen Recording, Keychain, assinatura Developer ID e notarizacao. Nao e apenas uma troca de alvo do builder.

## Evidencias visuais

As imagens existentes ficam em `assets/screenshots/`. Elas devem ser atualizadas quando houver mudancas relevantes na interface; nao sao prova de comportamento de seguranca.
