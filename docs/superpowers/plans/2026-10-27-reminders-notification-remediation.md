# Correção — aviso de lembrete não visível no Windows

> Atualização28/10/2026: este rascunho local foi superado pelo commit24106a7, recebido da outra máquina. O registro oficial de implementação e aceite manual está em [reminders-progress](2026-10-27-reminders-progress.md). Não executar novamente as ações pendentes abaixo. Continuidade atual: [revisão entre máquinas](2026-10-28-cross-machine-continuation.md).

27/10/2026. Main, sem commit/push. Skills: systematic-debugging, TDD e verificação antes de declarar correção. Incidente de aceite licenciado; módulo ainda não aceito integralmente.

## Evidências autorizadas, sem títulos ou credenciais

Usuário: lembrete salvo, módulo ativado, aplicativo aberto/minimizado e sem aviso percebido. Consulta SQLite somente leitura mostrou1 ocorrência notified,1 entrega shown, notifications_enabled=1,0 pendentes vencidas e nenhum batch atrasado. Portanto scheduler/entrega chegaram ao evento show do Electron; isso não prova banner visível ou leitura. Executável em uso é release/win-unpacked/Jasper AI.exe.

Fonte não chama app.setAppUserModelId. Existe atalho Jasper AI no Menu Iniciar do usuário, sem registro encontrado em HKCU/Software/Classes/AppUserModelId/com.jasper.avatar. Ausência desse registro isoladamente não prova a causa. Documentação oficial exige identidade/atalho na integração Windows: https://www.electronjs.org/docs/latest/tutorial/notifications e https://www.electronjs.org/docs/latest/api/app#appsetappusermodelidid-windows.

## Ações

- [x] Confirmar que foi salvo e que o app permaneceu aberto; examinar apenas contagens/estados.
- [ ] Configurar identidade Windows explícita alinhada ao appId do instalador, antes de criar janelas/notificações; teste RED→GREEN.
- [ ] Receber escolha sobre aviso visual no Jasper além do Windows. Não implementar esse comportamento antes da resposta.
- [ ] Validar sem usar chaves, títulos pessoais ou emitir toasts no perfil real por ferramenta. Rebuild/testes afetados; repetição manual licenciada será evidência de visibilidade.
- [ ] Registrar limites: show não é leitura; foco assistido/configuração do Windows podem suprimir banner; não atribuir causa definitiva sem evidência.

Não alterar configurações globais de notificações do Windows, desvincular licença, repetir lembrete antigo automaticamente ou iniciar próximo módulo.
