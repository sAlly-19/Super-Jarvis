# Gemini Live — plano e progresso

Autorizado pelo usuário: implementar chamada em tempo real no Jasper, com chave própria Google, interrupção e ferramentas locais. Execução na main; preservar alterações anteriores.

## Decisões

- SDK google-genai já travado; sessão `gemini-3.8-live`, áudio PCM16 mono 16 kHz de entrada e 24 kHz de saída.
- Chave Gemini criptografada no Main; nunca devolvida ao renderer. Sessão sai exclusivamente do sidecar; licença e consentimento obrigatórios.
- Novas mensagens `live_start`, `live_audio`, `live_stop` no protocolo privado; saída usa eventos existentes.
- Recepção Live em tarefa assíncrona independente da leitura stdio. Cancelamento fecha conexão e descarta fila de áudio.
- Microfone em modo Live envia somente PCM em blocos de 100 ms; VAD remoto decide fim da fala e interrupção.
- Botão de microfone abre/fecha chamada; vozes Google selecionáveis; chat de texto continua independente.
- Ferramentas locais permitidas usam o catálogo existente; chamadas canceladas pelo servidor não executam ações pendentes.

## Etapas

- [x] Testes RED/GREEN de sessão Live (stream, interrupção, ferramentas, limpeza, falhas).
- [x] Protocolo simétrico Python/TypeScript com limites de áudio e validação.
- [x] Main/preload com licença, consentimento, chave Gemini e encerramento.
- [x] Microfone, interface de chamada e vozes Google.
- [x] Testes de integração, TypeScript/Python e build; registrar limites de validação real.

## Evidências

Referências oficiais: https://ai.google.dev/gemini-api/docs/live-api/capabilities e https://ai.google.dev/gemini-api/docs/live-api/tools.

- SDK validou `LiveConnectConfig` real com voz, ferramentas e transcrições.
- Revisão independente identificou concorrência entre texto e Live, remoção de chave durante conexão, início de chamadas concorrentes e cancelamento de ferramenta em thread.
- Correções: texto digitado durante chamada segue para a própria sessão Live; gerações e exclusão de início simultâneo; remoção Gemini invalida sessão pendente; ferramentas executadas em processos descartáveis, com encerramento de árvore antes de concluir o cancelamento.
- Teste real de subprocesso confirmou encerramento após cancelamento e ausência de herança de chave no ambiente do worker. Efeitos externos já efetivados não são desfeitos.
- Primeiro build PyInstaller esgotou memória ao coletar motores opcionais de reconhecimento de fala instalados no ambiente antigo. Foram excluídos tensorflow, torch, transformers, boto3/botocore, LiteLLM/OpenAI, que não são utilizados por este runtime. Build direto seguinte concluído; manifesto regenerado com 111 arquivos.
- Pendente validar voz física/eco/latência e acesso ao modelo na conta do cliente; não se afirma teste online concluído.
- Verificação: 194 testes TypeScript, 51 testes Python e 8 testes de artefato aprovados; typecheck, build Electron e compilação PyInstaller aprovados. O teste de artefato executou a ferramenta de telemetria pelo worker compilado.
- Decisão de revisão: alterações externas já confirmadas por uma ferramenta não são revertidas no cancelamento. Cancelar encerra os processos ainda em execução; desfazer efeitos anteriores não é semanticamente possível de forma geral.
- Decisão de produto: durante chamada ativa, texto digitado entra na sessão Live; fora dela, continua no provedor de texto escolhido. Isso evita duas respostas de voz simultâneas e mantém o áudio de entrada responsivo.

## Uso

1. Cadastrar chave Google Gemini em IA & Voz.
2. Selecionar voz Google no campo de voz; vozes Edge continuam para leitura de texto e são mapeadas para equivalente Google na chamada.
3. Clicar no microfone, permitir acesso ao dispositivo e conversar. Clicar novamente encerra a sessão.
4. Após bloqueio de licença, falha de rede ou remoção da chave, iniciar uma nova chamada quando a condição for resolvida. Não há reconexão automática nem retomada de sessão nesta versão.
