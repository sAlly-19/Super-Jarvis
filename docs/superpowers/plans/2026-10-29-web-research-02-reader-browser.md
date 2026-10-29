# Pesquisa web02 — leitura e navegador isolado

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans, método nativo. Executar em ordem com TDD; gate do navegador é obrigatório antes de usá-lo em leitura real.

**Goal:** Ler HTML/texto e renderizar páginas JavaScript sem expor o sistema ou a sessão pessoal.
**Architecture:** Leitor Main usa transporte01; fallback reutiliza Chromium em sessão descartável mediada. Extração é texto, não autoridade ou HTML para o renderer do Jasper.
**Tech Stack:** Electron44, TypeScript, HTTP01, parser01 e html-to-text10.0.1 existente.
**Spec:** [desenho](../specs/2026-10-29-web-research-design.md). **Depends on:** [01](2026-10-29-web-research-01-network-search.md). **Contratos:** [00](2026-10-29-web-research-00-execution-map.md).

## Global Constraints

Restrições00. Texto48KiB UTF-8, leitura30s, HTTP inicial8s, renderização15s; espera na fila incluída. Um navegador ativo,40 requisições/10MiB descomprimidos por página. Sem Node/preload do Jasper/cookies pessoais/popups/downloads/login/POST ou servidor local. Não regenerar release.

## Review Focus

1. Artigo curto legítimo não dispara navegador só por ter poucos caracteres — Tasks1/3.
2. Página JavaScript usa recursos privados/redirect/worker/WebSocket/WebRTC para escapar da mediação — Task2.
3. Budget excedido ou script infinito não deixa janela/requests vivos — Tasks2/3.
4. CAPTCHA/HTTP403 não aciona fallback nem contorno — Tasks1/3.
5. Texto final muda enquanto módulo é desligado; resultado não pode persistir ou ser devolvido — Task3.

## Task1 — conteúdo principal e classificação

**Files:** criar src/main/modules/web-research/extraction.ts; estender contracts.ts/html.ts de01 e DTOs em src/shared/types/web-research.ts; test/web-extraction.test.ts; fixtures test/fixtures/web/{article,short-article,js-shell,access-wall,malformed}.html.
**Interfaces:** `extractWebPage(html:string, meta:{url:string;fetchedAt:string;mode:'http'|'browser'}):{page:WebPage;needsRendering:boolean;accessBlocked:boolean}`. Produzir WebPage/ReadOutcome do00; não fazer rede nesta função.

- [x] RED: artigo/main prevalece sobre nav/footer, texto/plain continua legível, data ausente→null, data civil não ganha timezone, metadata de publicação inválida não vira data de hoje, JSON-LD não é executado. Texto UTF-8>49.152bytes é truncado em fronteira válida e flagged.
- [x] RED: artigo curto retorna needsRendering:false; div#root vazio com scripts e sinal de app exige renderização; “nenhum resultado” textual não é diagnóstico genérico de shell. CAPTCHA/paywall/login reconhecidos retornam accessBlocked:true. Rodar `node scripts/run-tests.mjs web-extraction`; RED.
- [x] GREEN: usar parser01/seleção article→main→body, removendo elementos não editoriais e scripts. Considerar HTTP/content-type para texto simples no leitor, sem interpretar PDF/binário como HTML. Não derivar bloqueio apenas de palavra solta num artigo. Rodar mesmo teste; PASS.

## Task2 — gate de rede com Electron real

**Files:** criar src/main/modules/web-research/browser-network.ts e browser-reader.ts; test/web-browser.test.ts; test/fixtures/web/browser-host.ts; scripts/test-web-browser.cjs.
**Interfaces:** `IsolatedWebBrowser.render(url:string,scope:WebScope):Promise<{html:string;url:string;fetchedAt:string;partial:boolean}>`, `close():Promise<void>`. browser-network recebe WebTransport e scope; mantém budgets por página. Script de teste retorna exit0 só após assertions reais e fecha perfil/janela/processo próprios.

