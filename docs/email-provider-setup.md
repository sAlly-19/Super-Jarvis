# Conexão de e-mail no Jasper

Estado desta entrega: implementação e verificação local em andamento. Nenhuma conta real foi conectada, nenhuma mensagem real foi enviada e nenhum cadastro OAuth foi criado por esta atividade. Os testes usam contas sintéticas; isso não comprova aceite comercial dos provedores. Executáveis e testes de pacote ficam adiados conforme orientação do projeto.

Downloads foram adiados por decisão do usuário. Estão bloqueados na fachada e omitidos do catálogo negociado, até implementar proteção nativa contra troca concorrente do diretório no Windows. O helper de transferência existente e seus testes de nomes/limites não comprovam essa proteção. As demais funções continuam em validação; esta versão não deve ser anunciada como módulo concluído.

## Uso pelo cliente

Com licença, consentimento Total Control e módulo E-mails ativados, abra Sistema & Automação e escolha Conectar Gmail ou Conectar Outlook. O login ocorre no navegador do sistema. O cliente não fornece senha ao Jasper nem precisa criar um aplicativo OAuth. Se a configuração do publicador estiver ausente, o painel explica a indisponibilidade.

Podem coexistir várias contas. Defina uma conta padrão para novos rascunhos; se ficar indisponível, ela não é substituída automaticamente. Respostas e encaminhamentos mantêm a conta de origem. Buscas sem seleção de conta consultam as contas conectadas e identificam falhas parciais. Nunca interprete uma busca parcial como caixa vazia. O orquestrador usa referências diretas geradas pelo Main: firstRef para o primeiro resultado ordenado, ref/version da leitura e draftRef/operationId do rascunho; firstRef não representa todas as mensagens. Envio de rascunho novo exige leitura intermediária para obter a versão.

Para anexar arquivos ou baixar anexos, selecione a conta e os arquivos/pasta no painel. Copie as referências opacas para o pedido no chat; elas expiram em cinco minutos e pertencem à conta e sessão. Caminhos escritos em mensagens recebidas não autorizam acesso local. O módulo transfere arquivos sem interpretar nem executar seu conteúdo.

Limite da aplicação: dez anexos e 10MiB originais somados. O menor limite do provedor prevalece. O adaptador Graph desta versão não oferece upload resumível: cada novo arquivo precisa ter menos de3.000.000 bytes, e o JSON da requisição não pode ultrapassar4.000.000 bytes. Anexos originais são preservados ao encaminhar; responder não os copia automaticamente. O download não sobrescreve arquivos existentes.

Uma operação aceita pelo provedor não comprova entrega ou leitura pelo destinatário. Microsoft pode responder202 sem corpo ao enviar um rascunho. Se a conexão cair após um envio, o estado pode ser desconhecido; o Jasper consulta para reconciliar sem reenviar ou trocar de conta. [Microsoft Graph: enviar rascunho](https://learn.microsoft.com/en-us/graph/api/message-send?view=graph-rest-1.0).

Desconectar remove o segredo local e impede novas operações. Isso não cancela uma mensagem já aceita nem equivale à revogação remota do consentimento: para esta última, use os controles da própria conta Google/Microsoft. Credenciais locais são criptografadas pelo safeStorage do Electron/Windows; não há fallback em texto puro. Alterações de ferramentas durante uma chamada exigem encerrar e iniciar a chamada para habilitar as novas ferramentas; a conversa atual permanece aberta.

## Configuração do publicador — pendente

Parta de `resources/email-oauth.example.json` e instale `resources/email-oauth.json` antes de distribuir. Ele aceita schemaVersion1, google com clientId e, quando exigido para o cliente instalado, desktopClientSecret; microsoft com clientId e authority exatamente `https://login.microsoftonline.com/common`. Pode configurar só um provedor. IDs públicos identificam o aplicativo; nunca distribuir credenciais de um cliente confidencial, tokens de clientes ou senhas. Nenhum valor real foi adicionado nesta entrega.

Para Google, habilite Gmail API no projeto do publicador e cadastre cliente OAuth desktop e tela de consentimento. O fluxo usa PKCE, state, navegador externo e listener temporário loopback. Os escopos são openid, email e gmail.modify; o último é restrito. Conferir os requisitos de verificação e o uso pretendido dos dados antes de publicar. [OAuth para aplicativos instalados](https://developers.google.com/identity/protocols/oauth2/native-app), [escopos Gmail](https://developers.google.com/workspace/gmail/api/auth/scopes).

Para Microsoft, registre aplicativo público com audiência para contas organizacionais e pessoais. Use permissões delegadas Mail.ReadWrite e Mail.Send, sem segredo confidencial. Cadastre o redirect desktop `http://localhost/oauth/microsoft`: o código mantém esse caminho e acrescenta uma porta efêmera por tentativa, cuja correspondência é ignorada para localhost. O listener atende somente127.0.0.1, e state/PKCE continuam únicos por tentativa. Não cadastrar wildcard nem cada caminho aleatório. Correção validada apenas com browser/loopback sintéticos, sem login Microsoft real. [Restrições de redirect URI](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url), [configuração desktop](https://learn.microsoft.com/en-us/entra/identity-platform/scenario-desktop-app-configuration).

## Gates para comercialização

- [ ] Cadastro Google e Microsoft sob titularidade do publicador, configuração pública real e permissões conferidas.
- [ ] Consentimento, verificação e requisitos de distribuição dos provedores avaliados para o fluxo de dados efetivo, inclusive processamento pelo serviço de IA escolhido pelo cliente.
- [ ] Autorizar contas/destinatários de teste e escopo antes de qualquer login ou envio real.
- [ ] Validar Gmail e Outlook: conexão, conta padrão, busca parcial, resposta na origem, anexos, desconexão/reconexão, revogação durante tarefa e reinício sem replay.
- [ ] Aceite local integrado05 e revisão independente fechados com evidência separada do teste real.
- [ ] Teste de pacote/ASAR, assinatura e Windows limpo apenas na etapa de release ou se surgir necessidade concreta.

Não é necessário gerar instalador para testar o fluxo em desenvolvimento. Falta de cadastro, bloqueio administrativo, quota ou aprovação do provedor deve permanecer registrada como pendência, nunca como sucesso simulado.
