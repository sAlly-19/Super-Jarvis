# Lembretes — desenho em detalhamento

Atualizado em 27/10/2026. **Desenho e planos aprovados pelo usuário.** Etapas01–04 implementadas e validações locais05/pacote aprovadas. Módulo desativado por padrão, habilitável no painel. Permanece pendente o aceite operacional do executável comercial com licença ativa e X/restart real; harness isolado não substitui esse gate. Assinatura de produção/VM limpa e IA real são verificações separadas. [Planos](../plans/2026-10-27-reminders-00-execution-map.md) e [progresso](../plans/2026-10-27-reminders-progress.md) registram evidências e limites.

## Decisões confirmadas

- SQLite local no Main, reutilizando o estado modular/orquestrador; consentimento geral Total Control, sem confirmação por operação.
- Agenda só com processo do aplicativo aberto. Minimização preservada; X encerra normalmente. Sem bandeja nova, serviço Windows, inicialização automática ou tarefa do Windows.
- Reabertura/retomada mostra resumo dos lembretes atrasados, sem disparar todas as ocorrências nem executar ações retroativas. Exibição não conclui/adia/exclui lembretes.
- iCalendar apenas importação/exportação manual de .ics; sem URL, CalDAV, Apple ou sincronização automática.
- Escolha recebida nesta rodada: lembrete mensal no dia31 avisa no último dia nos meses mais curtos. Preservar anchorDay=31: fevereiro não desloca permanentemente as próximas ocorrências para28/29.
- Escolha recebida nesta rodada: importar eventos e tarefas com data. Evento vira aviso no início; tarefa vira aviso no vencimento. Item sem data utilizável é relatado como não importado, sem data inventada.
- Escolha recebida nesta rodada: eventos importados de dia inteiro avisam às09:00 no fuso configurado, com opção de alterar esse horário.
- Escolha recebida nesta rodada: reimportação atualiza somente itens não editados no Jasper; alterações locais são preservadas e conflitos relatados, sem duplicar silenciosamente o mesmo item.
- Escolha recebida: usar biblioteca especializada `ical.js` para ler/gerar .ics. Nova dependência autorizada para este módulo; importação permanece manual. Versão exata e instalação serão tratadas no plano executivo após aprovação do desenho.
- Escolha recebida: lembretes existentes mantêm o horário no fuso original quando o computador muda de fuso. Só alterar o fuso de um lembrete mediante edição explícita desse item; não reagendar automaticamente por viagem ou mudança do Windows.
- Escolha recebida: se uma mudança de relógio tornar o horário local agendado inexistente, avisar no primeiro horário válido após a mudança. Preservar a hora civil original para as próximas ocorrências; o ajuste vale apenas para a ocorrência afetada. Essa política dos lembretes Jasper não autoriza mudar silenciosamente a semântica de um RRULE importado.

## Experiência proposta

Comandos naturais: criar/listar/consultar/editar/concluir/adiar/excluir lembretes individuais ou em lote; recorrências diária/semanal/mensal. Tela existente do módulo permite listar, alterar e importar/exportar manualmente. A IA redige respostas contextuais; Main confirma mutações reais por ID/revisão, sem declarar gravação por mera saída de shell.

Notificação local contém título e horário. Preferência de notificação respeitada e dados preservados quando módulo/licença indisponível. Nenhuma execução de PowerShell, e-mail ou webhook é associada ao lembrete nesta fase.

## Contratos arquiteturais propostos

Main implementa RemindersStore (CRUD/revisão), RemindersScheduler (vencimentos/retomada), RemindersService (licença/política/verificação) e ICalendarCodec (intercâmbio). Migração005 adiciona reminders/occurrences/delivery records, sem duplicar configurações ou segredos. Datas persistem UTC + identificador IANA + data/hora civil de referência, sem depender do fuso atual do Windows para reinterpretar dados antigos.

Ferramentas propostas: reminder_create/list/get/update/delete/complete/snooze. Entradas tipadas em catálogo próprio do módulo reminders; não restringem PowerShell/computer. Chamadas deste módulo são executadas no Main e mediadas pelo mesmo broker: a atualização atual que assume computer em session/revision/stop deve ser generalizada por moduleId antes de habilitar reminders. Python não abre SQLite nem agenda notificações.

Cada mutação usa ID de invocação estável e transação com compare-and-swap; replay de criação não duplica itens. Prova é a linha/revisão observada no Main, não texto do modelo. Desligar o módulo impede notificações/novos despachos, preserva registros e invalida ticks ainda não admitidos.

## Recorrência e calendário — propostas pendentes

Lembretes criados no Jasper: proposta de usar o fuso configurado como padrão de novos itens, mostrado ao usuário; recorrências mantêm hora civil e anchorDay. Política aprovada para itens existentes: alterar o fuso do Windows não muda seu fuso nem seu agendamento; mudança do item somente por edição explícita. Data relativa ambígua pede esclarecimento de intenção, sem nova confirmação operacional.

