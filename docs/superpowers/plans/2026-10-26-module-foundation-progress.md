# Fundação modular — progresso e retomada

## Autorizações e limites

- Planos 01/02 aprovados pelo usuário; método nativo escolhido.
- Usuário autorizou verificar/adotar SQLite integrado se compatível, sem adotar alternativa silenciosamente.
- Esta rodada realizou somente verificação de compatibilidade e registro; nenhuma implementação de módulo ou banco de produção.
- Manter main, consultar alternativas antes de escolher, não publicar ou enviar push.

## T1 — verificação local

Comando: `node scripts/test-electron-sqlite.cjs`.

Resultado: `ELECTRON_SQLITE_PASS`, processo Main real, Electron 44.4.0 / Node 24.21.0 / SQLite 3.53.4. Banco e perfil temporários isolados, sem acesso ao banco/configuração/segredos do produto. O runner remove seu próprio diretório temporário validado ao sair.

Cobertura: banco em disco, fechar/reabrir, commit/rollback, WAL, foreign keys, unicidade e compare-and-swap por revisão. Não comprova desempenho, concorrência de carga, migrações, restauração de backup ou instalador assinado.

Decisão autorizada: adotar `node:sqlite` na interface proposta de persistência; nenhuma dependência nova ou fallback para better-sqlite3.

## Autorizações posteriores

Usuário aprovou T2–T4: manifesto JSON único com subset estrito sem biblioteca nova; preservar ferramentas atuais após consentimento e desligar módulos novos; envelope v1 com negociação de suporte modular. Execução nativa do plano 01 iniciada. Plano 02 não iniciado. Manter main conforme solicitação anterior; não criar worktree ou fazer commit/push nesta rodada.

## Etapa em andamento — componentes isolados

Criados tipos de módulos, manifesto das cinco capacidades, validador de schemas, registro e política, store JSON atômico, lifecycle, serviço e broker. Criado adaptador SQLite com transação síncrona, rollback e expiração dos handles. Ainda não há inicialização desses componentes no aplicativo, ponte modular Python nem cartões funcionais na UI. Portanto, desligamento modular no produto NÃO está disponível ainda.

TDD: testes novos falharam primeiro pela ausência dos componentes e passaram após implementação. Primeira suíte completa após registro/política: 200 testes aprovados. Onze testes focados atuais aprovados; tipos aprovados. Verificação geral final desta etapa em andamento.

## Pre-flight de interfaces

- Tarefa 1 → 2: registry/policy consomem snapshots e revisões; store guarda apenas enabled/revision, service calcula saúde/autorização em tempo real.
- Tarefa 2 → 3: stop invalida geração antes de aguardar; broker deve ser ligado ao stopper e ao transporte antes de ter efeito no runtime.
- Tarefa 3 → 4: IPC/painel não podem anunciar módulo operacional antes do ack da sessão Python; integração ainda não implementada.
- PowerShell continua ferramenta geral: validação tipada de command não equivale a sandbox.

## Limitações e próxima ação

Os componentes não substituem ou bloqueiam caminhos legados até a etapa de integração. Registry JSON ainda não substituiu TOOLS_SCHEMA Python; não afirmar fonte canônica única concluída. Broker usa deduplicação apenas em memória (máximo 10.000 IDs na instância), timeout do manifesto e espera de limpeza de 1 segundo com relato de incerteza se worker não encerra; não é exactly-once persistente nem rollback de efeitos. O resultado bruto sem verificador permanece unknown, nunca sucesso de objetivo arbitrário.

Próximas tarefas: finalizar revisão/testes dos componentes; implementar ponte negociada e recepção concorrente de controle no Python, impedir bypass em texto/Live/captura automática/workers; integrar estado/IPC/painel; empacotar e executar aceite Windows. Não marcar tarefas 1–4 completas enquanto esses contratos não forem integrados e verificados.

## Revisão independente — correções pendentes de direção

Revisão read-only dos componentes isolados: nenhum achado crítico; dois importantes e um menor. Esta revisão não substitui revisão final da fase completa.

