# Controle do computador — progresso e retomada

> **SUPERADO:** após esta entrega, o usuário rejeitou A e ordenou reverter para B. Estado corrente e evidências: [plano B](2026-10-27-computer-control-plan-b.md). Este registro preserva a história de A, não descreve o catálogo atual.

Atualizado em 27/10/2026. Branch: main. Alternativa A autorizada pelo usuário conforme o plano, incluindo C2/C3. Implementação e validação local concluídas. Aceite com provedor real continua diferido pelo usuário.

## Artefatos e escopo

- [Desenho aprovado](../specs/2026-10-27-computer-control-design.md).
- [Plano em cinco tarefas](2026-10-27-computer-control-implementation.md).
- [Roteiro histórico](2026-10-26-modular-agent-03-computer-control.md).

Preservados PowerShell livre, Total Control geral sem confirmação por operação, main, licenciamento, chaves independentes e comportamento de texto/Live. Nenhum commit/push ou publicação. Nenhuma chamada a IA/voz externa nesta entrega.

## Implementação

1. Plano completo aceito no Main, guard volátil, comparação de capacidade/args e resolução de bindings com outputs validados. Protocolo taskRuntimeVersion=2; rejeita versão anterior. As seis ferramentas novas exigem contexto de tarefa, sem fallback legado.
2. find_application, inspect_path e inspect_processes com limites/schemas estritos, consultas clássicas App Paths e observações de identidade sem conteúdo de arquivos.
3. open_application com argv separado/ambiente mínimo; open_path usa ShellExecuteExW sem afirmar janela aberta; move_path usa MoveFileExW flags=0, mesmo volume/destino ausente, sem sobrescrita ou rollback. Reparse e caminhos ambíguos recusados.
4. Verificadores Main; migração004 persiste somente referências opacas e metadados, atomicamente com avanço CAS. Provas sobrevivem ao fechamento/reabertura do SQLite. Sem reexecução após reinício.
5. Descrição na tela existente; resumos distinguem dados consultados, ambiguidade, abertura aceita e resultado desconhecido. Fluxos compostos e cancelamento nativos com fixtures temporárias.

## Evidências locais observadas

- RED→GREEN: guard ausente, aceitação indevida de plan_ready, protocolo/envio antigo Python, consultas, ações, schemas e provas. Primeiro teste esbuild exigiu execução fora do sandbox por filesystem; aprovação automática concedida. Sem contornar bloqueio de dados reais.
- Typecheck e build aprovados por npm run verify; suíte TS final: 238/238. Montagem adicional das descrições também aprovada em integridade e smoke.
- Python: 86/86; nenhum provedor real chamado. Um teste Live preexistente falhou intermitentemente em uma rodada (live_closed ausente); reexecuções passaram sem alterar esse teste.
- Seis cenários stdio: legacy, duas leituras, cancelamento PowerShell, inspect→move→inspect, find_application→open_application via binding e cancelamento durante abertura do auxiliar. Arquivos somente temp; auxiliar C# compilado em temp. PID observado ausente após cancelamento; dependente não executada; processo preexistente não usado como prova.
- test:package: 11/11, incluindo rejeição de runtime antigo, negociação v2 e movimentação real de fixture pelo worker compilado.
- package:dir, verify:package e smoke:packaged passaram. Montagem Electron adicional inclui texto corrigido das descrições; verify:package e smoke:packaged repetidos e aprovados nessa montagem final.
- Scanner ampliado para rastreados + novos não ignorados: 298 arquivos, zero achados. git diff --check sem falhas; avisos LF/CRLF do ambiente.

## Revisão e decisões técnicas

Skills brainstorming/writing-plans para desenho; executing-plans/TDD para código; receiving-code-review/systematic-debugging para achados; verification-before-completion/finishing-a-development-branch para encerramento. Revisão independente somente leitura encontrou dois Important: PID inexistente escapava na construção psutil.Process; resumos omitindo dados novos/ambiguidade/Shell aceito. Ambos reproduzidos com fixtures, testes RED e correções GREEN. Nenhum Critical apontado. Não alegar segunda revisão independente após correções.

Ruling: manter main sem worktree/commit por direção explícita do usuário/plano. Bash auxiliar não disponível: registro rastreável neste arquivo e logs em .superpowers/sdd/2026-10-27-computer-control-implementation. Pre-flight: tarefa1 fornece admissão para4; consultas2 fornecem snapshots para3/4; provas4 alimentam5. Limites de tarefa preservados, sem retries/revisão automática. Helpers de descoberta injetados exclusivamente na fixture de teste, sem switch de ambiente no produto.

Corrigido problema de codificação do pipeline PowerShell→Python nas descrições novas e neste registro; conteúdo final gravado em UTF-8. A montagem adicional inclui a correção.

## Limitações e próxima fase

Modelo/voz real continuam adiados por esgotamento de tokens do usuário. Teste composto com telemetria real bloqueado anteriormente não foi autorizado: não executar nem contornar revisão automática. Aceite nativo não substitui aceite de planejamento pelo provedor real. Assinatura comercial e VM Windows limpa permanecem gates separados. Terminal de testes usa Node26.8.2; package.json declara Node24, portanto não alegar reprodução desta rodada em Node24/CI.

Resultados verificados têm alcance limitado: processo iniciado não prova janela pronta; Shell aceito permanece desconhecido; movimentação observada não é sandbox contra todas as corridas do filesystem; cancelamento não desfaz etapas anteriores. UWP/MSIX, atalhos, URLs, UNC e copiar entre volumes fora desta fase.

Próximo passo após validação final: apresentar entrega e sugerir detalhamento do plano04 (lembretes). Não implementar outra fase automaticamente, nem alterar política/provedor. Preservar a pendência de modelo real.
## Encerramento

Tarefas 1–5 concluídas localmente. Pacote em release/win-unpacked/Jasper AI.exe. Provas finais: TS238/238; Python86/86; artefato11/11; build/typecheck, integridade e smoke aprovados. Sem API de IA/voz, commit/push ou nova fase. Retomar pelas limitações acima e pelo planejamento do módulo04 somente se autorizado.