Importados: preservar TZID/UTC e regra reconhecida do arquivo; horário flutuante precisa ser associado explicitamente ao fuso escolhido da instalação e essa interpretação deve constar do resumo. Eventos de dia inteiro usam09:00 no fuso configurado, ajustável, conforme escolha recebida; falta definir como uma alteração dessa preferência afeta os itens já importados.

RFC5545 define VEVENT/VTODO e considera inválidas certas ocorrências geradas por RRULE; não converter silenciosamente RRULE de arquivo para a regra interna de último dia. Proposta: preservar semântica suportada do arquivo; exportar recorrência própria do Jasper com regra equivalente ao anchorDay/clamp quando representável, ou recusar explicitamente exportação sem equivalência. Fonte primária: [RFC5545](https://www.rfc-editor.org/rfc/rfc5545.html).

Primeiro codec deve reconhecer um subconjunto documentado de recorrência diária/semanal/mensal, usando `ical.js`. EXDATE/RDATE/RECURRENCE-ID ou TZID que não puder representar fielmente precisam gerar item não importado/diagnóstico, nunca perda silenciosa. Não expandir recorrências ilimitadas em memória. A cobertura exata da primeira entrega ainda será revisada; não escrever parser próprio paralelo.

Alternativa escolhida pelo usuário: biblioteca especializada `ical.js`, em vez de leitor próprio. A [documentação oficial do ical.js](https://github.com/kewisch/ical.js) também exige atenção a definições de fuso ausentes dos arquivos; adotar a biblioteca não elimina a política de timezone e os testes. Nenhuma instalação feita nesta rodada de desenho.

## UID, conflitos e limites propostos

UID + origem estável identifica item importado; reimportação idêntica não duplica. Política aprovada: atualizar alteração externa só quando o item não foi alterado localmente; conflito preserva local e aparece no resumo, sem sobrescrita silenciosa. Comparação de versão/base importada ainda será detalhada no plano. Preservar UID na exportação. Arquivo com UID duplicado conflitante é rejeitado por item como proposta técnica.

Propostas numéricas: .ics até2MiB/1.000 componentes; título200 e descrição4.000 caracteres; listagem paginada100; lote100 itens e transação por lote válido. Rejeitar conteúdo binário/URL remota, não executar alarmes PROCEDURE nem abrir anexos. Esses valores ainda precisam de aprovação, sem relação com os limites do PowerShell.

## Scheduler e prova de entrega

Proposta: ticker Main com relógio injetável, além de sinais de resume; calcular próxima ocorrência, não percorrer infinito. Claim atômico por reminderId/occurrence/revisão evita dois disparadores da mesma instância. Após encerramento/suspensão, agrupar vencidos para resumo, não executar retroativamente.

Sistema de notificações não garante leitura pelo usuário. Persistir tentativa/aceitação e confirmação de apresentação no renderer quando aplicável; não marcar como lido sem evento correspondente. Política aprovada para horário inexistente: primeiro horário válido seguinte, sem deslocamento permanente da série. Horário duplicado e janela de crash seguem as propostas para aprovação abaixo; não prometer exactly-once no Windows sem prova.

## Divisão proposta da implementação

1. Modelo/store/migração e política do módulo, com clock fake e testes CAS/replay.
2. Broker multi-module e ferramentas Main verificadas, sem afetar computer/chat/Live.
3. Scheduler/retomada/notificações e desligamento/licença, testes de corrida/crash.
4. Tela e .ics manual, fixtures RFC round-trip, diagnósticos de perda não suportada.
5. Fluxo composto com provedor determinístico, pacote e smoke. Modelo real permanece adiado pelo usuário.

## Conjunto final proposto para revisão

As decisões recebidas acima estão fechadas. Recomendações restantes, ainda sem implementação:

1. Se o relógio voltar e repetir o horário local, avisar uma vez na primeira ocorrência desse horário; a chave da ocorrência identifica a data/hora civil planejada e impede segundo aviso no mesmo dia para a mesma instância.
2. Alterações do horário padrão de eventos de dia inteiro e do fuso padrão afetam novos itens/importações, sem reprogramar itens já existentes. Alterar um item existente exige edição explícita; a origem temporal e a preferência aplicada ficam registradas.
3. Se houver crash entre exibir e confirmar o resumo, reapresentar o resumo ainda não confirmado na próxima abertura, com os mesmos IDs para deduplicação na UI. Não repetir os avisos individuais ou ações antigas e não marcar como lido/concluído sem confirmação correspondente. A janela incerta pode reapresentar o resumo; esse limite deve ser documentado, não escondido como exactly-once.
4. Importação tem validação e resumo de itens importados/atualizados/ignorados/conflitantes. Não carregar anexos/URLs nem executar alarmes PROCEDURE. Usar os limites numéricos propostos acima e rejeitar regras que não puderem ser representadas fielmente, mesmo que o parser consiga lê-las.

Usuário aprovou este desenho e o conjunto acima. Planos executivos escritos para store/política, broker multi-module, scheduler/notificações, tela/.ics e aceite/pacote. Nenhum código de reminders nem instalação de dependência será iniciado antes da revisão/aprovação desses planos. Método nativo/main previamente escolhido é preservado.
