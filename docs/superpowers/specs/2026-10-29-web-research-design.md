# Pesquisa web — desenho para revisão

**Data:** 29/10/2026. **Estado:** especificação aprovada com “prossiga”; [planos executivos](../plans/2026-10-29-web-research-00-execution-map.md) aguardam revisão. Nenhum código iniciado.
**Decisões recebidas:** busca sem chave adicional; HTTP com navegador isolado para JavaScript; guardar conteúdo das últimas dez pesquisas. Integração por chamadas diretas, sem restaurar o planejador.

## 1. Resultado esperado

O Jasper pesquisa assuntos atuais, consulta URLs públicas, compara informações e responde com fontes pelo chat ou pela voz. Não exige cadastro adicional de busca. Usa contexto e padrões razoáveis, perguntando somente quando uma informação essencial estiver ausente. Recupera pesquisas anteriores quando solicitado, identificando quando foram feitas.

Esta fase é de consulta. Não inclui login, formulários, compras, interpretação de anexos, PDFs ou automação de contas. Conteúdo remoto não concede autoridade sobre outros módulos. Licença72h e consentimento geral Total Control permanecem; sem confirmação por consulta.

## 2. Busca e leitura

### Busca sem chave

Começar pela interface HTML pública do DuckDuckGo, com consulta codificada, limite de cinco resultados orgânicos e eliminação de duplicatas. Extrair título, destino final do link e trecho; links de rastreamento não autorizam seguir destinos privados. Retornar zero resultados somente quando a página reconhecer esse estado. CAPTCHA, rate limit, layout desconhecido e erro de rede são indisponibilidade, não busca vazia.

Não chamar isso de API oficial nem prometer disponibilidade irrestrita. Não usar proxies rotativos, CAPTCHA solver, login ou tentativas repetidas para contornar bloqueios. Sem fallback pago ou troca automática para outro buscador nesta entrega. Se o acesso for bloqueado, a leitura de URLs públicas fornecidas pelo usuário continua disponível.

### HTTP primeiro, navegador quando necessário

O Main usa transporte HTTP/HTTPS controlado para obter HTML/texto. Reutilizar html-to-text existente para conversão textual; extração estrutural deve selecionar artigo/main e excluir navegação, scripts e rodapés, usando parser existente declarado diretamente se necessário. Dependências exatas e licença serão conferidas no plano; não construir um indexador da internet ou parser HTML por expressões regulares.

Usar o Chromium já incluído no Electron quando o HTML indicar uma aplicação JavaScript sem conteúdo principal suficiente. Falha HTTP, bloqueio de acesso, CAPTCHA ou paywall não são justificativa para esse fallback. Uma página curta válida não deve ser confundida com erro. A ferramenta aceita modo automático ou solicitação explícita de renderização; a IA não precisa pedir permissão por operação.

O navegador é oculto, sem integração Node, sem preload do Jasper, com sandbox e contextIsolation, em sessão separada não persistente. Não reutiliza cookies, contas Google, cache ou permissões do usuário. Negar popups, download, permissões de dispositivo, navegação externa, certificados inválidos e métodos de rede que produzam escrita. Renderizar não equivale a preencher formulários.

### Rede mediada

URL inicial, redirects e recursos secundários seguem a mesma política. Aceitar somente HTTP/HTTPS em portas80/443, sem credenciais embutidas. Bloquear loopback, rede privada, link-local, multicast, reservados e metadata, incluindo IPv6 e representações alternativas de IP.

Resolver DNS no Main, validar todos os endereços e fixar o endereço aprovado na conexão, mantendo hostname/TLS corretos; não resolver novamente sem validação. Não basta validar hostname e deixar o Chromium resolver livremente depois.

Para o navegador, usar handlers HTTP/HTTPS da sessão dedicada delegando ao transporte controlado, sem recursão em net.fetch. Bloquear canais não mediados, como WebSockets e conexões diretas de WebRTC, bem como service workers, popups e esquemas locais. Não abrir proxy/servidor local nem alterar a sessão principal.

**Gate técnico:** antes de habilitar renderização remota, testes com Electron real devem demonstrar que navegação, fetch/XHR, recursos e redirects não escapam da mediação. Se a API da versão instalada não permitir essa garantia, interromper essa etapa e apresentar a limitação ao usuário; não substituir por uma verificação somente da URL inicial nem anunciar o fallback como concluído.

## 3. Limites propostos

Valores sujeitos à revisão desta especificação:

