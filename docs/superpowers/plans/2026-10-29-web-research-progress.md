# Pesquisa web — decisões e continuidade

**Atualização:** 30/10/2026. **Estado:** entrega local HTTP01–04 concluída e verificada. Navegador adiado por decisão explícita; gate antigo permanece reprovado. CI/Node24 e aceite manual no aplicativo licenciado continuam separados. Sem instalador, commit ou push nesta retomada.

## Intenção e contexto

Usuário pediu avançar para Pesquisa web após execução direta e limpeza seletiva do desktop. Reutilizar ModuleBridge, execução no Main e switch `web-research` existente nos tipos/UI. Não restaurar Planner/execute_task. Código, licença72h, Total Control, Gmail e demais módulos preservados. Documentos continua adiado, sem novo instalador, commit, push ou deploy.

## Verificação inicial

Roteiro08 existente é preliminar. Não há executor web/browser/search no Main atual nem capacidades web no manifesto. O pacote já possui html-to-text10.0.1; isso oferece extração básica, não busca nem prova de leitura segura. Serviço de busca e renderização JavaScript continuam decisões abertas do roteiro D6.

## Ordem de desenho

- [x] Consultar roteiro e arquitetura atual.
- [x] Confirmar integração futura por chamadas diretas ao Main, sem orquestrador de planos.
- [x] Usuário escolheu opção2: busca sem chave adicional de API. Não contratar serviço nem exigir cadastro de busca do cliente nesta fase; hospedagem própria não foi escolhida.
- [x] Usuário escolheu opção1: HTTP e navegador isolado em segundo plano quando necessário para JavaScript; não confundir leitura com preencher formulários ou executar ações em sites.
- [x] Consolidar desenho e submeter à revisão do usuário: [especificação29/10](../specs/2026-10-29-web-research-design.md). Aguardar revisão antes dos planos executivos.
- [x] Separar planos executivos no [mapa00](2026-10-29-web-research-00-execution-map.md); aguardar revisão/aprovação antes de código.

## Direção inicial proposta, ainda ajustável

Pesquisar assuntos e ler páginas públicas, sintetizando resultados com URLs e datas quando disponíveis. Não habilitar login/formulários nesta primeira proposta sem decisão de escopo. Escolher uma biblioteca/serviço existente em vez de construir um mecanismo de indexação da internet. Não anunciar método sem chave como equivalente a uma API oficial nem garantir disponibilidade irrestrita de instâncias públicas.

Preservar conteúdo remoto como dados não confiáveis. O desenho deverá limitar tamanhos, timeouts e redirects, impedir destinos privados/loopback/metadata por busca/leitura e revalidar licença/módulo antes de entregar resultados. Nenhuma chave ou dependência instalada nesta rodada.

## Decisão recebida — busca sem chave

Escolha explícita do usuário: `2`. Preservar essa decisão ao comparar bibliotecas ou implementação HTTP/browser. Disponibilidade dos buscadores continua sujeita a bloqueios e mudanças; sem garantia de funcionamento irrestrito. Não trocar silenciosamente para API paga como fallback.

Decisão posterior recebida: opção1, HTTP com navegador isolado quando JavaScript for necessário. Reaproveitar Chromium do Electron é a direção proposta; não instalar outro navegador. DDGS foi apenas investigado, não selecionado. Sem biblioteca nova, servidor, consulta operacional a buscador ou execução de páginas remotas nesta rodada. Fontes consultadas: https://www.electronjs.org/docs/latest/api/browser-window e https://github.com/deedy5/ddgs.

## Proposta funcional para aprovação

