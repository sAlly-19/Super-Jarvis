# Jasper Comercial com Controle Total — Especificação de Arquitetura

**Data:** 22 de outubro de 2026
**Status:** design aprovado pelo proprietário do produto
**Escopo:** aplicativo desktop Jasper para Windows 10/11 x64

## 1. Objetivo

Transformar o Jasper em um produto comercial autossuficiente no qual o agente possui controle integral do sistema operacional, sem solicitar confirmação a cada ação, mas somente funciona quando existe uma licença válida para a instalação.

O produto deve preservar automação de PowerShell, processos, arquivos, mouse, teclado, áudio, captura de tela e ferramentas futuras. A ausência de confirmações é um requisito deliberado. A proteção arquitetural deve impedir que páginas web, processos locais não confiáveis, renderers adulterados ou binários substituídos obtenham acesso às capacidades do agente.

## 2. Decisões aprovadas

- O Jarvis inteiro permanece bloqueado sem licença válida.
- Apenas a interface mínima de ativação funciona no estado bloqueado.
- O lease offline é assinado com Ed25519 e vale por no máximo 72 horas.
- Depois da expiração, o produto falha fechado até conseguir renovar online.
- Não existem confirmações por operação.
- Não existe botão ou atalho de emergência para suspender a autonomia.
- Ferramentas do sistema não aplicam bloqueio semântico de comandos destrutivos.
- O instalador é autossuficiente e não depende de Python, pip ou pacotes previamente instalados.
- O backend Python será distribuído como sidecar compilado e se comunicará somente com o processo Main do Electron.
- Não será adicionada telemetria externa. Logs operacionais permanecem locais e redigidos.

## 3. Estados do produto e licenciamento

O processo Main mantém uma máquina de estados única:

1. `locked`: configuração básica carregada, nenhuma capacidade do agente iniciada.
2. `validating`: validação local ou renovação online em andamento.
3. `unlocked`: lease válido; sidecar, IPC operacional, áudio e interface completa podem funcionar.
4. `expired`: lease expirado e renovação indisponível ou rejeitada.
5. `revoked`: servidor informou revogação ou suspensão.
6. `backend_error`: licença válida, mas o sidecar não iniciou ou excedeu o limite de reinícios.

Somente `unlocked` permite iniciar o sidecar ou aceitar comandos do renderer. `expired` e `revoked` encerram imediatamente toda a árvore de processos do sidecar, invalidam solicitações pendentes e retornam à interface de ativação. `backend_error` mantém a licença, mas bloqueia operações até reparo ou reinício bem-sucedido.

O lease deve conter e validar, no mínimo:

- `iss = jasper-license-api`;
- `aud = jasper-avatar-desktop`;
- `installationId`;
- `machineHash`;
- `iat` e `exp` numéricos;
- duração máxima de 259.200 segundos;
- `kid` pertencente ao keyring compilado no aplicativo.

Chaves públicas não podem ser carregadas de `jasper-config.json`, `.env`, resposta não autenticada ou outro arquivo editável. A rotação usa um keyring compilado, indexado por `kid`. O aplicativo tenta renovar antecipadamente quando há rede, mas continua funcionando offline até `exp`. Relógio regressivo em relação ao último horário confiável do servidor bloqueia o produto até validação online.

## 4. Inicialização e fronteira de confiança

Na inicialização, o Main executa somente:

- leitura de configuração necessária à ativação;
- criação da janela em modo bloqueado;
- inicialização do `LicenseManager`;
- registro dos canais IPC mínimos de licença e janela.

Wake word, microfone, chat, memória do agente, visão, TTS, STT e ferramentas não são inicializados antes de `unlocked`.

Após validar o lease, o Main:

1. resolve o sidecar exclusivamente em `process.resourcesPath` no pacote comercial;
2. verifica manifesto, versão e SHA-256 dos arquivos do sidecar;
3. inicia o executável por caminho absoluto, com ambiente mínimo e diretório de trabalho controlado;
4. conclui o handshake de versão do protocolo;
5. habilita os canais IPC operacionais;
6. envia configuração e memória redigidas conforme o contrato;
7. libera a interface completa.

Produção não consulta `process.cwd()`, `PATH`, `venv`, `.venv` ou uma instalação global de Python. Desenvolvimento pode usar um caminho explícito definido pela configuração de build, nunca descoberta oportunista.

## 5. Sidecar Python autossuficiente