- [ ] RED: harness Electron usa sessão não persistente e handler HTTP/HTTPS com transporte fake de01; https://article.example.invalid retorna HTML/JS/JSON sintéticos sem conexão externa. Confirmar renderização altera DOM, chamadas passam pelo mediador e nenhuma BrowserWindow fica visível.
- [ ] RED: página tenta fetch/XHR/img/script/CSS/iframe/worker/service worker/WebSocket/WebRTC/WebTransport, redirect e navegação para127.0.0.1,169.254.169.254, IPv6local, data/file e domínio que muda DNS. Instrumentar mediador, requests não mediados e eventuais tentativas de socket; PASS exige nenhum tráfego privado ou canal sem controle. Não substituir esse teste por simples mock de BrowserWindow.
- [ ] Rodar `node scripts/test-web-browser.cjs` e o wrapper `node scripts/run-tests.mjs web-browser`; RED esperado antes do código. Fixture não é pacote do produto e não abre servidor/proxy local; nenhum domínio real é consultado.
- [ ] GREEN: sessão exclusiva sem persist, cache e credenciais; handlers HTTP/HTTPS antes de criar/carregar janela. Delegar bytes ao SafeWebHttpClient sem net.fetch recursivo, mantendo limites e checagem de scope. Cabeçalhos de autorização/cookies/referrer pessoal não saem; cookies/Set-Cookie não são preservados. Definir CSP complementar para bloquear workers/frames/form-action/object e negar permissões, downloads, popups e canais não mediados. Manter TLS/CSP do site; não desligar webSecurity ou sandbox para fazer a página funcionar.
- [ ] GREEN: somente GET/HEAD, recursos textuais HTML/JS/CSS/JSON; imagens/fontes/mídia/downloads fora de escopo. Bloquear WebSocket e verificar que WebRTC/WebTransport não deixam canal direto. O gate requer comprovação na versão instalada: se não houver contenção demonstrável, PARAR02 e reportar ao usuário, sem publicar fallback inseguro ou reduzir silenciosamente a entrega a HTTP.
- [ ] GREEN: budgets40 requests/10MiB totais e até2MiB por recurso, timeout15s absoluto, cancelamento destrói janela e requests; extração DOM com teto de tamanho antes de retornar ao Main, inclusive texto criado por JS. Segunda renderização entra na fila cancelável sem reiniciar deadline. Testar erro de renderizador/script travado e fechamento; PASS do harness e wrapper antes de avançar.

## Task3 — leitor HTTP com fallback controlado

**Files:** criar src/main/modules/web-research/reader.ts; test/web-reader.test.ts.
**Interfaces:** `DefaultWebReader` implementa WebReader do00, consumindo WebTransport/extraction/IsolatedWebBrowser. Injetar clock e browser para testar classificação/ordem; manter teste2 com browser real separado.

- [ ] RED: auto em artigo curto/texto simples chama HTTP uma vez e browser zero; shellJS→HTTP depois browser uma vez; mode:http nunca renderiza; mode:browser exige gate e política igual, sem carga HTTP preliminar redundante. FinalURL é o destino revalidado, não canonical link não visitado.
- [ ] RED:403/CAPTCHA/429/nãoHTML não provocam fallback; timeout inicial não se converte em loop no navegador. Limite de30s inclui fila; suspensão/revogação depois da extração descarta resultado. Conteúdo útil com recurso bloqueado→partial, não sucesso completo. Rodar `node scripts/run-tests.mjs web-reader`; RED.
- [ ] GREEN: implementar read, distinguir bloqueio, conteúdo parcial e indisponibilidade; extrair novamente DOM renderizado com a mesma função1 e revalidar scope antes de entregar. Sem leitura de PDF ou login. Rodar testes reader/extraction/browser, `npm.cmd run typecheck`; PASS.
- [ ] Registrar gate, versões Electron/Node, evidências do isolamento e limites de sites suportados. Sem screenshot como única prova de ausência de rede; sem commit ou instalador.

## Conclusão

Só declarar02 pronto com gate real aprovado. Próximo03: histórico. Não publicar capacidades nem fazer teste com conteúdo pessoal.

## Execution checkpoint

Task1 complete5/5. Web domain24/24 and typecheck pass. Task2 containment gate FAILED in real Electron; browser production and Task3 not implemented. See [gate report](2026-10-29-web-browser-gate.md) before continuing. User decision required by the approved gate; do not silently reduce scope or publish unproven rendering.
