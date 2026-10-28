# E-mails Gmail e Outlook — desenho para revisão

Data:28/10/2026. Módulo `email`. Branch `main`.
**Status:** especificação escrita aprovada pelo usuário em28/10/2026 com “SIM”. Planos executivos em elaboração/revisão própria; aprovação deste documento não cria cadastros externos nem autoriza conexão a contas/envios reais. Sem commit/push nesta rodada.

## 1. Objetivo e decisões aprovadas

Permitir que o Jasper combine leitura, pesquisa, resumos, organização e envio de e-mails com suas capacidades existentes, tanto no chat quanto na chamada. O módulo deve servir clientes comerciais com contas pessoais e profissionais.

- Gmail e Outlook nesta entrega, usando SDKs oficiais dos provedores e adaptadores próprios.
- Várias contas de cada provedor simultaneamente.
- Conta padrão configurável para novos envios quando nenhuma conta for indicada.
- Respostas pela conta que recebeu a mensagem original; nunca migrar silenciosamente uma resposta para a conta padrão.
- Pesquisa em todas as contas conectadas quando o pedido não restringir a conta, identificando a origem dos resultados.
- Anexos: listar, baixar e enviar. Interpretação, extração e resumo de seu conteúdo ficam fora desta entrega. Documentos permanece adiado.
- Cadastros OAuth administrados pelo publicador Jasper; o cliente conecta suas contas pelo navegador, sem criar projeto próprio.
- Execução local no Electron Main, tokens criptografados no computador e sem servidor Jasper intermediando caixas/tokens. Loopback temporário somente para concluir o login.
- Consentimento geral Total Control, sem confirmação adicional por operação. OAuth ainda apresenta o consentimento exigido pelo provedor; esclarecimento de destinatário ambíguo não é confirmação de operação.
- Executáveis apenas ao terminar o projeto ou quando realmente necessários para um teste. Não empacotar automaticamente cada subentrega.

## 2. Arquitetura e integração existente

O fluxo será `chat/Live → orquestrador Python → bridge/broker Main → serviço email → adaptador Gmail/Graph`. A tela acessa o mesmo serviço por IPC tipado, com validação de janela/frame. Não haverá acesso direto do renderer ou Python aos SDKs autenticados.

Reutilizar `ModuleRegistry`, `ModulePolicy`, `ModuleRuntimeBridge`, `ExecutionBroker`, `TaskService`, `StateDatabase`, migrações e escrita atômica existentes. Registrar executor Main para `email`; não encaminhar suas capacidades ao worker Python como fallback. Aplicar a reconciliação diferencial do catálogo já usada por Lembretes e Saúde do PC.

Responsabilidades propostas em `src/main/modules/email/`:

| Componente | Responsabilidade |
| --- | --- |
| Contratos/adaptadores | Normalizar operações dos provedores preservando diferenças e limites reais |
| OAuth e cofre | Login, refresh, cache por conta, desconexão e cancelamento do login |
| Store | Metadados de contas, padrão, revisão e diário mínimo das operações |
| Serviço | Autorizar, selecionar conta, executar, reconciliar e produzir observações verificáveis |
| Anexos | Transferência limitada e associação entre arquivo autorizado e operação |
| IPC/painel | Conexões, conta padrão, estado verdadeiro e diagnósticos sem segredos |

Evitar ampliar indefinidamente `modules/application.ts`: o módulo terá seu próprio componente de composição/lifecycle, chamado pelo bootstrap existente. Não refatorar módulos alheios.

Alternativas consideradas: backend Jasper central teria nova infraestrutura e concentraria dados de clientes; processo auxiliar dedicado exigiria outro protocolo e lifecycle. A opção escolhida reutiliza a fronteira Main atual. Todo I/O de rede/arquivo deve ser assíncrono; conversão MIME e volumes transferidos precisam de limites para não bloquear a interface.

## 3. Autenticação e permissões

Google: cliente OAuth desktop e Gmail API. Microsoft: cliente público desktop, contas pessoais e organizacionais, Graph estável `v1.0` e MSAL Node. Não usar credenciais de serviço com acesso irrestrito às caixas nem tratar o segredo de um aplicativo desktop como segredo confidencial de servidor.

Login por navegador do sistema, authorization code + PKCE e correlação `state` por tentativa. Listener apenas em loopback, porta efêmera e callback exato; aceitar somente a resposta correlacionada. Encerrar ao concluir, cancelar, expirar, desativar o módulo, perder licença ou fechar o aplicativo. Nenhuma porta permanente de sidecar/HTTP é restaurada. Proposta de prazo de login:5 minutos, fora do orçamento120s das tarefas do orquestrador. A configuração não inicia login automaticamente.