O backend será produzido com PyInstaller no formato `onedir`. O pacote inclui o executável, bibliotecas nativas, modelos e metadados necessários. Arquivos `.py` soltos não fazem parte do artefato comercial.

O FastAPI, o servidor HTTP e o WebSocket local deixam de fazer parte do runtime. O sidecar implementa um loop assíncrono de mensagens pelo `stdin/stdout` do processo filho:

- `stdin`: frames enviados exclusivamente pelo Main;
- `stdout`: frames de protocolo enviados exclusivamente ao Main;
- `stderr`: logs técnicos, nunca mensagens de protocolo.

Cada frame contém um prefixo de 4 bytes unsigned big-endian com o tamanho do corpo, seguido por um objeto JSON UTF-8. O protocolo possui versão explícita, ID de correlação, tipo de mensagem e payload validado. Mensagens desconhecidas, maiores que o limite ou incompatíveis encerram a sessão do sidecar.

## 6. Contrato de mensagens

Mensagens Main → sidecar:

- `hello`: versão, nonce da execução e capacidades esperadas;
- `config`: identidade do agente, modelo, voz, visão e credenciais necessárias;
- `chat`: texto com até 20.000 caracteres;
- `audio_input`: WAV mono de 16 kHz codificado, sujeito ao limite global do frame;
- `interrupt`: cancelamento da tarefa ativa;
- `memory_snapshot`: memória persistente atual;
- `shutdown`: encerramento ordenado.

Mensagens sidecar → Main:

- `hello_ack`;
- `status`;
- `user_transcript`;
- `response`;
- `audio_output`;
- `tool_execution` e `tool_result`;
- `memory_upsert` e `memory_clear`;
- `turn_complete`;
- `interrupted`;
- `error`.

Todos os frames têm limite máximo de 16 MiB. Texto continua limitado a 20.000 caracteres. IDs, nomes de ferramenta e campos de configuração recebem limites menores definidos pelos validadores compartilhados. Solicitações possuem timeout e são removidas do mapa de pendências após resposta, cancelamento, expiração da licença ou morte do processo.

## 7. Electron Main, preload e renderer

O Main é o único consumidor do sidecar. O renderer não conhece executável, pipe, descritor de processo ou protocolo Python.

O preload expõe métodos de alto nível, sem `ipcRenderer` genérico. Cada handler do Main valida:

- `sender`, `senderFrame` e URL confiável;
- estado `unlocked` para canais operacionais;
- tipo, formato e tamanho do payload;
- disponibilidade do sidecar;
- timeout e cancelamento.

O renderer pode mostrar estados e resultados, mas não decide se a licença é válida. Alterar DOM, JavaScript do renderer ou arquivos de configuração não deve liberar canais operacionais.

Sem licença, o documento mantém apenas a experiência de ativação acessível. Controles do agente ficam ausentes ou inertes; não apenas escondidos visualmente.

## 8. Controle total do sistema

Uma licença válida libera as ferramentas declaradas pelo backend, incluindo PowerShell arbitrário, controle de processos, arquivos, mouse, teclado, volume e captura de tela. Não existe caixa de confirmação, política de risco, allowlist semântica de comandos ou bloqueio específico de operações destrutivas.

Validação estrutural permanece obrigatória para estabilidade:

- argumentos devem respeitar o schema da ferramenta;
- payloads e saídas possuem tamanho máximo;
- processos possuem timeout configurável e captura limitada de saída;
- o loop do agente possui limite de iterações por turno;
- tarefas canceladas liberam processos e recursos associados;
- exceções são convertidas em resultados tipados.

Esses limites evitam travamentos e consumo ilimitado, sem exigir autorização humana e sem retirar capacidades do agente.

## 9. Memória e dados locais

Existirá uma única memória persistente. O Main grava os dados no diretório `userData` por escrita atômica, com retenção máxima de 30 dias. O sidecar recebe um snapshot no início da sessão e emite eventos de atualização; não mantém uma lista global compartilhada entre clientes.

A memória é associada à instalação licenciada. Revogar ou expirar a licença bloqueia o acesso operacional, mas não apaga automaticamente dados locais. A ativação válida da mesma instalação recupera a memória existente.

Segredos continuam protegidos com `electron.safeStorage`. Chaves de API, device secrets, leases e tokens não entram em logs nem são enviados ao renderer em texto integral depois do onboarding.