- Pesquisa de assuntos e leitura de URLs públicas, com síntese no modelo já escolhido para chat/Live e fontes identificadas.
- Busca inicial proposta: interface HTML pública do DuckDuckGo; existência documentada oficialmente, mas sem alegar API oficial, disponibilidade garantida ou aprovação do uso automatizado pelo operador do buscador. Provedor/extração sujeitos a validação no plano; nenhum fallback pago silencioso.
- HTTP primeiro; Chromium isolado para páginas dependentes de JavaScript, sem janela visível, cookies pessoais, acesso Node/preload do Jasper ou sessões Google do usuário.
- Metadados: título, URL final, horário da consulta, data de publicação quando existir e sinalização de conteúdo parcial. Data ausente não será inventada; snippet de busca não equivale a leitura da página.
- CAPTCHAs, login, paywall ou limitação do buscador devem resultar em limite explícito; não contornar nem entrar em tentativas repetidas.
- Conteúdo remoto não autoriza efeitos. Mantidos consentimento geral Total Control e licença; sem novas confirmações por consulta. Leitura não inclui formulários, compras ou contas autenticadas.
- Proposta inicial de somente memória temporária substituída pela decisão posterior: histórico local das dez últimas pesquisas, com pergunta, resumo, fontes e texto limitado, exclusão da mais antiga ao incluir a11ª e botão de limpeza.

Fontes técnicas adicionais: https://duckduckgo.com/duckduckgo-help-pages/features/non-javascript, https://www.electronjs.org/docs/latest/api/protocol, https://www.electronjs.org/docs/latest/api/session e https://www.electronjs.org/docs/latest/tutorial/security.

Ponto obrigatório do desenho técnico: ocultar uma janela ou usar sandbox não impede acesso à rede local. A renderização precisa de mediação de rede que bloqueie destinos privados em redirects e sub-recursos, inclusive DNS rebinding, sem abrir portas locais ou alterar a sessão principal. Viabilidade e testes dessa barreira devem anteceder a habilitação de JavaScript remoto; não prometer segurança baseada apenas em inspeção da URL inicial.

## Histórico aprovado e especificação escrita

Usuário respondeu “ok” à proposta das dez pesquisas. Desenho escrito inclui retenção local, associação explícita entre busca/páginas/resumo, cifragem via proteção existente, controle concorrente e apresentação de data para não tratar pesquisa antiga como atual. Limites e detalhes técnicos são propostas da especificação e aguardam revisão; não foram tratados como autorização de código.

Usuário respondeu “prossiga” à revisão da especificação. Próximo gate passou a ser revisar/aprovar os quatro planos executivos. Nenhum teste de produto, dependência, migração, consulta real do buscador ou executável criado nesta atividade.

## Planos executivos escritos — 29/10/2026

1. [Rede e busca](2026-10-29-web-research-01-network-search.md): URL/DNS/conexão fixada, budgets, parser DuckDuckGo e duas dependências existentes promovidas a diretas, sem instalação nesta rodada.
2. [Leitor e navegador](2026-10-29-web-research-02-reader-browser.md): extração, HTTP e prova do isolamento em Electron real antes de habilitar JavaScript remoto.
3. [Histórico](2026-10-29-web-research-03-history.md): migração009, cifragem, retenção10/páginas3, limpeza concorrente e recibos de resumo.
4. [Integração e aceite](2026-10-29-web-research-04-integration.md): Main/catálogo, feature flag, Python/Live sem Planner, IPC/UI e fontes, testes integrados e revisão final.

[Mapa00](2026-10-29-web-research-00-execution-map.md) fixa os DTOs, métodos, limites e permissões entre etapas. Auto-revisão corrigiu direção de imports (shared nunca importa Main), assinatura das APIs, compatibilidade com sidecar antigo, associação de páginas somente a pesquisa ativa da sessão e distinção entre histórico indisponível e vazio. Sem agentes de implementação/revisão disparados para esta rodada documental.

Método nativo/main já escolhido é preservado; não perguntar novamente método ou autorização por operação. Aprovação da especificação não foi tratada como aprovação dos planos ainda não revisados. Não iniciar03 antes do gate real02 para cumprir a ordem estabelecida e evitar anunciar navegador não comprovado. Progresso e alterações anteriores preservados, sem commit/push.

## Execução01 concluída — 29/10/2026

Usuário aprovou os planos com “sim”. Rede e busca implementadas no escopo01, preservando o restante do checkout. Método nativo/main e ausência de commit/push/instalador mantidos.

### Entrega

