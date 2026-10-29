# Continuidade do cadastro Gmail — 29/10/2026

Usuário confirmou a continuidade da integração Gmail, aceitando o limite inicial exibido de 100 usuários para permissões não aprovadas. A proposta de adiar E-mails como integração futura foi substituída por esta decisão. Não alterar o módulo para integração futura nem iniciar Pesquisa Web nesta retomada.

## Estado verificado

- Implementação e testes locais existentes preservados; aceite real continua pendente.
- `resources/email-oauth.json` ausente; exemplo contém provedores nulos.
- Console informado pelo usuário: público Externo, status Em produção. Isso não comprova aprovação dos escopos nem remove o limite.
- Não criar IDs fictícios, reutilizar chave de IA ou credenciais Firebase como cliente OAuth.

## Próximas ações

1. No projeto Google correspondente, conferir Gmail API habilitada.
2. Criar cliente OAuth do tipo Aplicativo para computador e baixar JSON.
3. Usuário disponibilizar o arquivo localmente; mapear apenas campos necessários ao schema existente, sem imprimir credenciais.
4. Validar configuração e conexão Gmail em desenvolvimento, sem gerar instalador. Não enviar mensagens reais sem destinatário/escopo autorizados.
5. Registrar resultados reais separadamente dos testes sintéticos anteriores.

Downloads de anexos permanecem adiados. Outlook não faz parte deste próximo cadastro. Sem commit, push ou deploy nesta retomada.

## Configuração local realizada

JSON de aplicativo instalado encontrado na raiz do site de vendas. Validado o tipo instalado e redirect loopback, sem imprimir valores. Criado `resources/email-oauth.json` no desktop com Google configurado e Microsoft nulo, preservando o original. Adicionados ignores específicos no desktop (configuração local e downloads OAuth) e no site (downloads OAuth); ambos conferidos com `git check-ignore`.

O leitor real `readEmailPublisherConfig` aceitou a configuração. A primeira tentativa de empacotar esse leitor para a checagem falhou por acesso ao diretório ancestral no sandbox; a checagem final usou transformação TypeScript em memória, sem resolver diretórios ancestrais, e passou. Nenhuma alteração no código do produto, chamada Google, login, envio ou instalador nesta etapa. Conexão real permanece pendente: reiniciar o aplicativo em desenvolvimento e selecionar Conectar Gmail.

A configuração real é local e ignorada no Git; a distribuição futura precisará fornecer o cadastro do publicador na esteira de release, sem depender deste arquivo existir no checkout de outra máquina.