## 10. Logs e privacidade

O produto registra localmente:

- inicialização e encerramento do sidecar;
- estado da licença sem gravar a chave;
- nome da ferramenta, horário, duração e resultado resumido;
- falhas de protocolo, modelo, STT e TTS;
- reinícios e motivo de encerramento.

O redator remove chaves, tokens, JWTs, senhas, cabeçalhos de autorização e conteúdo reconhecido como segredo. Comandos completos, texto digitado, capturas de tela, áudio e respostas integrais não são persistidos no log operacional padrão.

O onboarding comercial apresenta consentimento único e explícito informando que o agente pode controlar integralmente o Windows, executar comandos, operar entrada, capturar a tela e enviar dados aos provedores de IA, STT e TTS configurados. Depois do aceite, não há confirmação por ação.

## 11. Falhas e recuperação

O Main permite até três reinícios do sidecar por sessão, com backoff crescente. Falha posterior coloca o produto em `backend_error`. Reiniciar o aplicativo cria uma nova sessão de tentativas, desde que a licença continue válida.

Falha de rede antes de `exp` mantém o produto offline. Expiração, assinatura inválida, máquina divergente ou revogação falham fechado. Expiração ou revogação durante uma tarefa cancela as solicitações, encerra a árvore do sidecar e invalida os canais operacionais.

Versão incompatível, hash divergente, executável ausente ou handshake incompleto nunca fazem fallback para Python global ou código-fonte local.

## 12. Empacotamento e atualização comercial

`electron-builder` inclui a distribuição PyInstaller em `extraResources`. O manifesto com SHA-256 de todos os arquivos do sidecar fica dentro do ASAR protegido pelos Electron Fuses, e o executável principal assinado constitui sua raiz de confiança; uma cópia editável ao lado do sidecar nunca é aceita como autoridade. O pacote não referencia pastas removidas. Executável Electron, sidecar, instalador NSIS e atualização devem ser assinados com Authenticode antes da publicação.

Atualizações usam canal HTTPS e metadados assinados. O aplicativo não instala um artefato cuja assinatura, publicador ou hash não corresponda à política de release.

O artefato final deve funcionar em uma máquina Windows 10/11 x64 limpa, sem Node.js, Python, pip ou Visual C++ adicional além do que estiver incluído ou for requisito explícito do instalador.

## 13. CI, supply chain e validação

A CI deve:

1. usar Node.js 24 e uma versão Python fixada;
2. instalar dependências npm por `npm ci`;
3. instalar dependências Python por lockfile com hashes;
4. executar typecheck, testes TypeScript e testes Python;
5. executar SAST para TypeScript, JavaScript e Python;
6. executar auditorias npm e Python;
7. construir o sidecar PyInstaller;
8. construir e empacotar o Electron;
9. inspecionar o ASAR e `extraResources`;
10. iniciar o pacote sem Python global;
11. verificar ativação, bloqueio, chat, áudio e uma ferramenta PowerShell controlada;
12. gerar SBOMs npm e Python;
13. verificar assinatura e hashes antes de publicar.

Os testes de segurança provam que não existe porta local, renderer sem licença não alcança o agente, IPC de origem não confiável é rejeitado, arquivos em `cwd` não substituem o backend e a chave pública de produção valida leases reais.

## 14. Critérios de aceite

O trabalho é aceito somente quando:

- sem licença, apenas ativação e controles básicos da janela funcionam;
- lease válido libera todas as capacidades sem confirmação;
- lease válido continua offline até 72 horas após sua emissão;
- lease expirado, inválido ou revogado encerra o agente e bloqueia novas operações;
- nenhuma porta HTTP/WebSocket é aberta;
- o renderer não se comunica diretamente com o sidecar;
- produção executa somente o binário empacotado e verificado;
- o pacote funciona sem Python global;
- memória é persistente, única e sujeita à retenção de 30 dias;
- logs não expõem segredos ou conteúdo sensível integral;
- instalador, executáveis e atualizações estão assinados;
- testes automatizados cobrem estados de licença, protocolo, ferramentas, falhas e pacote limpo.

## 15. Fora de escopo

- suporte a macOS ou Linux;
- confirmações por ação;
- botão ou atalho de emergência;
- operação do agente sem licença;
- telemetria externa;
- reescrita completa do backend em Node.js;
- manutenção do FastAPI/WebSocket no runtime comercial.