1. Important: atomicWriteJsonSync pode lançar ao remover .bak depois de já substituir o arquivo principal. Reproduzido pelo revisor: setEnabled rejeita, porém a nova revisão já está gravada. Alternativas: corrigir semântica do helper compartilhado (impacta também memória) ou limitar a correção ao armazenamento modular. Aguardar escolha do usuário antes da correção, conforme sua regra de consultar alternativas.
2. Important: seen do broker acumula 10.000 IDs ao longo da vida da instância e depois recusa novas chamadas, inclusive em sessões novas. Requer ciclo de vida de deduplicação por sessão e política de limite sem replay; correção ainda não implementada. Não ocultar esse limite como capacidade pronta.
3. Minor (deferred): validar timeout de manifesto contra máximo de setTimeout (2.147.483.647 ms). Manifesto atual usa valores seguros; manter registrado para próximo ajuste autorizado.

O teste completo não cobre os dois achados; suíte verde não significa componentes aprovados. Bridge/UI continuam sem integração, portanto nenhuma alteração de comportamento de ferramentas foi entregue ao produto nesta rodada. Não concluir a fase nem fazer commit enquanto as correções e a integração estiverem pendentes.

## Correção autorizada — utilitário JSON compartilhado

Usuário escolheu opção 1: corrigir o helper compartilhado em vez de contornar no ModuleStore. Alterado src/main/utils/atomic-json.ts: limpeza do backup fica fora do caminho de rollback; após rename concluído, falha nessa limpeza preserva o backup e emite somente aviso genérico, sem caminho ou dados. Falha antes do commit continua propagada com restauração do documento anterior.

Final: fixed achado importante 1 — test/atomic-json.test.ts reproduziu RED em dois testes com injeção de falha de unlinkSync; após correção, GREEN 3/3. Cobertura inclui pós-commit, falha de rename antes do commit, leitura do documento novo, escrita seguinte e consumidores reais ModuleStore/MemoryStore. npm.cmd run verify aprovado: 210/210 testes, typecheck e build. Permanece aviso conhecido de chunk do renderer acima de 500 kB.

Achado importante 2 (deduplicação do broker) e limite de timeout continuam pendentes; esta correção não altera broker nem liga a base modular ao runtime. Não declarar fundação concluída. Nenhum commit/push realizado.

## Correção autorizada — deduplicação SQLite

Usuário escolheu opção 1 para o broker: reserva durável em SQLite antes de iniciar executor. Criados InvocationStore e migração 002-capability-invocations.sql; removidos Set seen e teto acumulado de 10.000 IDs. O construtor do broker exige o store: não há fallback silencioso para deduplicação volátil.

A chave única é invocationId estável, independentemente da sessão. A reserva é transacional e inclui apenas IDs, sessão/revisão e horário, sem argumentos, comando ou resultado. Reservas são conservadas após falha/cancelamento/crash; não há reexecução automática. Banco indisponível impede o efeito. IDs iguais com argumentos diferentes também são recusados; pedidos com IDs novos mas efeitos equivalentes não são semanticamente deduplicados. IDs deverão ser gerados pelo Main na integração, não derivados de dados privados ou escolhidos pelo LLM. Política de retenção/limpeza ainda não foi decidida; não apagar reservas automaticamente.

StateDatabase suporta migrações incrementais. Antes de v2 em disco, faz snapshot SQLite com VACUUM INTO (inclui dados WAL), com nome único; uma migração que falha retorna ao schema anterior e preserva os dados. Cliente antigo que só conhece v1 rejeita banco v2 em vez de fazer downgrade destrutivo.

Final: fixed achado importante 2 — regressões demonstradas com comportamento antigo (2 falhas) e correção restaurada (3/3 aprovadas). Cobertura: reabertura, sessão nova, reserva sem efeito/ack, dois brokers, duas conexões independentes, 10.001 IDs novos, erro de banco sem dispatch e rollback de migração. Sem promise de exactly-once para sistemas externos.

Verificação adicional no Main real do Electron: scripts/test-electron-sqlite.cjs passou com os adaptadores reais, migração, backup e reserva persistente depois de reabrir. Teste usa somente arquivos temporários e os remove. Teste inicialmente encontrou caminho incorreto do bundle no runner; corrigido para entry names explícitos, sem alteração de comportamento do produto.

Verificação final desta correção: npm.cmd run verify aprovado, 213 testes em 36 suítes, typecheck e build sem falhas; aviso conhecido de tamanho do chunk permanece. Probe Electron com adaptadores reais aprovado. git diff --check aprovado.

