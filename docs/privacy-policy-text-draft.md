# Política de Privacidade — Jasper AI

> RASCUNHO PARA REVISÃO, NÃO PUBLICADO. Base técnica: código local do aplicativo e de jasper-site-sale consultado em29/10/2026. As notas editoriais no fim precisam ser resolvidas antes de publicar. Este documento não certifica conformidade jurídica ou aprovação do Google.

Última atualização do rascunho:29 de outubro de2026.

## 1. Responsável e contato

O responsável pelo Jasper AI é **Alisson Maciel Ferreira Santos**, pessoa física. Para dúvidas sobre tratamento de dados pessoais ou solicitações de privacidade, entre em contato pelo e-mail **alissontar18@gmail.com**.

Esta política descreve o tratamento de dados relacionado ao site https://jasper-avatar.web.app/, à comercialização/licenciamento e às funcionalidades do aplicativo desktop Jasper AI. Os dados envolvidos dependem das funções e integrações utilizadas.

## 2. Dados de compra e licença

O fluxo de compra utiliza nome e e-mail informados pelo comprador, identificação do pedido, produto, quantidade, valores e situação do pagamento. Essas informações permitem processar a compra, disponibilizar a licença e prestar atendimento.

O checkout é realizado pelo Mercado Pago. O sistema Jasper recebe identificadores e estados de pagamento necessários à confirmação do pedido. Informações inseridas diretamente no ambiente de pagamento são também tratadas pelo respectivo prestador, segundo seus próprios termos e política.

A ativação e validação da licença utilizam a chave de licença, identificadores da instalação/dispositivo, uma representação derivada da máquina e registros de estado e atividade. Esses dados permitem vincular a licença ao dispositivo, validar seu uso e lidar com liberação ou revogação. A autorização para conectar uma conta Google é distinta da ativação da licença.

## 3. Dados utilizados pelo assistente

Conforme as funções ativadas e os pedidos realizados, o Jasper pode processar mensagens, preferências, informações de memória, lembretes, dados de uso do computador e conteúdo necessário a ações solicitadas. Funções de voz utilizam áudio do microfone; funções de imagem ou controle podem envolver imagens da tela e informações dos aplicativos com os quais você interage.

O processamento pode ocorrer no computador e nos serviços externos configurados para inteligência artificial, voz e demais integrações. Não é correto considerar todo o funcionamento do Jasper exclusivamente local. Ativar controle do sistema não equivale, por si só, a autorizar qualquer finalidade secundária de tratamento de dados.

## 4. Conexão com o Gmail

A conexão da conta Google é opcional e realizada no navegador do sistema, por autorização OAuth. O Jasper não solicita sua senha Google dentro do aplicativo.

Mediante os acessos concedidos, o módulo de e-mails utiliza informações de identificação da conta e dados de mensagens, como remetentes, destinatários, assuntos, datas, texto, pastas/rótulos e metadados de anexos. Isso permite pesquisar, consultar e resumir mensagens, preparar rascunhos, enviar, responder, encaminhar e organizar e-mails de acordo com as funcionalidades utilizadas.

O fluxo implementado solicita identificação da conta e o escopo Gmail `gmail.modify`. Os tokens de autorização são armazenados no computador com proteção do armazenamento seguro do Electron/Windows. O módulo desktop não utiliza um servidor Jasper intermediando os tokens ou a caixa postal.

Conteúdo de e-mails consultados pode integrar o contexto enviado ao serviço de IA configurado pelo usuário, para compreender pedidos e compor respostas. Portanto, o acesso local à conta não significa que o texto consultado nunca seja transmitido a terceiros. Antes da distribuição pública, o fluxo efetivo de processamento deve corresponder às informações de compartilhamento e aos requisitos Google validados para a integração.

Na versão atual, anexos selecionados para envio ou preservados no encaminhamento são tratados como arquivos, sem interpretação do conteúdo pelo módulo. Downloads de anexos estão indisponíveis enquanto essa capacidade estiver adiada.

## 5. Prestadores e processamento externo

A arquitetura do site utiliza serviços Google Firebase para hospedagem, conteúdo e autenticação administrativa, Cloudflare Worker/D1 para operações de pedidos/licenças e Mercado Pago para checkout. Esses serviços recebem os dados necessários aos fluxos em que participam; isso não significa que todos recebam o conteúdo de e-mails.