- `src/main/modules/web-research/network-policy.ts`: política conservadora IANA, URL canônica, DNS com todos os endereços validados, deadline/cancelamento e endereço aprovado fixado.
- `http-client.ts`: HTTP/HTTPS GET/HEAD, socket conferido antes de enviar headers, TLS com hostname original, sem cookies/proxy ambiente/retry, redirects manuais e limites de bytes transferidos/descomprimidos.
- `html.ts` e `search.ts`: parser estrutural da interface HTML DuckDuckGo; cinco resultados orgânicos/únicos, query limitada, metadados limitados, charset explícito; diferencia vazio reconhecido, bloqueio, rate limit e layout desconhecido. Resultados não são visitados durante a busca.
- Contracts internos e DTOs compartilhados com direção de importação correta. `htmlparser2@10.1.0` e `domutils@3.2.2` promovidos a dependências diretas a partir do cache offline, nas versões já instaladas; licenças distribuídas copiadas. Alteração anterior de systeminformation não pertence a esta fase.

### Evidências

- RED→GREEN das três tarefas: módulos ausentes, depois política5/5, HTTP7/7 e domínio inicial18/18. Após fixpass de Unicode, domínio19/19.
- `npm.cmd run verify` final: **394/394 testes**, sem skipped/falhas, typecheck e build dev exit0 (`verify-final.log`). Bundle renderer>500KiB continua aviso preexistente, sem alteração oportunista.
- `npm.cmd run audit:runtime`: **0 vulnerabilidades de produção**. Não equivale a audit total das dependências de desenvolvimento.
- `node scripts/scan-secrets.mjs --include-untracked`: **505 arquivos** sem achados; diff check sem erros.
- Uma revisão independente, nenhum Critical/Important confirmado. Dois Minors de Unicode reproduzidos RED e corrigidos: URL pós-percent-encoding também respeita4.096 e consulta após NFC respeita500. Sem segunda revisão alegada.
- Primeira suíte geral apresentou timeout do harness email-ui apesar de EMAIL_UI_PASS. Isolado1/1 passou sem mudança no código; repetição geral394/394 passou. Causa do timeout não comprovada, não anunciar correção de e-mail. Logs inicial/isolado/final preservados.

### Limites e retomada

Rede, DNS, respostas HTML e sockets dos testes são sintéticos. Não foi consultado o buscador real nem demonstrada interoperabilidade com servidor HTTP/TLS público nesta fase. Não confundir fixture de HTML com garantia de estabilidade do DuckDuckGo.

Node local26.8.2/npm11.19.1 fora da engine24: não afirmar validação Node24/CI. Sem mudança de engine para ocultar o aviso. Nenhuma migração009, capability web, UI/histórico ou navegador foi implementado ainda; o switch permanece planejado.

Ledger e logs: `.superpowers/sdd/2026-10-29-web-research-01-network-search/`. Próxima etapa: plano02, leitor/extração e gate de contenção no Electron real, sem novo cadastro externo ou instalador. Não iniciar03 antes desse gate nem restaurar Planner/execute_task.

Fontes consultadas para a política: https://www.iana.org/assignments/iana-ipv4-special-registry e https://www.iana.org/assignments/iana-ipv6-special-registry, publicação indicada2025-10-09. Conjuntos aprovados são conservadores e também bloqueiam alguns usos especiais globalmente roteáveis.

## Execução02 parcial — 29/10/2026

Usuário autorizou prosseguir. Task1/extrator implementada RED→GREEN,5/5. Domínio web acumulado24/24 passou; typecheck exit0; scanner514 arquivos aprovados e diff sem erros. Não houve repetição da suíte geral nem build para anunciar02 como pronta: existe gate real reprovado, não um erro a esconder com checks de fonte.

Task2 executou prova real no Electron44.4/Chromium152. Barreiras de protocolo/CSP/Connection-Allowlist no caminho avaliado não comprovaram contenção de canais nativos; deny-all do cabeçalho foi ignorado no documento interceptado. Script reproduzível `node scripts/test-web-browser.cjs` termina exit1. [Evidência, limites e alternativas](2026-10-29-web-browser-gate.md). Não afirmar que houve exploração ou tráfego privado demonstrado.

Task3/leitor composto e etapas03/04 não iniciados, conforme gate aprovado. Sem renderer remoto habilitado, alteração de flags do produto, novo instalador, commit/push ou API real. Ledger02 e relatórios mantidos para continuidade. Escolha necessária: HTTP inicialmente com JS explicitamente adiado, ou redesenhar contenção do navegador antes da integração.
Revisão independente da etapa02: corrigido fallback de data de publicação (time exige datePublished/pubdate), com regressão RED/GREEN. Resultado então:25/25 testes web e typecheck0. A decisão posterior de escopo está registrada abaixo.