Próxima etapa de produto permanece a ponte Python/Live/IPC/painel; nenhum banco de usuário foi inicializado, nenhuma reserva foi apagada e a fase não está concluída. Limite de timeout menor permanece registrado, ainda sem ajuste. Sem commit/push.

Decisões de execução: respeitado main e mantido ledger pedido pelo usuário, sem workspace/commit automáticos que contradigam a regra de preservar estado e aguardar direção sobre alternativas. Fontes novas não acessam dados de produção até bootstrap explicitamente integrado.

## Integração da fundação — 26/10/2026

Esta seção substitui o estado histórico de componentes isolados acima. Bootstrap Main, ponte negociada Python, IPC tipado e painel modular foram integrados. O manifesto JSON fornece o catálogo de produção para texto e Live; captura automática também passa pela autorização Main. Sem negociação/ack atual, o acesso falha fechado. Apenas computer está implementado; os dez módulos futuros permanecem indisponíveis.

O Main cria o banco por instalação, reserva IDs duráveis antes do efeito e valida sessão/revisão. O dispatcher Python recebe controles enquanto o chat aguarda ferramentas. Cancelamento aguarda a limpeza do worker; resultado bruto continua unknown sem verificador. Desativação persiste antes do encerramento e não promete desfazer efeitos externos.

Revisão independente da integração encontrou corrida entre atualizações simultâneas de catálogo: corrigida com ModuleRefreshQueue serializada e teste de regressão. Outro achado importante permanece aberto: a chamada Live conserva as declarações de ferramentas da abertura. Desabilitar bloqueia a execução imediatamente; habilitar requer renovar a chamada. Foi solicitada escolha entre aviso para reconexão manual e reconexão automática; nenhuma dessas políticas foi aplicada sem resposta.

Evidências novas: npm.cmd run verify aprovado (219 testes, 36 suítes, zero falhas; typecheck e build aprovados). npm.cmd run test:python: 58 aprovados. npm.cmd run test:package: 8 aprovados, incluindo handshake e ferramenta somente leitura no executável recompilado. Painel no Electron: MODULE_SETTINGS_PASS; ciclo de microfone: WAKE_LIFECYCLE_PASS. git diff --check sem erros de whitespace. Build mantém aviso conhecido de bundle renderer acima de 500 kB.

Teste de integração stdio usa processo Python real, dispatcher, ponte e worker de telemetria; provedor determinístico somente no teste, sem API externa. Teste do painel usa IPC controlado e comprova rollback visual após falha, estado persistido e rejeição de resposta antiga. Não equivale a teste de chamada Gemini em produção ou inspeção visual completa.

Sidecar recompilado e manifesto regenerado. Empacotamento Windows em validação nesta rodada; não afirmar instalador assinado ou aceite em VM limpa. Plano 02 não iniciado. Sem commit/push.

Atualização de aceite: package:dir:from-build terminou com exit 0; verify:package aprovou o pacote novo. Inspeção direta do ASAR confirmou o manifesto canônico e as migrações 001/002. Primeira chamada de inspeção usou separador POSIX incompatível com a API ASAR no Windows; repetida com path.join, sem mudar produto. scan:secrets aprovou 198 arquivos rastreados (não abrange automaticamente os arquivos novos ainda não rastreados). Isso não comprova assinatura comercial ou instalação em VM limpa.

Pendências menores registradas: limite máximo de timeout no manifesto; timeout de 35 s da espera Python não envia cancelamento explícito ao Main (deadlines normais do executor terminam antes, mas concessão atrasada merece cobertura); retenção das reservas SQLite sem política de limpeza. Não há garantia de exactly-once para efeitos externos. A fase 01 permanece em aceite, sem declaração de conclusão total.

## Decisão aplicada — reconexão manual do Live

Usuário escolheu preservar a chamada e avisar para encerrá-la e iniciá-la novamente após habilitar um módulo. Incluída orientação persistente no painel modular; nenhuma reconexão automática foi adicionada. Desativação continua bloqueando novas execuções imediatamente. O aviso descreve a renovação necessária do catálogo Live, sem alegar atualização da sessão atual.

