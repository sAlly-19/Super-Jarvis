# E-mails — roteiro de implementação

> **For agentic workers:** REQUIRED SUB-SKILL após aprovação: superpowers:executing-plans ou superpowers:subagent-driven-development. Não iniciar código a partir deste rascunho.

**Goal:** Entregar o módulo E-mails para Gmail e Outlook, integrado ao orquestrador.
**Architecture:** Desenho em definição; reutilizar governança Main e coordenação Python existentes.
**Tech Stack:** SDKs oficiais Google/Gmail e Microsoft Graph/MSAL aprovados como abordagem; versões, contratos e dependências exatas serão fixados no plano executivo.
**Spec:** [Especificação E-mails para revisão](../specs/2026-10-28-email-design.md).
**Status:** especificação escrita aprovada; [mapa e planos executivos01–05](2026-10-28-email-00-execution-map.md) salvos para revisão própria. Código ainda não iniciado.
**Depends on:** 01 + 02 + lembretes para fluxo composto.

## Global Constraints
Aplicam-se todas as restrições e o procedimento TDD do [roadmap](2026-10-26-modular-agent-00-roadmap.md). Configuração por Sistema & Automação, persistência do switch, permissões verificadas na execução, dados preservados ao desligar e nenhuma nova tarefa automática após desativação.

## Arquivos e reuso a confirmar
- Reutilizar: src/main/config/config-store.ts; src/main/services/operational-access.ts.
- Caminho proposto: `src/main/modules/email/` (não criado; responsabilidade/contrato final dependem das decisões).
- Testes propostos: `test/email-module.test.ts`.
- Interfaces: consumir registro/estado/política de 01 e execução/resultados de 02; contratos exatos serão definidos somente após aprovação dos núcleos.

## Escopo funcional
Gmail/Outlook oficiais: conectar/desconectar, ler threads, pesquisar, resumir, importância com evidência, rascunhar, enviar, responder/encaminhar, arquivar, marcadores/pastas, lido/não lido, lixeira e extração de prazos.

## Decisão a perguntar antes de detalhar
> Registro cronológico das escolhas abaixo. Estado vigente consolidado na especificação vinculada acima; pendências antigas já respondidas não devem ser perguntadas novamente.
28/10/2026: usuário escolheu Gmail e Outlook para esta fase. Documentos adiado. Integração é um novo subsistema (caminho arquitetural da skill brainstorming): definir escopo, comparar abordagens, aprovar desenho escrito e depois plano antes de implementar. Sem gerar executáveis salvo necessidade real de teste.

Pendentes: escopos OAuth leitura versus escrita; app OAuth comercial/verificação e consentimentos (D5). Consentimento geral Total Control sem confirmação por operação permanece; escolha das funcionalidades não é nova confirmação por operação.

Escopo escolhido posteriormente: opção1, leitura/pesquisa/resumos/organização e envio/resposta para Gmail e Outlook. Abordagem de bibliotecas ainda em discussão: proposta de SDKs oficiais de provedores/autenticação, com adaptadores próprios integrados ao Main/orquestrador; nenhuma dependência instalada ou arquitetura aprovada implicitamente. Fontes consultadas: quickstart Node da Gmail API, google-auth-library e MSAL Node/Graph SDK oficiais.

Decisões posteriores aprovadas: usar SDKs oficiais Google/Gmail e Microsoft Graph/MSAL, com adaptadores próprios integrados ao Jarvis. Usuário escolheu opção2: múltiplas contas simultâneas de cada provedor, pessoais e profissionais. Ainda definir regra de seleção de conta quando o pedido não especificar remetente/conta; não inferir autorização para escolher uma alternativa silenciosamente. Desenho e plano executivo ainda não aprovados; nenhuma instalação ou implementação autorizada por essas decisões isoladas.

Seleção de conta resolvida: opção1 aprovada, conta padrão configurável quando o pedido não especificar conta; respostas usam a conta que recebeu a mensagem. Conta explicitamente indicada prevalece para ações novas. Não trocar silenciosamente de conta se a selecionada estiver desconectada/indisponível. Isso não adiciona confirmação por operação. Escopo de busca sem conta especificada (padrão versus todas conectadas) ainda precisa ser distinguido da escolha do remetente no desenho.

Busca resolvida posteriormente: opção1 aprovada, pesquisar em todas as contas conectadas quando o pedido não restringir a conta, identificando a origem de cada resultado. A conta padrão permanece regra de novos envios; respostas permanecem vinculadas à conta destinatária original. Tratamento de anexos ainda não definido; Documentos continua adiado.

Anexos resolvidos posteriormente: opção1 aprovada, listar, baixar e enviar anexos; interpretação/resumo de conteúdo fora desta entrega, mantendo Documentos adiado. Não instalar extratores nem executar anexos como consequência desta escolha.