Escopos propostos: Gmail `gmail.modify`, sem `https://mail.google.com/`; Graph `Mail.ReadWrite` e `Mail.Send` delegados, com identidade/offline mínimos exigidos pelo fluxo. Mapear cada método efetivo aos escopos antes de fixar o plano; só acrescentar outra permissão com justificativa e revisão. Não solicitar calendário, contatos, Drive ou permissões de aplicativo para toda organização.

Access/refresh tokens Google e cache MSAL ficam em cofre separado, criptografado por `safeStorage` e gravado atomicamente. Identidades são vinculadas ao identificador estável do provedor/tenant, não somente ao endereço de e-mail. Cache, refresh e desconexão devem ser serializados por conta. Criptografia indisponível bloqueia a conexão; nunca gravar plaintext como fallback. Renderer, Python, modelos, logs e histórico de tarefas não recebem tokens, códigos OAuth, cookies ou URLs de callback autenticadas.

Desconectar remove a autorização local e invalida suas tarefas/refreshes; reconectar exige o fluxo apropriado. Revogação remota, quando suportada pelo provedor, deve ser diferenciada da remoção local. A interface não promete logout global nem revogação do consentimento organizacional quando só removeu o cache local.

## 4. Contas, busca e dados

Cada conta possui UUID local, provedor, identidade estável, endereço/nome para exibição, estado de conexão, permissões concedidas e revisão. SQLite guarda esses metadados, referência opaca ao cofre e seleção padrão; não guarda tokens nem espelha caixas completas.

Conta explicitamente indicada prevalece em novos envios. Conta padrão ausente ou desconectada resulta em erro orientado à configuração, sem selecionar outra. Respostas e ações sobre resultados usam a tupla `(accountId, providerMessageId)`, nunca apenas um ID ou assunto. Se o usuário pedir resposta por outra conta, esclarecer a intenção antes de convertê-la em uma nova mensagem.

Pesquisa usa filtros comuns normalizados, traduzidos por adaptador; recursos específicos não disponíveis no outro provedor geram indicação explícita, sem fingir equivalência. Não concatenar consultas arbitrárias em URLs. Cada resultado identifica conta, mensagem/conversa e origem.

Paginação usa cursores opacos vinculados à sessão, consulta e conjunto de contas. Busca parcial informa contas consultadas e falhas; não apresentar uma busca parcial como ausência geral de e-mails. Identidades iguais em provedores diferentes não devem ser mescladas automaticamente. IDs de Outlook que mudem por movimentação exigem estratégia do adaptador que mantenha a correlação confiável.

Corpos/assuntos/destinatários ficam voláteis apenas pelo tempo necessário para a solicitação e UI. Não persistir conteúdo no histórico de tarefas, memória automática ou auditoria. Entregar ao modelo somente o necessário para a solicitação, respeitando políticas dos provedores e configuração de IA. Desligar/encerrar/revogar limpa observações e invalida resultados tardios.

HTML recebido é convertido em texto para o agente e exibido sem scripts, imagens remotas ou navegação automática. Conteúdo de mensagens/anexos é dado externo, não instrução capaz de autorizar ferramentas, escolher destinatários ou alterar a política do módulo.

## 5. Operações e diferenças entre provedores

| Grupo | Comportamento desta entrega |
| --- | --- |
| Contas | Conectar, reconectar, desconectar, listar estado e definir padrão pela tela |
| Consulta | Pesquisar, ler mensagem/conversa e listar pastas/marcadores |
| Composição | Criar/atualizar rascunho, enviar, responder e encaminhar |
| Organização | Lido/não lido, arquivar, mover, aplicar/remover marcadores compatíveis e enviar/restaurar da lixeira |
| Anexos | Listar metadados, baixar e anexar arquivos autorizados a uma composição |
| Inteligência | Resumos e importância com referências; extrair possíveis prazos sem criar lembretes implicitamente |

Resumos/classificação pertencem ao orquestrador com dados das ferramentas, não a outro serviço de IA fixo. Para criar um lembrete a partir de uma mensagem, usar as capacidades existentes de Lembretes somente quando o objetivo do usuário incluir essa ação. Datas inferidas ou ausentes não viram compromissos comprovados.

