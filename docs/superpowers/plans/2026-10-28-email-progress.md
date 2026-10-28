# E-mails — progresso e retomada

28/10/2026, main. **Planos aprovados por “PROSSIGA”; fase01 em execução.** Sem commit/push ou executável.

## Aprovações recebidas

Gmail+Outlook; SDKs oficiais; múltiplas contas; padrão configurável para novos envios; respostas na conta original; pesquisa em todas as conectadas com origem; anexos listar/baixar/enviar sem interpretação; cadastros OAuth Jasper; arquitetura local no Main com tokens cifrados e callback transitório; especificação escrita aprovada por “SIM”. Método de execução nativo/main preservado. Documentos adiado.

## Plano de retomada

Ler [mapa00](2026-10-28-email-00-execution-map.md), [desenho aprovado](../specs/2026-10-28-email-design.md), depois planos01–05 vinculados no mapa. Estes planos escritos aguardam revisão/aprovação própria; não tratar aprovação da especificação como início automático do código.

- [x] Explorar contratos atuais Main/bridge/policy/store/verificadores e resolver decisões do desenho.
- [x] Receber aprovação da especificação escrita.
- [x] Consultar versões/engines/tipos no npm sem instalar e pesquisar fontes oficiais de OAuth, MIME, retries e IDs Outlook.
- [x] Escrever mapa de contratos e cinco planos separados.
- [x] Finalizar autorrevisão de contratos/cobertura/links.
- [x] Receber aprovação dos planos escritos e iniciar execução nativa/main.
- [x] Executar01 contas/cofre.
- [x] Executar02 OAuth/leitura.
- [ ] Executar03 escrita/envio.
- [ ] Executar04 anexos/painel/orquestrador.
- [ ] Executar05 validações locais e registrar gates reais pendentes.

## Evidência desta rodada

Leituras somente: código existente, documentação oficial e npm view. Nenhuma instalação, chamada de IA/e-mail, projeto OAuth externo, token, conta pessoal ou teste de produto. Contratos ainda são definições dos planos, não código existente. Guardar resultados reais/RED/GREEN por fase em workspace da respectiva execução. Logs de fase anterior não provam a futura integração.

## Revisão técnica necessária nos planos

Novos detalhes transparentes para a revisão: scopes mínimos por método, configuração desktop pública sem segredo confidencial, seleção de anexos/destino pela UI como autoridade inicial, limites de corpo/MIME/cursor e orçamento inferior do Graph, semântica de preflight que não promete CAS remoto universal. Qualquer mudança material posterior deve ser apresentada antes de implementar.

## Autorrevisão e verificação documental

Cobertura: spec1–3→mapa/01/02;4→01/02;5→02/03/04;6→04;7→03;8→04;9–11→05. Conferidos contratos de conversas, versões de leitura, IDs de anexos, codec de operação, estados de diário e verificação por capacidade. Ajustado o desenho de status para não exigir conta conectada antes de permitir conectar uma conta e não anunciar healthy apenas porque o código existe. Threads retornam5 mensagens/página, sem buscar corpos de toda a busca.

Validação documental:8 arquivos de especificação/planos/progresso,18 links locais válidos, sem placeholders TODO/TBD; git diff --check aprovado. Nenhum teste de produto, build, instalação ou aceite de provedor nesta atividade. Autorrevisão no agente principal, sem alegar revisão independente. Planos completos salvos para revisão do usuário, método nativo/main já preservado.

## Execução01 — evidências parciais

Autorização recebida. Store/contratos/migração008/configuração opcionais implementados após RED por módulos ausentes;3/3 testes e typecheck passaram. Cofre cifrado com escrita atômica serializada entre instâncias e sessões por conta implementados após RED; testes de corrupção, crypto indisponível, falha de replace, refresh tardio, timeout e cleanup espontâneo passaram. Domínio e dependências9/9 GREEN antes do teste adicional de imports em Electron.

