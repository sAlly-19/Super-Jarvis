# Pesquisa web01 — rede e busca

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans, método nativo já escolhido. Implementar task-by-task com aprovação recebida; TDD e verificação antes de conclusão.

**Goal:** Obter resultados públicos sem chave, com rede limitada e erros distintos de busca vazia.
**Architecture:** Main usa transporte HTTP próprio e parser de HTML existente. DNS aprovado fica fixado na conexão; não existe executor Python de rede.
**Tech Stack:** Node24/Electron44, TypeScript, node:http/https/dns/net/zlib, htmlparser2/domutils/html-to-text.
**Spec:** [desenho](../specs/2026-10-29-web-research-design.md). **Contratos:** [mapa00](2026-10-29-web-research-00-execution-map.md).

## Global Constraints

Todas as restrições do mapa00. Nesta fase: URL4.096, query500, resultados5, redirects5, transferência2MiB e descompressão2MiB, busca15s. Sem consultas públicas automáticas, cookies, credenciais, proxy ambiente, repetição ou fallback pago. Módulo não publicado ainda. Sem commits ou instalador.

## Review Focus

1. URL com IPv4 numérico alternativo, IPv6 mapped ou userinfo não alcança destino privado — Task1.
2. DNS misto público/privado ou troca de DNS entre validação/conexão não contorna a política — Tasks1/2.
3. Redirect para rede privada e resposta comprimida excessiva encerram a requisição — Task2.
4. Layout/CAPTCHA/status429 não viram “nenhum resultado” — Task3.
5. Licença revogada/cancelamento após DNS ou recebimento não devolve conteúdo tardio — Tasks1/2/3.

## Task1 — política de URL e DNS

**Files:** criar contracts.ts e network-policy.ts em src/main/modules/web-research/, src/shared/types/web-research.ts; exportar DTOs em src/shared/index.ts; teste test/web-network-policy.test.ts.
**Interfaces:** produzir WebScope/WebCode do mapa00; `WebNetworkPolicy` com constructor(deps:{resolve:(hostname:string)=>Promise<Array<{address:string,family:4|6}>>}), `approve(raw:string,scope:WebScope):Promise<{url:string,address:string,family:4|6}>`, `validateUrl(raw:string):URL`. Instância de produção injeta dns.lookup(all:true).

- [x] RED: `rejects_nonpublic_and_ambiguous_urls` deve rejeitar localhost/127.1/0x7f000001/IPv6loopback/IPv4mapped/zone IDs/userinfo/porta8080/file/data/URL>4.096 antes de dial; URL pública canônica aceita.
- [x] RED: `rejects_mixed_dns_and_cancelled_scope` usa respostas mistas e check revogado após await; assert.rejects sem retorno aprovado. Rodar `node scripts/run-tests.mjs web-network-policy`; observar falha por código ausente.
- [x] GREEN: implementar com WHATWG URL, net.isIP e net.BlockList, sem parser IP artesanal ou regex de IPv6. IPv4 bloqueia 0/8,10/8,100.64/10,127/8,169.254/16,172.16/12,192.0.0/24,192.0.2/24,192.31.196/24,192.52.193/24,192.88.99/24,192.168/16,192.175.48/24,198.18/15,198.51.100/24,203.0.113/24,224/4 e240/4. IPv6 permite somente2000::/3 e exclui2001::/23,2001:db8::/32,2002::/16,2620:4f:8000::/48,3fff::/20. Verificar tabela IANA vigente antes de fixar os conjuntos; divergência que altere destinos suportados requer registro, nunca liberar redes privadas para fazer teste passar.
- [x] GREEN: normalizar host/porta, negar .localhost/.local/.internal, validar todos os IPs retornados, rejeitar lista vazia/inválida/mais64 endereços. Revalidar scope após DNS. Rodar o mesmo teste; PASS. Registrar limites da política e arquivos, sem commit.

## Task2 — transporte com conexão fixada

**Files:** criar src/main/modules/web-research/http-client.ts; teste test/web-http-client.test.ts.
**Interfaces:** consumir WebNetworkPolicy/WebScope; produzir `SafeWebHttpClient` implementando WebTransport, com deps de política, clock e request HTTP injetáveis. Driver produção usa node:http/https; driver de teste simula socket/stream sem internet. deadline é o mesmo entre redirects.