Organização respeita Gmail labels versus Outlook folders; uma operação que não tem equivalente retorna não suportada. Não apagar mensagens permanentemente, esvaziar lixeira, fazer envios em massa, gerenciar aliases/delegações/caixas compartilhadas ou criar regras automáticas nesta entrega. Esses limites são de escopo proposto, não novas confirmações por operação.

As capacidades serão divididas por efeito e receberão schemas estritos, permissões, timeouts, cancelamento e verificadores no plano executivo. Entradas não aceitam URL autenticada, token ou escolha arbitrária de endpoint pelo modelo. Respostas devolvem referências opacas e dados limitados, sem bytes de anexos no protocolo de16MiB.

## 6. Anexos e limites propostos para revisão

Upload usa seleção explícita de arquivos ou caminho solicitado pelo usuário e resolvido pelo Main segundo o escopo autorizado. A ferramenta recebe referência opaca associada à conta/composição/sessão; conteúdo de e-mail não concede autoridade para ler arquivos locais. Validar tipo de alvo, nome, tamanho real e mudança do arquivo entre seleção e leitura; não seguir redirecionamentos remotos arbitrários nem executar/descompactar anexos.

Download valida conta/mensagem/anexo e destino no Main, trata nomes remotos como nomes e não como caminhos, grava em arquivo temporário e publica atomicamente. Não sobrescrever silenciosamente outro arquivo. Cancelamento remove temporários próprios; não apaga arquivos preexistentes. Leitura e upload devem ser limitados também durante a transferência, sem confiar apenas no tamanho declarado.

Propostas de orçamento de aplicação, não limites anunciados pelos provedores:50 resultados por página agregada;100KiB de texto normalizado por mensagem com truncamento informado;10 anexos por composição e10MiB somados de bytes originais. O adaptador aplica também os limites reais mais restritos, incluindo MIME/base64. Transferências maiores retornam diagnóstico; não adicionar upload resumível automaticamente nesta fase. A revisão do desenho pode ajustar esses números antes do plano.

## 7. Efeitos remotos, prova e cancelamento

Antes de cada efeito: licença, consentimento, módulo, revisão, conta, escopos e contexto de tarefa válidos. Cancelamento impede novas requisições e aborta o I/O quando possível; nunca promete desfazer uma mensagem já aceita pelo provedor. Desativação não remove contas, preferências ou arquivos baixados.

Gravar intenção mínima da mutação antes da requisição: operationId, invocationId, conta opaca, tipo, estado e correlação. Dados mínimos necessários à reconciliação sensível ficam cifrados; histórico público contém só metadados. Serializar mutações concorrentes do mesmo alvo/rascunho. Repetição do mesmo invocationId não reexecuta o efeito.

SDKs devem ter retries transparentes de mutações desabilitados. Não tentar envio novamente após timeout, crash ou resposta perdida. Registrar desconhecido e reconciliar por evidência confiável quando disponível; coincidência de assunto/destinatário não prova identidade de operação. Reabrir o Jasper não retoma envios automaticamente. Leituras podem usar tentativas limitadas dentro do prazo, respeitando throttling; política exata pertence ao plano.

Separar estados de domínio: rejeitado antes do efeito, aceito pelo serviço, observado em Enviados e desconhecido. Graph `202 Accepted` prova somente aceitação; não prova entrega nem leitura. Gmail com retorno de mensagem confirma o retorno daquele endpoint, não leitura pelo destinatário. Linguagem ao usuário reflete esses fatos.

Verificadores Main vinculam a observação a conta, capacidade, argumentos e ExecutionContext. Nunca promover uma resposta forjada pelo renderer/Python ou um HTTP genérico a objetivo comprovado. Critérios de sucesso descrevem o que é verificável, como aceitação da solicitação de envio, sem exigir uma entrega final inexistente. Persistência de provas mantém referências e horários, sem corpo, assunto ou lista de destinatários em claro.

## 8. Painel e ciclo de vida

Painel em Sistema & Automação: switch, contas conectadas, adicionar Gmail/Outlook, padrão, reconectar/desconectar e diagnósticos seguros. Mostrar indisponível quando credenciais públicas OAuth não estiverem configuradas no build, sem apresentar botão funcional falso. Identificar expiração, revogação, bloqueio organizacional, rede, limite e falha parcial com mensagens distintas.

Consultar métricas/dados do módulo somente após confirmar disponibilidade, preservando guards Main. Habilitar módulo não dispara busca, login ou envio. Desativar bloqueia operações e limpa dados voláteis, mantendo configurações persistentes. Fechar X mantém o comportamento atual, sem serviço, tray, polling de novas mensagens ou automações em background nesta fase.