O aplicativo também pode utilizar Google Gemini, Groq ou execução local com Ollama, conforme a configuração do usuário, além dos serviços de voz selecionados. Em modalidades remotas, informações necessárias à solicitação podem ser transmitidas ao provedor correspondente. O uso de uma chave própria de API não elimina esse processamento.

Prestadores externos podem processar dados em outros países. Localização, retenção, condições de uso e salvaguardas aplicáveis precisam ser consideradas de acordo com o serviço efetivamente utilizado. Não presumimos, nesta política, que todas as configurações de todos os prestadores tenham a mesma retenção ou as mesmas condições de uso para treinamento de modelos.

## 6. Armazenamento, retenção e segurança

O aplicativo mantém configurações e dados operacionais no computador, de acordo com as funções utilizadas. Credenciais contempladas pelo armazenamento seguro são protegidas por mecanismos do Electron/Windows. Essa proteção não significa que todo arquivo local contenha dados criptografados ou que qualquer sistema seja imune a incidentes.

Registros de compra, pagamento, licença e atendimento têm tratamento separado dos dados locais do assistente. A retenção e a exclusão devem considerar a finalidade do registro, o funcionamento do serviço e as obrigações legalmente aplicáveis. O encerramento do aplicativo não equivale à exclusão de todos os seus dados.

Não há, neste texto, promessa de exclusão automática global ou prazo único para todas as categorias. Solicitações de privacidade devem ser encaminhadas ao contato informado na seção1 para avaliação e atendimento, observadas as hipóteses aplicáveis de conservação e os limites de controle sobre prestadores terceiros.

## 7. Desconexão e solicitações de privacidade

Você pode desconectar a conta de e-mail no Jasper. Isso remove o segredo local daquela conexão e impede novas operações por ela. Para revogar também a permissão no Google, utilize os controles de acesso de aplicativos de terceiros da sua conta Google. Desconectar não desfaz mensagens ou outras operações já aceitas pelo provedor.

Conforme os pressupostos e limites da legislação aplicável, você pode solicitar informações sobre tratamento e compartilhamento, acesso e correção de dados e, quando cabível, exclusão, bloqueio ou anonimização, além da revogação de consentimento. Podemos precisar verificar sua identidade de forma proporcional antes de atender a uma solicitação. Contato: **alissontar18@gmail.com**.

## 8. Atualizações

Esta política deve ser atualizada quando houver alteração relevante nas práticas descritas. Mudanças no acesso ou uso de dados Google precisam ser refletidas nas informações apresentadas ao usuário e nas autorizações aplicáveis, quando exigidas. A versão vigente deve permanecer acessível no site e na configuração OAuth.

---

## Notas editoriais — não publicar esta seção nem o aviso de rascunho

1. Conferir se o deploy ativo corresponde ao repositório local consultado. Não foram inspecionados segredos nem painéis de produção.
2. Completar a informação de cookies, armazenamento no navegador e ferramentas de métricas efetivamente habilitadas. Não afirmar ausência de analytics sem conferir a produção.
3. Definir e conferir bases legais por finalidade, critérios/prazos de retenção, backups e procedimento operacional para atendimento/exclusão. Não escolher bases legais por conveniência nem tratar o consentimento operacional Total Control como autorização genérica de privacidade.
4. Rever com os requisitos Google a transmissão de conteúdo Gmail a cada serviço de IA, uso limitado e condições de retenção/treinamento. Não inserir declaração de conformidade ou de não treinamento sem garantir o comportamento correspondente.
5. Acrescentar links das políticas dos prestadores efetivamente utilizados e validar os mecanismos de transferências internacionais pertinentes. Evitar uma promessa genérica de que aceitar a política torna todo compartilhamento permitido.
6. Revisar a redação jurídica e confirmar os compromissos que o responsável consegue cumprir. O trecho de direitos é uma síntese, não uma reprodução integral nem garantia de atendimento irrestrito em qualquer hipótese.
7. Publicar a página em rota pública, incluir link no rodapé/homepage e conferir o acesso sem login antes de preencher o URL no Google. Nenhuma publicação foi realizada nesta atividade.

Referências de revisão: [LGPD](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm), [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), [orientações OAuth para produção](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance).