## Retomada nesta máquina — 29/10/2026

Usuário escolheu explicitamente: **entregar busca e leitura HTTP primeiro e adiar sites que exigem JavaScript**. Essa decisão substitui a exigência de concluir o navegador antes de03/04 para a entrega HTTP. O gate antigo continua reprovado; não foi convertido em aprovação nem removido. Nenhum renderer remoto será habilitado nesta entrega.

`DefaultWebReader` implementado com transporte seguro01, extração02, teto HTTP8s dentro do prazo externo, texto48KiB UTF-8, URL final observada e revalidação de autoridade. `auto` usa somente HTTP; `browser` retorna `render_unavailable` sem rede; shell JavaScript retorna a mesma limitação explícita. Texto simples permanece literal, sem interpretar marcação. Sem retry/fallback em CAPTCHA,403,429 ou binário.

Verificação inicial encontrou dependências do lockfile ausentes nesta máquina; sincronização com `npm ci --ignore-scripts` em andamento. Testes do leitor e repetição dos testes web pendentes, sem anunciar integração ou histórico concluídos.

### Resultado da retomada HTTP

- Leitor HTTP validado: **31/31 testes web**, incluindo seis testes novos do leitor (artigo curto/texto literal, modo browser sem rede/shell JS,403/429/paywall/binário, URL privada/revogação, Unicode/deadline e cancelamento).
- Verificação geral em **Node24.22.1**: typecheck passou, **406/406 testes**, nenhum skipped/falha, build Main/preload/renderer concluído. O aviso preexistente de chunk renderer>500KiB permanece. PowerShell apresentou NativeCommandError ao redirecionar esse warning; o log registra todos os testes aprovados e os três builds concluídos, sem alegar exit0 do invólucro PowerShell.
- Dependências sincronizadas:555 pacotes. Corrigidas188 URLs huaweicloud no lockfile para tarballs oficiais npm; comparação estrutural com HEAD confirmou **somente URLs**, versões/integridades preservadas (`LOCKFILE_URL_ONLY_PASS`). Primeiras tentativas tiveram ECONNRESET/timeouts e remapeamento de host insuficiente; a instalação normalizada terminou com npm exit0.
- Audit de produção: **zero vulnerabilidades**. Audit total da instalação: cinco de desenvolvimento (uma moderate/quatro high), sem npm audit fix automático. Scanner517 arquivos sem achados e diff check sem erros.
- Electron local preparado explicitamente após instalação sem scripts. Sem release/instalador/commit/push, nenhuma consulta operacional a buscador ou página real nesta etapa; respostas dos testes são sintéticas.

**Estado atual:** extração e leitor HTTP concluídos no escopo aprovado; navegador adiado e gate antigo permanece FAILED. Histórico03 e integração04 ainda pendentes; módulo não publicado. Próximo passo: codec/histórico cifrado03, seguindo contratos e requisitos de retenção/concorrência já aprovados. Logs desta retomada: `.cache/web-research-{tests,typecheck,verify}.log`, `.cache/web-research-audit.json` e `.cache/web-research-install-normalized.log`.

## Execução03 concluída — 30/10/2026

Retomado o commit `1e5373c` da outra máquina, com árvore inicialmente limpa. Preservada a decisão HTTP primeiro, sem tentar habilitar novamente o navegador. Implementação nativa na main conforme preferência anterior; sem commit/push ou instalador nesta retomada.

### Entrega do domínio