Chat e Live compartilham ferramentas/governança. Ao habilitar capacidades durante uma chamada, avisar que será necessário encerrar e iniciar outra para atualizar ferramentas; não derrubar a conversa atual. Encerrar a chamada cancela suas tarefas conforme o orquestrador existente.

## 9. Verificação e divisão posterior dos planos

Depois da aprovação desta especificação, detalhar entregas sequenciais e seus contratos:

1. Fundação de contas, cofre, store/migração e configuração OAuth de publicador.
2. Login/logout/refresh e adaptadores de leitura/busca multi-conta.
3. Rascunhos, envio/resposta, organização, diário e reconciliação de efeitos.
4. Anexos, IPC/painel e integração de capacidades/verificadores chat/Live.
5. Aceite integrado, gates externos e documentação comercial.

Cada plano conterá testes RED→GREEN, arquivos, contratos de entrada/saída e critérios de conclusão. Fixtures sintéticas cobrem state/PKCE/replay, refresh simultâneo, cofre indisponível, ID cruzado entre contas, respostas pela conta correta, busca parcial/paginação, token revogado, falsificação de prova, crash antes/depois de request, retries ocultos, cancelamento tardio, anexos adulterados e conteúdo malicioso.

Reutilizar testes Chromium, stdio Python/Main e suites de módulos; nenhum acesso a conta real por padrão. Não considerar fixture de provedor como aceite OAuth/API real. Teste real de conexão/envio terá escopo, contas e destinatários de teste explicitamente combinados, sem enviar mensagens a terceiros por iniciativa do agente de desenvolvimento. Não gerar executável por rotina; justificar qualquer teste que necessite dele.

## 10. Dependências externas e aceite

Versões exatas dos SDKs e composição MIME serão pesquisadas e fixadas no plano, antes de instalar. Não escrever OAuth manualmente para evitar dependência e não contratar serviço de integração intermediário sem decisão.

Publicador precisa configurar projetos, clientes desktop, tela de consentimento, identificadores públicos e políticas/domínios aplicáveis. Contas corporativas podem exigir aprovação do administrador. Gmail com escopos restritos exige avaliação da verificação aplicável; necessidade de avaliação adicional depende do processamento/transferência de dados e exceções. Revisar também políticas de uso de dados quando conteúdos forem encaminhados ao provedor de IA configurado. Não assumir que execução local elimina todos os requisitos comerciais.

O desenvolvedor não criará projetos externos, publicará consentimento ou usará credenciais pessoais apenas por esta aprovação de desenho. Cadastro concluído, integração testada e aprovação para distribuição são gates distintos. Ausência de configuração externa é pendência explícita, nunca motivo para simular sucesso.

Aceite: operações e falhas coerentes nos dois provedores, isolamento entre contas, ferramentas combináveis pelo orquestrador, ausência de segredos no renderer/logs, cancelamento sem replay, UI verdadeira e testes reais acordados. Release assinado/VM limpa permanecem gates finais do projeto.

## 11. Fontes oficiais consultadas

- [OAuth desktop Google: cliente público, navegador, PKCE e callback local](https://developers.google.com/identity/protocols/oauth2/native-app).
- [Escopos Gmail e classificação](https://developers.google.com/workspace/gmail/api/auth/scopes).
- [Verificação de escopos restritos Google](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification).
- [Gmail: send](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send).
- [Microsoft: cadastro e tipos de conta](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app).
- [Graph: permissões](https://learn.microsoft.com/graph/permissions-reference).
- [Graph v1.0: sendMail e significado de202](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0).
- [MSAL Node: cache e aquisição silenciosa](https://learn.microsoft.com/en-us/entra/msal/javascript/node/caching).

## 12. Autorrevisão e próximo gate

Conferidos: arquitetura Main coerente com os SDKs aprovados; ausência de segredo desktop tratado como segredo de servidor; resposta versus conta padrão; busca parcial; anexos sem interpretação; cancelamento versus efeito remoto; aceitação versus entrega; loopback transitório versus zero portas do sidecar; documentos e release fora do escopo.

Números da seção6 e detalhes das operações integram o documento aprovado. Nenhum código/dependência/projeto externo criado nesta rodada. Gate da especificação concluído por aprovação expressa; próximo gate é revisão dos planos separados produzidos com writing-plans. Método de execução previamente escolhido permanece nativo/main, sem commits automáticos.