Teste Electron primeiro falhou com Missing manual Live reconnection guidance; após o texto, MODULE_SETTINGS_PASS. npm.cmd run verify aprovado novamente: 219 testes, zero falhas, typecheck e build aprovados; aviso conhecido de tamanho de bundle permanece. git diff --check sem erros. O pacote Windows validado anteriormente antecede este último ajuste de texto; precisa ser regenerado na próxima rodada de empacotamento. Sem commit/push. Próximo passo: fechar os itens restantes de aceite da fase 01; só depois iniciar o plano 02 mediante autorização.

## Aceite local atualizado — pacote e bloqueio integral

Pacote regenerado após o aviso aprovado: package:dir:from-build exit 0. verify:package aprovou integridade/fuses e manifesto do sidecar. smoke:packaged aprovou em perfil temporário com PATH sanitizado, gerando screenshot; inspeção visual confirmou a tela de ativação com lease 72 h. Nenhuma chave de cliente foi usada ou máquina desvinculada. Esse smoke cobre inicialização bloqueada por licença; não cobre operação licenciada completa.

Adicionado teste de aceite no broker para TODAS as capacidades do manifesto: run_powershell, get_system_telemetry, gui_action, control_system_volume e capture_screen_base64. Com computer desabilitado, todas retornam module_unavailable e nenhum executor é acionado, mesmo com permissões presentes e argumentos válidos. Não é implementação nova: é ampliação da evidência do bloqueio existente. npm.cmd run verify: 220 testes aprovados, zero falhas, typecheck e build aprovados; permanece apenas aviso conhecido de tamanho de bundle.

Scanner de segredos executado também sobre arquivos novos não ignorados, usando a mesma lógica do script com listagem git ampliada em memória, sem editar scanner ou index: 255 arquivos examinados, zero achados. A mensagem original do scanner diz tracked, mas essa execução incluiu --others --exclude-standard.

### Matriz de evidência e limites

| Contrato | Evidência local | Limite |
| --- | --- | --- |
| Registro, schemas e política | Suíte TS; cinco capacidades bloqueadas antes do executor | Shell autorizado continua geral |
| Persistência, migração e dedup | Testes SQLite e probe Electron registrados acima | Sem retenção automática ou exactly-once externo |
| Texto e captura automática | Testes runtime e stdio com worker real de telemetria | Provedor determinístico no teste |
| Live, catálogo e interrupção | Suíte Python Live/bridge, controles e cancelamento | Não testado com chamada Gemini real nesta rodada |
| Painel e aviso manual | MODULE_SETTINGS_PASS, falha de escrita e resposta tardia | Sem inspeção visual completa de todas as larguras |
| Distribuição local | Pacote novo, verify:package e smoke:packaged aprovados | Sem instalação assinada/atualização em VM limpa |

Validação local desta rodada concluída; não converter os limites acima em aceite comercial completo. Revisão independente anterior e suas correções estão registradas; pendências menores continuam diferidas. Plano 02 não iniciado; nenhum commit/push. Próximo gate: teste de operação licenciada/texto/Live no produto e aprovação para avançar ao orquestrador.

## Aceite licenciado real — falha reproduzida, avanço bloqueado

Teste solicitado pelo usuário executado no binário release/win-unpacked/Jasper AI.exe, perfil existente jasper-avatar, via APIs públicas normais do preload. Driver temporário .superpowers/licensed-acceptance.cjs usa depuração somente loopback, encerra aplicativo/conexão ao terminar e não imprime credenciais nem conteúdo de conversa. Não houve ativação nova ou liberação de máquina. Licença real unlocked, consentimento autorizado, computer habilitado e connectAgent success confirmados.

IMPORTANTE: o primeiro driver considerava qualquer evento de texto como sucesso. Os 89 caracteres recebidos eram uma mensagem de falha do provedor, não a resposta esperada. Esse resultado inicial NÃO comprova funcionamento do chat. Critério corrigido para exigir TESTE OK; nova execução reprovou corretamente. Não confundir latência da mensagem de erro com latência de inferência.

