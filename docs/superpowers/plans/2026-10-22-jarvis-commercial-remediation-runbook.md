# Jasper Commercial Remediation Runbook

**Última atualização:** 22 de outubro de 2026
**Branch de referência:** `main`
**Commit de referência ao criar o plano:** `dd74f90`
**Especificação aprovada:** `docs/superpowers/specs/2026-10-22-jarvis-commercial-total-control-design.md`

## Objetivo

Este arquivo é o ponto de retomada para qualquer agente que continuar a correção. Execute os planos abaixo em ordem, atualize as caixas de seleção ao concluir cada tarefa e registre aqui o último commit verificado.

## Ordem de execução

- [x] Fase 1 — `2026-10-22-01-license-gated-runtime.md`
- [x] Fase 2 — `2026-10-22-02-private-sidecar-protocol.md`
- [x] Fase 3 — `2026-10-22-03-renderer-ipc-memory-cleanup.md`
- [ ] Fase 4 — `2026-10-22-04-commercial-packaging-release.md`

Não iniciar uma fase enquanto os testes e o commit final da anterior não estiverem verificados. Cada plano possui contratos `Produces` consumidos pelo plano seguinte.

## Linha de base verificada

- `npm.cmd run typecheck`: passou em 22/10/2026.
- `npm.cmd test`: 23 testes passaram em 22/10/2026 quando executado fora da restrição de leitura do sandbox.
- `npm.cmd run scan:secrets`: passou, 100 arquivos rastreados.
- `npm.cmd run build`: Main e preload compilaram; o bundle do renderer abortou por memória sob Node `v26.8.2`.
- O projeto declara Node `>=24 <25`; toda verificação de entrega deve usar Node 24, não o Node 26 da linha de base.
- O teste atual inicia FastAPI/Uvicorn em `127.0.0.1:8765`; essa expectativa deve desaparecer na Fase 2.
- O repositório estava limpo ao iniciar o planejamento.

## Decisões imutáveis

- Sem lease Ed25519 válido, somente ativação e controles básicos de janela funcionam.
- Lease offline: no máximo `259200` segundos (72 horas), com falha fechada após expiração.
- O agente não solicita confirmação por operação e não possui botão/atalho de emergência.
- O renderer nunca acessa o sidecar diretamente.
- Produção não abre HTTP/WebSocket, não procura Python no `PATH` e não executa `.py` solto.
- O instalador inclui sidecar PyInstaller `onedir`, manifesto de integridade e assinaturas Authenticode.
- Memória persiste por no máximo 30 dias; logs locais são redigidos; não há telemetria externa.

## Matriz de cobertura da especificação

| Seções da especificação | Plano responsável |
| --- | --- |
| 3–4: estados, licença, boot e fronteira de confiança | Fase 1 |
| 5–6 e 11: sidecar, protocolo, falhas e recuperação | Fase 2 |
| 7–10: Main/preload/renderer, controle, memória, logs e privacidade | Fase 3 |
| 12–14: pacote, atualização, CI, supply chain e aceite | Fase 4 |
| 1–2 e 15: objetivo, decisões e itens fora de escopo | Restrições globais de todas as fases |

## Estado de retomada

Atualize esta seção ao terminar cada sessão:

- **Fase atual:** Fase 3 concluída; Fase 4 pronta para execução.
- **Última tarefa concluída:** Fase 3 concluída (Renderer IPC broker, locked activation shell, 30-day single synchronized memory, redacted audit log, commercial control consent, and elimination of fake/obsolete product surfaces).
- **Último commit verificado:** `a36380b`.
- **Falhas conhecidas:** nenhuma (87 TS tests pass, 14 Python tests pass, build exits 0, 129 files clean in scan:secrets, 0 forbidden legacy symbols).
- **Próxima ação:** executar a Fase 4 (`2026-10-22-04-commercial-packaging-release.md`) usando `superpowers:executing-plans` e `superpowers:test-driven-development`.

## Verificação global final

Ao concluir as quatro fases, executar em Windows 10/11 x64 com Node 24 e sem Python global disponível para o aplicativo empacotado:

```powershell
npm.cmd ci
npm.cmd run verify
npm.cmd run test:python
npm.cmd run scan:secrets
npm.cmd run package:dir
npm.cmd run smoke:packaged
npm.cmd run verify:package
```

O trabalho só termina se todos os comandos retornarem código `0`, o smoke test comprovar bloqueio sem licença e operação com lease de teste válido, e `git status --short` estiver limpo.
