# Pesquisa web — decisões e continuidade

**Data:** 29/10/2026. **Estado:** etapa01 concluída; extração02 pronta, gate de navegador02 não aprovado. Aguardar decisão de escopo/arquitetura; etapas03–04 não iniciadas, módulo ainda não publicado.

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
`nRevisao independente da etapa02: corrigido fallback de data de publicacao (time exige datePublished/pubdate), com regressao RED/GREEN. Resultado atualizado:25/25 testes web e typecheck0. Gate de navegador segue nao aprovado; aguarda decisao documentada em 2026-10-29-web-browser-gate.md.
