# Política de privacidade do Jasper — levantamento para rascunho

Data:29/10/2026. Documento de trabalho, não publicado e não aprovado como texto jurídico final.

## Objetivo e estado

Preparar uma política que descreva o site de vendas e o aplicativo desktop, incluindo a conexão Gmail necessária ao OAuth. Site informado pelo publicador: https://jasper-avatar.web.app/. Endereço proposto para a política: https://jasper-avatar.web.app/privacidade, somente após publicar e conferir a página. A rota não foi criada nesta atividade.

Nome do produto informado: Jasper AI. Responsável informado pelo usuário: Alisson Maciel Ferreira Santos, pessoa física. Contato de privacidade: alissontar18@gmail.com. O publicador ainda não tem política publicada. Não solicitar CPF nem documentos pessoais para este levantamento.

## Conteúdo técnico confirmado no projeto a descrever

- Aplicativo comercial Windows com validação de licença; não confundir ativação do produto com consentimento de conta Google.
- Conexão opcional de e-mails via navegador do sistema e OAuth. Escopos do Gmail: identidade/e-mail e gmail.modify para as funções implementadas de consulta, rascunho, envio e organização.
- Tokens do módulo e-mail protegidos localmente pelo safeStorage do Electron/Windows. A arquitetura deste módulo não usa um servidor Jasper para intermediar tokens ou caixas de e-mail. Não generalizar esta afirmação para licenciamento, vendas ou demais integrações.
- Conteúdo consultado pode ser processado pelo provedor de IA escolhido/configurado pelo cliente, inclusive serviços remotos. O texto não pode afirmar que todos os dados permanecem exclusivamente no computador.
- Referências de arquivos selecionados no painel são temporárias; anexos para envio e encaminhamento têm limites. Downloads de anexos estão adiados e bloqueados. O módulo não interpreta o conteúdo de anexos.
- Desconexão local remove o segredo local e impede novas operações. Revogação do consentimento no Google é uma ação distinta. Mensagens já aceitas não são desfeitas pela desconexão.
- Histórico de tarefas privilegia metadados; isto não comprova que todas as conversas, memórias, logs ou dados de outros módulos tenham a mesma retenção. Conferir cada armazenamento antes de prometer prazo ou exclusão global.

## Estrutura do texto a preparar

1. Identificação e contato do responsável.
2. Abrangência: site, compra/licença e aplicativo.
3. Dados acessados/coletados por funcionalidade e finalidade correspondente.
4. Acesso à conta Google, ações permitidas, processamento por IA e escolhas do usuário.
5. Armazenamento local, servidores envolvidos, destinatários e eventuais transferências internacionais.
6. Retenção, exclusão, desconexão e revogação de acesso, com limites operacionais concretos.
7. Segurança, solicitações de privacidade e atualização da política.

## Informações pendentes antes de finalizar/publicar

- Identificação e contato confirmados acima. Não acrescentar endereço, documento ou razão social fictícios.
- O repositório local irmão `../jasper-site-sale` foi encontrado e consultado apenas em leitura. README, worker/migrations/0001_initial.sql e serviços indicam Firebase Hosting/Authentication/Firestore, Cloudflare Worker/D1 e Mercado Pago Checkout Pro, com nome/e-mail de comprador, pedidos, pagamentos e vínculo licença/dispositivo. Não foram abertos .env, credenciais administrativas ou segredos. A correspondência com o deploy público ainda não foi comprovada.
- Conferir cookies, métricas, retenção e configuração de produção efetivos; dependência instalada não comprova que uma funcionalidade esteja ativada.
- Dados e retenção efetivos do servidor de licenças, compras, backups e logs, além de procedimentos de exclusão/suporte.
- Revisar o fluxo de conteúdo Google para os provedores de IA efetivamente suportados e as condições aplicáveis; não prometer que terceiros nunca retêm dados ou usam dados para treinamento sem verificar configurações/termos pertinentes.
- Confirmar conteúdo público, acesso sem login e links entre homepage e política. A existência de um URL proposto não comprova página publicada.
- Conferência jurídica e dos requisitos de verificação Google antes da distribuição comercial; este levantamento não certifica conformidade ou aprovação OAuth.

## Fontes oficiais consultadas

- [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy): transparência sobre acesso, uso, armazenamento e compartilhamento de dados e disponibilização da política.
- [OAuth production readiness](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance): identidade, homepage, domínios e verificação de escopos para produção.
- [LGPD, texto oficial](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm): referência para direitos e revisão jurídica; não é certificação de conformidade do produto.

## Continuidade

Nenhum código, site, hosting ou cadastro externo alterado. Texto de trabalho em `docs/privacy-policy-text-draft.md`, com identificação confirmada e notas editoriais de validação. Publicar somente a versão revisada no projeto de site correto; o repositório atual é o aplicativo desktop e não deve receber uma implementação de hosting por suposição. Não preencher o URL de política como existente enquanto não estiver publicado e acessível.
