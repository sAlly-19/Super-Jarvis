# Pesquisa web02 — resultado do gate de navegador

**Data:** 29/10/2026. **Estado:** gate não aprovado; aguarda decisão de arquitetura. Não habilitar renderização remota nem declarar etapa02 concluída.

## O que já foi implementado

Extração local em `src/main/modules/web-research/extraction.ts`, DTOs WebPage/ReadOutcome e contrato WebReader. Cinco testes de artigos/metadados, artigo curto versus shell JavaScript, bloqueios estruturais, HTML malformado e48KiB UTF-8 passaram. Conteúdo HTML não é executado pelo extrator.

## Prova reproduzível

Comando: `node scripts/test-web-browser.cjs`. Fixture: `test/fixtures/web/browser-host.cjs`. Perfil temporário próprio, janela oculta, nenhuma licença/conta, Node/bridge indisponíveis na página. Todas as URLs da página são sintéticas e atendidas por handler local de protocolo, sem servidor HTTP/proxy. PeerConnection usa iceServers vazio e somente relay; nenhum ICE/STUN externo é fornecido.

Relatório: `.superpowers/sdd/2026-10-29-web-research-02-reader-browser/gate-probe/gate-result.json`. Logs e provas exploratórias normal/feature-enabled na mesma pasta. Probe só conta como executado se houver relatório completo; um encerramento0 sem relatório foi identificado/corrigido no ciclo de vida do harness, sem alterar produto.

Versões observadas: Electron44.4.0, Chromium152.0.7977.78.

| Controle avaliado | Resultado observado |
| --- | --- |
| sandbox/contextIsolation/nodeIntegration:false | require e electronAPI ausentes na página |
| HTTPS interceptado + JavaScript sintético | DOM atualizado e fetch sintético pelo handler funcionam |
| CSP `webrtc 'block'` | Console: diretiva não reconhecida |
| `disableBlinkFeatures: 'WebTransport'` | WebTransport continua exposto como function |
| `disable_non_proxied_udp` | Não é chave geral de desligamento; documentação mantém TCP |
| `Connection-Allowlist: ()` no Response interceptado | Fetch da página continua funcionando; teste de deny-all falha |
| Feature ConnectionAllowlists habilitada somente no harness | Mesmos resultados observados |

O comando reproduzível termina exit1 com `WEB_BROWSER_GATE_FAILED`, por não demonstrar imposição do bloqueio total de conexões nesse caminho. Essa falha não foi transformada em skip/pass.

## Conclusão e limites da prova

Isso não é prova de exploração, de vazamento ou de acesso efetivo à rede privada. Não foram feitas tentativas contra serviços do computador. É prova de que as barreiras avaliadas não se comportaram como exigido para habilitar JavaScript arbitrário no desenho atual. Não afirmar vulnerabilidade genérica do Electron nem que suas políticas de CSP convencionais foram ignoradas.

O plano02 aprovado exige: “se não houver contenção demonstrável, PARAR02 e reportar ao usuário”. Portanto, browser-network.ts/browser-reader.ts e fallback de produção não foram publicados, e a tarefa3/leitor composto fica pendente. Etapa03/histórico não deve começar antes de resolver esse gate pela ordem aprovada.

## Alternativas para decidir

1. Entregar pesquisa/leitura HTTP primeiro e adiar JavaScript remoto explicitamente. Aproveita01 e extração02; sites dependentes de JavaScript ficam identificados como indisponíveis. É uma alteração de escopo, não aprovada automaticamente.
2. Redesenhar o navegador com contenção de rede adicional em processo/ambiente separado e novo gate verificável. Exige revisão técnica e ajuste dos planos; não prometer que simplesmente trocar biblioteca/flag ou atualizar Electron resolve.

Sem adotar silenciosamente nenhuma alternativa. Código, dependências e configuração atuais preservados; sem instalador, commit/push ou modificação dos flags do Jasper. Flag experimental foi usado só no aplicativo de teste.

## Fontes

- Política WebRTC Electron e significado de disable_non_proxied_udp: https://www.electronjs.org/docs/latest/api/web-contents
- Connection Allowlist documentada pelo Chromium: https://developer.chrome.com/docs/modern-web-guidance/guides/security/restrict-outbound-connections
- Diretiva WebRTC descrita na especificação CSP: https://www.w3.org/TR/CSP3/

Documentação não substitui os resultados do binário instalado; por isso o gate exige comportamento real e não apenas presença de opção no código.

## Decisão de continuidade — 29/10/2026

Usuário aprovou explicitamente a alternativa1: HTTP primeiro, JavaScript adiado. O gate permanece reprovado para navegador; essa entrega não usa renderização remota. Etapa02 passa a concluir o leitor HTTP com `render_unavailable` explícito para modo browser/shell JS; depois podem seguir03/04 no escopo HTTP. Não habilitar navegador em produto com base nesta mudança de escopo.