- DTOs de histórico/recibos adicionados em shared, sem imports Main/Electron.
- `history-codec.ts`: envelope estrito versão1, limites antes/depois de cifrar, texto48KiB/página, payload256KiB, ciphertext de entrada512KiB, erros sem detalhes privados. Proteção indisponível nunca vira persistência plaintext.
- Migração aditiva `009-web-research.sql` e `history-store.ts`: retenção de10 por sequência de criação,3 páginas distintas, substituição por URL final e corte em fronteira Unicode conforme orçamento JSON real. Inserção/poda atômicas; geração invalida callbacks após limpeza, sem recriar linhas removidas. Falhas de proteção/SQL/corrupção preservam dados anteriores e distinguem histórico indisponível de vazio.
- Reservado orçamento do pior resumo escapado antes de armazenar páginas; aceitar o resumo não precisa reduzir conteúdo de fonte já guardado. Resumo altera apenas summary/summaryState, mantendo estado de execução e fontes.
- `summary-receipts.ts`: tickets aleatórios32bytes/64hex,5min, máximo30, uso único, vínculo a pesquisa/geração/sessão, autoridade revalidada. Revogação observada invalida definitivamente os tickets, inclusive após restauração da autoridade. Falha de escrita consome o recibo, sem repetição automática.

### Verificação e revisão

- RED por módulo ausente nas três tarefas, depois GREEN; regressão de resumo sob limite serializado detectou alteração indevida de texto e levou à reserva de orçamento. Outra regressão detectou estado saved incorreto para histórico vazio sem proteção, corrigido.
- Revisão independente única do conjunto03 encontrou um Important: recibo rejeitado por revogação voltava a valer após restaurar autorização. Reproduzido RED, corrigido, domínio web final **44/44**. Nenhum Critical/Minor adicional reportado; sem alegar segunda revisão.
- `npm run verify`: **419/419 testes**,0 falhas/skipped, typecheck e builds Main/preload/renderer aprovados, exit0. Aviso preexistente de renderer707KiB permanece. Node local **26.8.2**, fora da engine24; não confundir com validação Node24 feita anteriormente no outro PC.
- Scanner de segredos: **525 arquivos** sem achados antes desta atualização documental; diff check sem erros. Nenhuma consulta operacional ao buscador nesta etapa; testes usam rede sintética e bancos temporários.

### Limites e próxima etapa

Testes de codec usam proteção reversível fake para verificar o contrato, não demonstram DPAPI real. Composição safeStorage, migração no banco do aplicativo, fallback volátil, autorização da fachada, descarte de recibos na desconexão/revisão de módulo, catálogo, IPC, chat/Live e painel pertencem ao **plano04**. O Main de produção ainda não aplica009 nem publica capacidades web; perfil real não foi aberto pelos testes.

Se a proteção falhar, begin não poda dados antigos; limpeza explícita continua possível sem decriptar, respeitando geração. Modo volátil será implementado na fachada04, nunca como plaintext na tabela. Não restaurar Planner nem usar o gate reprovado como aprovação de JavaScript.

Ponto de retomada: [integração04](2026-10-29-web-research-04-integration.md). Evidências locais/ledger: `.superpowers/sdd/2026-10-29-web-research-03-history/`, incluindo verify.log, web-tests.log, review-red.log e review-green.log. Esses logs são ignorados pelo Git; este registro e os testes de fonte preservam as conclusões para outra máquina.

## Execução04 — 30/10/2026

### Integração entregue para verificação

- `WebResearchService` conecta busca/leitura/histórico com autoridade antes e depois dos awaits, escopo de cancelamento/deadline, associação ativa de cinco minutos por sessão/revisão/geração e provas exatas observadas no Main. Limpeza/stop invalidam solicitações/recibos. Backend antigo não recebe catálogo web sem `webResearchRuntimeVersion:1`.
- Main compõe proteção safeStorage, transporte seguro, migração009 e executor `web-research`; lifecycle, desconexão, licença, shutdown e restauração ligados ao módulo existente. A migração será aplicada ao iniciar a composição do aplicativo; os testes não abriram o perfil real.
- Falha de proteção antes ou durante rede mantém o resultado em memória temporária limitada, identificado como volátil, sem alterar ciphertext anterior nem promover o registro quando a proteção volta. Perda durante fetch foi reproduzida RED e corrigida: o retorno não afirma mais saved quando a atualização falhou.
- `web_research_notes.py`, protocolo direcional e feature1 ligados ao chat e Live. Recibos são removidos antes do modelo, mensagens conversacionais e eventos visuais; último recibo por pesquisa/rodada recebe o texto final sem chamada extra à IA. Live captura o ID da rodada ao agendar ferramenta e descarta resultados de rodadas interrompidas/antigas.
- IPC exige guard existente e frame principal da janela confiável; abrir fonte exige URL HTTP/HTTPS sem credenciais, permitida pela política e pertencente ao registro. Gestão local mantém licença/Total Control mesmo com switch desligado; testar rede exige módulo ativo. LOCKED_ALLOWED_CHANNELS não foi ampliado.
- Painel em Sistema & Automação: explicação HTTP/sem chave, teste manual, dez pesquisas, detalhe em texto e limpeza. HUD mostra links obtidos no Main. HTML remoto não vira innerHTML. Abrir painel/diagnosticar não consulta o buscador. Chamadas abertas continuam exigindo reinício para habilitar ferramentas novas.