Quatro SDKs instalados --save-exact --ignore-scripts nas versões do mapa00, lock atualizado, licenças originais copiadas; Gmail não inclui LICENSE no pacote publicado, obtida a licença Apache do repositório oficial googleapis/google-api-nodejs-client. npm audit de produção:0 vulnerabilidades. Install apontou6 achados no conjunto com dev (1moderate/5high) e engine Node26 local fora do24; sem audit fix. Scanner401 arquivos sem achados; whitespace aprovado. Suite verify completa e revisão independente ainda em andamento, não declarar fase01 concluída com base nestes checks parciais.

Ledger recuperável: `.superpowers/sdd/2026-10-28-email-01-foundation/progress.md`. Script Bash da skill falhou no path Windows sob sandbox e foi interrompido; equivalente nativo mantém ledger, logs e rulings. Sem login real, arquivo pessoal, provedor de IA ou módulo email habilitado.

## Fase01 concluída localmente;02 em andamento

Revisão independente apontou um Important: I/O síncrono do cofre bloqueava o Main. Corrigido com helper local fs/promises, sem mudar atomic-json global; regressões RED→GREEN de commit aguardado, rollback após mover backup, recuperação.bak e JSONnull inválido. Verificação final302/302 TS, typecheck/build exit0. Auditoria de produção0; sem teste adicional de Python porque produção Python não mudou. Minor de cobertura de ciphertext adulterado em envelope válido fica registrado para testes de autenticação02. Sem segunda revisão independente alegada.

OAuthSession02 já tem RED→GREEN3/3 para callback/state/PKCE, timeout, cancelamento enquanto browser não resolve, origem não autorizada e fechamento do listener. Usa servidor loopback temporário somente no teste e navegador simulado. OAuth de provedor, login real e serviços de leitura ainda não concluídos.

## Continuidade02 — implementação de autenticação/leitura

Auth e drivers Google/Microsoft implementados com testes sintéticos: assinatura/identidade Google delegada ao SDK, nonce, scopes, conta home MSAL exata, refresh serial e persistência bloqueada após disconnect. Corrida de reconnect já aberto após disconnect reproduzida RED→GREEN. Metadados são reservados desconectados antes do segredo; só promovidos após commit válido (ruling no ledger). Cofre ausente implica reauth_required, nunca connected por arquivo JSON.

Providers Gmail/Outlook de leitura, conversas5/página, normalização HTML/UTF8, cliente SDK limitado a endpoints e responses2MiB implementados. html-to-text10.0.1/@types9.0.4 instalados exatos/licenças copiadas. Erro gaxios perdia HTTP/Retry-After por encapsulamento: reprodução RED e correção sanitizada. Query Graph corrigida segundo documentação oficial de KQL/filter-orderby, sem soltar filtros silenciosamente. SDKs externos no bundle do runner para preservar CommonJS; nenhuma implementação falsa substituiu bibliotecas.

Agregação multi-conta/cursores e tickets de versão de leitura implementados.29/29 testes email intermediários passaram antes dos testes de search/cursors/versão adicionais. Verify geral02 e revisão independente em andamento, scanner425/auditprod0/whitespace já aprovados nesta revisão parcial. Nenhuma conta real conectada, UI/ferramentas email ainda não publicadas. Etapa03 não iniciada. Ledger `.superpowers/sdd/2026-10-28-email-02-oauth-read/progress.md` contém detalhes/rulings.

Revisão independente02 encontrou4 Important (sem Critical), todos reproduzidos RED e corrigidos: reconnect concorrente a disconnect, partial durante reauth, charset MIME, corpo textual externo Gmail.38/38 testes email passaram no fixpass; typecheck/suíte final ainda em andamento. Minor: cabeçalhos RFC2047/listas Gmail ainda não integralmente normalizados. Fluxo real OAuth/API/comercial não testado. Não confundir testes de fetch sintético com acesso real aos provedores.

Fase02 verificada após fixpass: npm run verify327/327 testes TS, typecheck/build exit0. Sem re-review após correções. Próxima etapa03: diário/rascunhos/envio e reconciliação; email continua não implementado no switch até a composição completa04. Não executar instalador ou login real para esta transição.

## Execução03 — escrita em andamento

OperationStore/Codec, WriteService, MIME local e providers Google/Graph de rascunho/envio/resposta/organização implementados com testes sintéticos RED→GREEN. Guards impedem conta cruzada, envios sem storage protegido e repetição de operação incerta. Aceitação exige checkpoint/receipt; erro HTTP403 conhecido é rejeição explícita. SDKs reais com fetch503 simulado fazem um único POST. Nodemailer10.2.1 fixado/licença e sem SMTP, filesystem/URL desativados no compositor.