| Item | Limite inicial |
| --- | --- |
| Consulta | 500 caracteres; 5 resultados por busca |
| URL | 4.096 caracteres; HTTP/HTTPS em portas80/443 |
| Redirects | 5, revalidados individualmente |
| Resposta HTTP | 2MiB de conteúdo descomprimido e limite equivalente de transferência |
| Texto extraído devolvido | 48KiB UTF-8 por página, com indicador de truncamento |
| Busca | 15s totais, sem repetição automática |
| Leitura | 30s totais; HTTP inicial até8s e renderização até15s dentro desse orçamento |
| Navegador | 1 ativo; no máximo40 requisições e10MiB descomprimidos por página |
| Histórico | 10 pesquisas; até3 páginas por pesquisa; 256KiB de conteúdo serializado por registro |

O cancelamento encerra requests e destrói a janela. Se o módulo for desligado ou a licença perder validade, impedir novas requisições e resultados tardios, revalidando antes de persistir/entregar. O prazo inclui espera na fila. Não usar network-idle ilimitado para páginas com atividade contínua.

## 4. Histórico local das dez últimas pesquisas

### Conteúdo

Cada pesquisa guarda pergunta, início/conclusão, estado, resumo final da IA, resultados com URLs e as três últimas páginas distintas lidas no contexto dela. Para cada página: título, URL final, instante da consulta, data de publicação se disponível, texto extraído e indicadores de truncamento/modo de leitura. Não guardar HTML, imagens, scripts, cookies ou tokens de sessão do navegador.

Uma busca abre um registro e devolve researchId; leituras associam-se a esse registro. Uma leitura direta sem pesquisa anterior abre registro próprio usando a URL como origem. Não agrupar pesquisas diferentes apenas por proximidade no tempo. Concluídas, parciais, bloqueadas ou canceladas devem ser identificadas como tais; nenhuma resposta inventada é salva como prova de leitura.

Quando uma décima primeira pesquisa é criada, remover a mais antiga e suas páginas atomicamente. Ordenação por sequência atribuída no início: uma resposta lenta não pode expulsar pesquisas mais recentes ao terminar. Operações em registros já removidos devem falhar sem recriá-los. Desligar o módulo preserva o histórico.

### Persistência e proteção

Reutilizar SQLite no Main com migração aditiva009. Metadados mínimos de ordenação/estado podem ficar nas colunas; pergunta, URLs, resumo e texto ficam no payload cifrado com safeStorage/DPAPI, sem fallback em texto puro. Limite de dez registros e payload256KiB mantido dentro da transação. Não alterar tabelas de memória ou tarefas.

Se a proteção local estiver indisponível, a consulta web pode continuar apenas em memória, com aviso claro de que o histórico não será salvo. Não apagar histórico cifrado anterior nem sobrescrevê-lo com estado vazio. Corrupção/falha de escrita deve aparecer como indisponibilidade de armazenamento, sem impedir a resposta factual obtida da rede.

“Limpar histórico” remove todas as pesquisas logicamente e invalida operações pendentes por geração; uma resposta atrasada não pode repovoar o histórico após a limpeza. Não prometer apagamento forense de disco/backup/SQLite WAL. Sem limpeza automática por idade ou sincronização em nuvem nesta versão.

### Resumo final e contexto entre Main/Python/Live

O resumo é a resposta do modelo, não prova de que uma fonte foi consultada. O Main é responsável por anexar páginas e evidências de obtenção. Atualizar resumo não pode modificar fontes, elevar status de execução ou executar ferramentas.

O Main entrega um recibo opaco de atualização junto à pesquisa obtida, válido por cinco minutos; o runtime o retém fora das mensagens enviadas ao modelo e fora de logs/eventos visuais. Ao concluir a resposta de chat ou a transcrição de saída Live, envia uma atualização tipada contendo researchId, recibo, sessão e resumo de até4.000 caracteres. O Main confere vínculo, geração, prazo e autoridade antes de aceitar, consumindo o recibo uma vez. Manter no máximo30 recibos pendentes, descartando os expirados ou pertencentes a registros removidos. Não associar a resposta simplesmente à “última pesquisa da sessão”.

Interrupção, expiração ou falta de transcrição deixa o resumo indisponível/pendente, mantendo as páginas efetivamente consultadas. Não fazer uma chamada adicional de IA apenas para preencher esse campo. No Live, agrupar pelos IDs coletados na rodada e descartar recibos ao interromper/encerrar; não transportar resumo da rodada anterior para uma nova pesquisa.

### Recuperação

Listar metadados/resumos e ler uma pesquisa por ID mediante autorização. Não inserir automaticamente as dez pesquisas completas em todo prompt. Ao usar resultado armazenado, informar a data da consulta; se o pedido exigir informação atual, pesquisar novamente e criar novo registro. Limpeza manual fica no painel; conteúdo do histórico continua dado não confiável.