- [x] RED: `pins_dns_and_preserves_tls_hostname` captura options reais de request: lookup retorna somente IP aprovado, agent:false, hostname/Host/servername originais, verificação TLS ativa, nenhuma chamada DNS adicional ou cabeçalho Cookie/Authorization. `redirect_private_never_dials` confirma zero dial no segundo destino.
- [x] RED: testar 5 redirects aceitos/6º recusado, loop, Location inválido, 2MiB+1 transferido, gzip/br/deflate expandido>2MiB, charset inválido e stream interrompido. `revoked_scope_destroys_socket_and_discards_data` verifica destroy e ausência de retorno. Rodar `node scripts/run-tests.mjs web-http-client`; observar RED.
- [x] GREEN: implementar fetch GET/HEAD, redirects manuais301/302/303/307/308, sem retry. Usar lookup fixado e agent:false para não herdar proxy/pool global; validar remoteAddress antes de enviar dados HTTP quando disponível. Set-Cookie nunca é devolvido ao consumidor. Não aceitar certificado inválido ou insecureHTTPParser. Tamanho de headers16KiB; limpar listeners/timers em todos os finais.
- [x] GREEN: aplicar limites durante streaming/decodificação, não depois de buffer ilimitado. Timer absoluto inclui DNS/redirect; cancelamento destrói request/response/decompressor. Rodar testes e `npm.cmd run typecheck`; PASS. Atualizar progresso, sem commit.

## Task3 — extração de busca DuckDuckGo

**Files:** criar src/main/modules/web-research/html.ts e search.ts; test/web-search.test.ts e test/fixtures/web/search-{valid,empty,captcha,changed}.html; modificar package.json/package-lock.json; adicionar resources/licenses/htmlparser2-LICENSE.txt e domutils-LICENSE.txt.
**Interfaces:** `decodeWebText(response:SafeHttpResponse):string`, `DuckDuckGoSearch.search(query:string,scope:WebScope):Promise<SearchOutcome>`; consumir WebTransport. Helpers DOM compartilháveis com plano02.

- [x] RED: fixtures válidas contêm sete resultados, publicidade, URL duplicada e redirect uddg; assert results.length===5, sem anúncios/duplicatas, entidades decodificadas e URLs HTTP/HTTPS. Snapshot HTML nunca é executado.
- [x] RED: página vazia reconhecida→empty; CAPTCHA/status403→blocked;429→rate_limited;200 com layout desconhecido→layout_changed;200 com resultado porém destinos inválidos não equivale a vazio reconhecido. Injeção no snippet permanece texto. query500 aceita/501 rejeita, Unicode/ampersand codificados. Rodar `node scripts/run-tests.mjs web-search`; RED.
- [x] GREEN: promover versões já presentes transitivamente: `npm.cmd install --ignore-scripts --save-exact htmlparser2@10.1.0 domutils@3.2.2`. Conferir lock, licenças distribuídas e `npm.cmd run audit:runtime`; não usar audit fix geral. Essas duas dependências são a proposta explícita deste plano, não estão instaladas diretamente nesta rodada documental.
- [x] GREEN: parser estrutural da página HTML do DuckDuckGo, endpoint https://html.duckduckgo.com/html/?q= com query codificada. Limitar metadados do mapa00, converter texto com biblioteca e normalizar links; validates URLs mas não visita resultados durante search. Não seguir redirecionador do buscador para “validar” cada link. Sem fingir suporte universal a layouts futuros.
- [x] Rodar `node scripts/run-tests.mjs web-`, `npm.cmd run typecheck`, audit e scanner com untracked; PASS esperado. Salvar evidências e dependências no progresso. Rede pública real fica para aceite04, sem alterar a implementação com base em um único CAPTCHA.

## Conclusão

Transporte/busca testados localmente; não habilitar switch nem capacidades antes do plano04. Próximo: leitor e gate de navegador02. Nenhum pacote comercial necessário.

## Execution evidence

Stage01 complete: domain19/19, verify394/394 + types/build, production audit0, scanner505. One independent review, no Critical/Important; Unicode minors reproduced RED and fixed. See 2026-10-29-web-research-progress.md and .superpowers/sdd/2026-10-29-web-research-01-network-search/. No public search, no installer, no commit/push.