Provas Main e reconciliação estritamente GET implementadas. Nonce precisa conferir no recurso retornado, não só no resultado da busca; Graph só promove quando o mesmo draft imutável é observado enviado. Nenhuma entrega/leitura do destinatário é inferida. A separação draft.id versus message.id do Gmail está preservada.

Pendências03 atuais: suite geral e revisão independente; nenhuma UI/capacidade email publicada, conta/API real ou instalador. A resolução dos anexos originais para forward/update Gmail pertence04 e hoje falha explicitamente para não omitir arquivo; reply não copia originais. Restore Outlook sem pasta original conhecida exige destino, sem fallback implícito. Ledger `.superpowers/sdd/2026-10-28-email-03-mutations/progress.md` tem evidências/rulings.

Revisão03 recebida:2 Important de reconciliação reproduzidos RED; fixpass em validação. Agora intenção cifrada inclui plano completo dos efeitos e marcadores; estado observado exige destino/rótulos concretos e todas as partes obrigatórias comprovadas, inclusive anexos ainda sem checkpoint. Não marcar03 concluída antes da suite pós-correção.

Fase03 concluída localmente após fixpass: verify350/350 testes TS, typecheck/build exit0; auditoria de produção0, scanner444 e whitespace aprovados. Revisão independente única, sem alegar segunda revisão. Testes sintéticos, sem envio/login real. Fase04 começa por autoridade de arquivos e transferências; publicação do módulo permanece pendente da composição completa. Node26 local continua fora da engine24, não validado como Node24.

## Execução04 — anexos e fachada, integração pendente

Tickets de uploads/destino por conta/sessão/revisão com TTL, validação de arquivo alterado, junction/hardlink, tetos10 arquivos/10MiB e downloads sem overwrite implementados. Testes locais de cancelamento/limites/colisões e nomes maliciosos passaram. Downloads Gmail/Graph base64 limitados e privados no Main; SDK com fetch falso suporta anexo>2MiB mantendo corpo limitado. Gmail preserva originais no forward/update, send/update contabilizam originais+novos antes de mutar.

Locations agora inclui nomes de pastas/rótulos e parentId em DTO de saída, refs de entrada não mudam. Fachada Main e prova vinculada à revisão da conta iniciadas/teste1/1. Domínio intermediário69/69 e typecheck0 antes dos últimos ajustes; validação final desta revisão em andamento. Nenhum login/envio real, instalador ou módulo email ativado. Pendentes: composição/bootstrap, catálogo/Python, IPC/painel e aceite05. Ledger de retomada `.superpowers/sdd/2026-10-28-email-04-attachments-integration/progress.md`.

Continuidade04: composição/bootstrap,12 ferramentas/verificadores Python, IPC/preload e painel multi-conta ligados no código. Status usa configuração/credenciais reais, não só presença de código; sem resources/email-oauth.json a conexão continua indisponível com orientação. Testes sintéticos de composição2/2, IPC1/1, Chromium1/1 e Python88/88; verify intermediário362/362 passou antes da ligação final. Verify final e revisão independente04 em andamento; não é aceite comercial nem login/envio real. Switch email agora implementado no código, com gate de licença/consentimento/módulo/conta; não foi ativado no perfil real. Fase05 ainda pendente.

Revisão04 concluída com4 Important (inclui callback identificado pelo principal). Corrigidos RED→GREEN callback Microsoft cadastrável e anexos inline Gmail. Duas decisões pendentes do usuário: aliases diretos para encadear email versus extração aninhada geral no orquestrador; helper Windows contra troca de pasta versus adiar downloads. Downloads estão BLOQUEADOS na fachada (email_download_unavailable) e botão desativado; helper interno por paths ainda tem corrida confirmada e não é seguro para publicação. Encadeamento automático email não deve ser considerado concluído. Após contenção: domínio79/79, types0; verify completo pós-fixpass em andamento. Não fechar04/05 por haver testes verdes parciais; preservar pendências e gates OAuth reais.