## 5. Integração e apresentação

Capacidades propostas: web_search, web_read, web_history_list e web_history_get, no módulo web-research. Todas passam pelo ModuleBridge e executor Main; sem Planner/execute_task. Manifesto com schemas estritos, limites, permissões e timeout por capacidade. Tipos exatos de requisição/resposta e novos envelopes de resumo serão definidos no plano executivo antes do código.

Resultados da rede incluem estados de bloqueio/parcialidade, URLs e horários; apenas o Main gera evidência de consulta. Evidência comprova obtenção do conteúdo, não veracidade factual ou concordância entre fontes. Recibos e conteúdo integral não chegam a eventos tool_execution/tool_result visuais.

No painel Sistema & Automação: switch persistente, explicação “sem chave adicional”, diagnóstico operacional e lista das dez pesquisas com abrir/ler/limpar. Sem exibir HTML remoto como HTML do aplicativo; usar texto e links HTTP/HTTPS validados. Chat com fontes clicáveis e voz concisa, preservando links na interface. Reaproveitar a configuração atual; sem tela de cadastro externa.

Separar três situações: módulo desativado; implementação pronta mas sem conexão/buscador bloqueado; consulta obtida. Diagnosticar não dispara pesquisa externa automaticamente. Teste operacional de rede deve ser explícito. No Live, habilitar ferramentas exige reiniciar a chamada; desativar bloqueia imediatamente novas ações, mantendo a regra já aprovada.

## 6. Entregas executivas a separar

1. Transporte e política de rede, busca DuckDuckGo, parser e testes de bloqueio/limites.
2. Leitura HTTP e navegador isolado, prova da mediação de rede em Electron real e extração.
3. Histórico cifrado de dez pesquisas, migração009, associação de páginas/resumo e limpeza concorrente.
4. Catálogo, Main/Python/Live, IPC/painel, referências visíveis e aceite integrado.

Cada plano deverá ter testes RED→GREEN, arquivos/interfaces exatos e critérios de conclusão independentes. Não instalar bibliotecas antes da aprovação dos planos. Manter o método nativo/main previamente escolhido, sem commit/push/deploy.

## 7. Aceite e limitações

Cobrir fixtures de busca válida/vazia/bloqueada/layout alterado; URL e DNS maliciosos; redirects e recursos privados; compactação excessiva; HTML malformado; shell JavaScript versus artigo curto; cancelamento; encerramento da janela; módulo/licença revogados; consultas simultâneas; décima primeira pesquisa; resumo forjado, expirado ou fora da rodada; limpar durante consulta; indisponibilidade/corrupção de cifragem; fontes contraditórias/antigas e snippets não lidos.

Validar Python, TypeScript, build dev, scanner e bridge real com transporte sintético. Rede pública/buscador real é aceite separado, com consulta pública sem dados pessoais; não confundir fixtures com disponibilidade real. Não gerar instalador nesta fase salvo necessidade concreta autorizada. Node local26 fora da engine24 deve ser registrado; verificar Node24/CI quando disponível.

O buscador pode alterar HTML ou bloquear automação. Alguns sites não funcionarão sem login, POST ou recursos bloqueados; retornar limite honesto. Não ampliar automaticamente para login, formulários, proxies, servidores locais ou API paga. Mudanças estruturais necessárias após provas devem voltar ao usuário.

## 8. Fontes técnicas consultadas

- DuckDuckGo HTML/non-JavaScript: https://duckduckgo.com/duckduckgo-help-pages/features/non-javascript
- Electron BrowserWindow: https://www.electronjs.org/docs/latest/api/browser-window
- Sessão dedicada: https://www.electronjs.org/docs/latest/api/session
- Interceptação por protocolo da sessão: https://www.electronjs.org/docs/latest/api/protocol
- Segurança Electron: https://www.electronjs.org/docs/latest/tutorial/security
- safeStorage: https://www.electronjs.org/docs/latest/api/safe-storage
- HTTP Node e custom lookup: https://nodejs.org/docs/latest-v24.x/api/http.html

Essas referências sustentam as APIs candidatas; não substituem testes da versão instalada nem constituem aprovação de distribuição/uso automatizado por buscadores.

## Decisão posterior de escopo —29/10/2026

Após falha documentada do gate real de contenção, usuário escolheu explicitamente **busca e leitura HTTP primeiro**, adiando sites que exigem JavaScript. Nesta entrega não há renderer remoto: modo browser e shells JS retornam render_unavailable, sem tentativas de contorno. O gate do navegador continua reprovado; não é condição para histórico/integração da entrega exclusivamente HTTP. Demais requisitos de proteção, fontes, retenção e execução direta permanecem.