Com catálogo habilitado: texto retorna erro gemini/service HTTP 400, ClientError, em cerca de 0,5 s; Live start falha com mensagem genérica de recusa Gemini. Para isolamento, computer foi desabilitado temporariamente pela API normal (com revisão atual), sem modificar o manifesto. Sem ferramentas: Live conectou e recebeu evento de áudio da saudação real em 5.689 ms; texto retornou gemini/network HTTP 503 ServerError (não aprovado). computer foi restaurado a enabled=true no finally, confirmado pelo driver. Revisão incrementou normalmente nas duas gravações; histórico do teste pode permanecer na memória da conversa.

Hipótese principal: schema canônico passado diretamente no campo parameters não é compatível com a superfície Schema do Gemini. ModuleBridge.tools fornece inputSchema incluindo additionalProperties; adaptadores texto e Live repassam sem projeção. A documentação oficial distingue parameters (subset OpenAPI) de parametersJsonSchema (JSON Schema): https://ai.google.dev/gemini-api/docs/function-calling e https://googleapis.github.io/js-genai/release_docs/interfaces/types.FunctionDeclaration.html . O modelo gemini-3.8-live existe na documentação oficial: https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live . Nenhuma troca de modelo justificada nesta rodada. Ainda falta capturar detalhe seguro do HTTP 400 ou provar a hipótese por teste de request compatível; não declarar causa exata confirmada apenas pela mensagem genérica.

Próxima decisão a apresentar antes de corrigir: (1) projeção Gemini compartilhada para Schema compatível, preservando validação estrita no Main e catálogo canônico; (2) enviar parameters_json_schema, após verificar suporte no SDK/Live instalado. Preferência técnica: opção 1, menor dependência da superfície JSON Schema no Live. Não alterar código de produção antes da escolha, conforme regra do usuário sobre alternativas. Depois: regressão RED/GREEN nos dois adaptadores, rebuild/package e reteste real; investigar 503 separadamente se persistir. Não iniciar plano 02 enquanto esse gate estiver reprovado.

## Correção autorizada — opção 1, projeção Gemini

Usuário escolheu 1. Criado gemini_tools.py, compartilhado por GeminiAdapter e LiveCall. Remove additionalProperties apenas das posições de schema (inclusive properties/items), com cópia profunda; preserva nome de propriedade chamado additionalProperties, enum, required, limites numéricos e catálogo original. Main continua validando schema canônico estrito. Groq/Ollama não usam essa projeção. Não trocar modelo, chave ou política de consentimento.

TDD: dois testes novos nos adaptadores texto/Live falharam antes da implementação por envio de additionalProperties; depois passaram, com 60/60 testes Python aprovados. Rebuild sidecar e reteste licenciado ainda em andamento; não assumir que suítе local prova resolução da resposta HTTP real.

### Resultado da correção e reteste real

Sidecar recompilado (PyInstaller exit 0), manifesto regenerado e package:dir:from-build concluído. verify:package aprovou o pacote novo. npm.cmd run verify aprovou typecheck/build e 220/220 testes TS; 60/60 Python e 8/8 de artefato aprovados. git diff --check sem erros; aviso de bundle >500 kB permanece.

No aplicativo real corrigido: licença unlocked, computer enabled/authorized e connectAgent success. Live com o catálogo completo abriu e emitiu áudio real da saudação em 3.021 ms (antes da projeção, a abertura falhava). Esse teste comprova conexão e áudio de saída; não comprova fala do microfone, barge-in real nem execução das cinco ferramentas durante uma chamada. O driver não captura nem envia áudio do microfone.

Texto com catálogo corrigido não recebeu HTTP 400: recebeu HTTP 503 ServerError, categoria gemini/network, em 567 ms. Uma repetição controlada somente de texto recebeu novamente HTTP 503, em 997 ms. Ambas falharam na exigência TESTE OK; NÃO declarar chat aprovado. A mudança de 400 para 503 e o Live funcional sustentam a correção de compatibilidade; não demonstram causa/solução do 503. Modelo/chave não foram alterados, módulo permaneceu habilitado e aplicativo/depuração temporária foram encerrados. Sem commit/push.

Próxima ação recomendada: diagnóstico separado do HTTP 503 do chat, com erro seguro e comparação mínima de requisição ao mesmo modelo; consultar usuário antes de escolher fallback/troca de modelo/retry automático ou outra alternativa de implementação. Aceite completo da fase 01 e início de 02 permanecem pendentes.