### Revisão e evidências já observadas

- Uma revisão independente final do conjunto04: nenhum Critical/Important concreto. Dois Minors corrigidos em um fixpass RED→GREEN: cancelamento autorizado encerra o registro salvo; detalhe aberto é removido quando a pesquisa sai da lista na11ª inclusão. Cancelar após revogação/clear/stop não autoriza escrita tardia. Não alegar segunda revisão.
- `web-stdio.test.ts` usa protocolo, ModuleRuntimeBridge, verificador e runtime Python reais com modelo/transporte sintéticos: busca→leitura→resumo protegido e recuperação histórica sem rede; sem Planner/task_event/shell/e-mail. O primeiro teste de aceite passou com a integração já ligada; não alegar RED inexistente dessa fixture.
- `scripts/test-web-ui.cjs`: Electron instalado, janela oculta e perfil temporário, rede pública bloqueada, estados de histórico, HTML malicioso, links inválidos, limpeza e11ª inclusão. WEB_UI_PASS; screenshot do painel inspecionada. Não substitui teste de licença/proteção Windows em perfil real.
- Python completo: **104/104**. Verify inicial: **430/430**, typecheck/build dev exit0, incluindo perda de proteção durante fetch (confirmado no log); anterior aos dois ajustes da revisão. Verify final após o fixpass: **431/431**,0 falhas/skipped, typecheck e builds Main/preload/renderer exit0. Aviso preexistente de chunk renderer continua, agora com712,87KiB aproximados no resumo do bundler.
- Audit runtime: **0 vulnerabilidades**; scanner após implementação/documentação: **546 arquivos**, sem achados; diff check sem erros. Sem dependências novas nesta etapa. Node local26.8.2 continua fora da engine24; CI/Node24 não validado nesta máquina.

### Aceite público separado

Executado uma vez com o transporte real do projeto em **30/10/2026,09:39:41 de Brasília** (`2026-10-30T12:39:41.639Z`): consulta “Electron documentation” em DuckDuckGo retornou estado ok e cinco URLs. Leitura HTTP de `https://www.electronjs.org/docs/latest/` retornou ok,3658bytes de texto extraído. Sem dados pessoais, credenciais, perfil, proxy ou login. O primeiro build do harness tinha caminhos relativos incorretos e não fez rede; corrigido antes da consulta. Não houve retry automático nem contorno de bloqueio.

Resultado é pontual, não garantia de disponibilidade do buscador/sites. Gate do navegador antigo permanece FAILED e não foi reexecutado como se devesse passar: a emenda aprovada entrega HTTP e adia JavaScript. Não há navegador remoto de produção ou novas portas locais.

### Retomada

Entrega local concluída. Para testar no produto, reinicie o aplicativo/backend, ative Pesquisa web em Sistema & Automação e conecte o agente; reinicie chamadas que já estavam abertas. Use o teste manual ou peça busca e leitura de uma fonte. Não aplicar resultados de perfil sintético como aceite da licença/DPAPI pessoais. CI/Node24 e aceite manual no aplicativo licenciado ainda não executados nesta retomada; sem teste de embalagem/instalador.

[Guia de uso](../../web-research-setup.md). Logs locais em `.superpowers/sdd/2026-10-29-web-research-04-integration/`: verify-initial/final, python-tests, web-tests, audit, public-probe e review-red/green-service; screenshot web-panel.png. Esses arquivos são ignorados pelo Git; conclusões acima e testes de fonte são o registro portátil.

Sem novo instalador/commit/push. Gmail, licença72h, Total Control e demais módulos preservados. Documentos, Outlook e JavaScript continuam adiados. Confirmar direção com o usuário antes de iniciar outro módulo.