Próxima decisão de desenho: cadastro OAuth administrado pelo publicador Jasper (cliente conecta sua conta no navegador) versus cadastro técnico fornecido por cada cliente. Recomendação apresentada: cadastro Jasper, adequado à experiência comercial. Cadastro/publicação/verificações dos provedores são tarefas externas separadas; esta proposta não cria projetos nem concede acesso a contas. Fontes oficiais consultadas: Google OAuth para aplicativos instalados e Microsoft Entra registro de aplicativos/contas pessoais e organizacionais.

Cadastro OAuth resolvido posteriormente: usuário aprovou cadastros administrados pelo Jasper. Cliente final conecta a conta pelo navegador; não precisa criar projeto técnico próprio. Sem cadastro externo realizado nesta rodada. As decisões anteriores marcadas como pendentes estão superadas pelas resoluções posteriores nesta seção.

## Consolidação atual — desenho para revisão

Usuário aprovou a arquitetura local no Main em resposta “OK”. Especificação escrita criada em28/10/2026 com autorrevisão e fontes oficiais. Próximo gate: aprovação do documento escrito; depois writing-plans para os cinco planos sequenciais propostos. Não escrever código, instalar dependências ou abrir OAuth real nesta rodada.

Decisões do usuário: Gmail e Outlook com SDKs oficiais; várias contas pessoais/profissionais; novos envios pela conta padrão configurável quando não indicada; respostas pela conta original; pesquisa em todas as contas conectadas com origem explícita; listar/baixar/enviar anexos sem interpretar; cadastros OAuth do Jasper; Total Control sem confirmação por operação. Documentos adiado. Executáveis somente no fim ou se indispensáveis para testes.

Proposta técnica ainda sujeita à aprovação do desenho: autenticação e adaptadores no Electron Main, usando PKCE/navegador do sistema; tokens criptografados localmente, separados por conta e indisponíveis ao renderer/Python; SQLite para metadados de conta e registros mínimos de operação, sem espelhar a caixa inteira. Orquestrador recebe ferramentas e resultados limitados, nunca credenciais. Desativação/licença/cancelamento invalidam tarefas; resposta de rede ambígua no envio não autoriza reenvio automático. Cadastros Jasper identificam o aplicativo, sem servidor central para guardar caixas/tokens.

O fluxo desktop proposto pode precisar de listener loopback temporário exclusivamente durante o OAuth, fechado ao concluir/cancelar/expirar. Isso é uma decisão arquitetural a explicitar na especificação, não restabelece porta do sidecar nem serviço local permanente. Não implementar sem aprovação do desenho.

Alternativas para comparação: (A) SDKs executando localmente no Main, recomendado por reusar a fronteira atual; (B) backend Jasper centralizando tokens e acesso às caixas, exigindo nova infraestrutura e governança de dados; (C) SDKs em processo auxiliar dedicado, exigindo novo protocolo/ciclo de vida. A aprovação dos SDKs não seleciona implicitamente B ou C.

Fontes oficiais consultadas em28/10/2026: [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes), [OAuth desktop Google](https://developers.google.com/identity/protocols/oauth2/native-app), [verificação de escopos restritos](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification), [permissões Graph](https://learn.microsoft.com/graph/permissions-reference). Candidatos de escopo: gmail.modify e Graph Mail.ReadWrite/Mail.Send delegados, com escopos de identidade/offline estritamente necessários. Detalhar permissões por método e configurações comerciais no desenho; verificação Google e políticas organizacionais são gates externos, não comprovados por fixtures. Nenhuma instalação, código de produto, teste de integração ou publicação nesta rodada.

## Review Focus e testes de aceite
Token expirado/refresh/revogado; renderer sem tokens; prompt injection em mensagem; envio com resposta de rede ambígua não repetido; exclusão permanente exige autorização específica; prazo inferido não tratado como fato.

## Entregas separáveis
- [ ] Apresentar alternativas e obter decisão; pesquisar API oficial vigente ao detalhar integração externa.
- [ ] Especificar ferramentas com entradas/saídas, permissões, efeitos, timeout, cancelamento e verificações observáveis.
- [ ] Escrever teste vermelho para cada comportamento citado acima; fixar limites e mensagens no plano executivo.
- [ ] Implementar capacidade real e configuração/diagnóstico na tela existente; passar testes e regressões de chat/Live.
- [ ] Testar desligamento durante execução, reinício, licença revogada, configuração incompleta e falha parcial; sem expor segredo ou dado pessoal em auditoria.
- [ ] Demonstrar fluxo composto pelo orquestrador com evidência; testar aplicativo Windows empacotado.
- [ ] Registrar dependências, resultados reais e limitações; solicitar autorização antes de avançar para outra fase.

## Critério de conclusão
Não basta ferramenta funcionar isoladamente: switch persistente, configuração segura, estado operacional verdadeiro, descoberta pelo orquestrador, validação de permissão, cancelamento e artefato empacotado devem ser comprovados. Conta/serviço ainda não configurado é pendência, nunca sucesso simulado.

