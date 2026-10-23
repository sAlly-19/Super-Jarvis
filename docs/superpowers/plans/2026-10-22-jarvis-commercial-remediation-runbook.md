# Jasper Commercial Remediation Runbook

**Última atualização:** 22 de outubro de 2026
**Branch de referência:** `main`
**Commit de referência ao criar o plano:** `dd74f90`
**Especificação aprovada:** `docs/superpowers/specs/2026-10-22-jarvis-commercial-total-control-design.md`

## Objetivo

Este arquivo é o ponto de retomada e registro oficial da remediação comercial e técnica do Jasper AI. Todas as quatro fases foram executadas em ordem estrita com disciplina de TDD e commits atômicos diretos na branch `main`.

## Ordem de execução

- [x] Fase 1 — `2026-10-22-01-license-gated-runtime.md` (CONCLUÍDA)
- [x] Fase 2 — `2026-10-22-02-private-sidecar-protocol.md` (CONCLUÍDA)
- [x] Fase 3 — `2026-10-22-03-renderer-ipc-memory-cleanup.md` (CONCLUÍDA)
- [x] Fase 4 — `2026-10-22-04-commercial-packaging-release.md` (CONCLUÍDA)

## Linha de base verificada

- `npm.cmd run typecheck`: 0 erros TypeScript.
- `npm.cmd test`: 103 testes reais de integração passando.
- `npm.cmd run test:python`: 14 testes de protocolo e runtime Python passando.
- `npm.cmd run scan:secrets`: 143 arquivos rastreados sem credenciais expostas.
- `npm.cmd run audit:runtime`: 0 vulnerabilidades (consultado registro oficial npm).
- `npm.cmd run audit:python`: 0 vulnerabilidades nas dependências travadas (`requirements.lock`).
- `npm.cmd run package:dir`: empacotamento com Electron Fuses e manifesto embutido no ASAR aprovado.
- `npm.cmd run verify:package`: integridade dos 3.110 arquivos do sidecar e fusíveis ASAR verificada.
- `npm.cmd run smoke:packaged`: smoke test em PATH sanitizado (sem Python/Node global) aprovado.
- `npm.cmd run sbom:python`: SBOM CycloneDX com 75 componentes gerado com sucesso.

## Decisões imutáveis implementadas

- Sem lease Ed25519 válido, somente ativação e controles básicos de janela funcionam.
- Lease offline: no máximo `259200` segundos (72 horas), com falha fechada após expiração.
- O agente opera em modo Total Control sem confirmações por operação e com consentimento vinculado à máquina (`controlConsentInstallationId`).
- O renderer nunca acessa o sidecar diretamente; todo o tráfego é intermediado pelo processo Main via IPC seguro.
- Produção não abre HTTP/WebSocket, não procura Python no `PATH` e não executa `.py` solto.
- O instalador inclui sidecar PyInstaller `onedir`, manifesto de integridade no ASAR e validação de assinaturas Authenticode.
- Memória única sincronizada (`userData/memory.json`) com retenção de 30 dias; logs de auditoria locais redigidos até 5 MiB (5 arquivos).

## Matriz de cobertura da especificação

| Seções da especificação | Plano responsável | Status |
| --- | --- | :---: |
| 3–4: estados, licença, boot e fronteira de confiança | Fase 1 | Concluído |
| 5–6 e 11: sidecar, protocolo, falhas e recuperação | Fase 2 | Concluído |
| 7–10: Main/preload/renderer, controle, memória, logs e privacidade | Fase 3 | Concluído |
| 12–14: pacote, atualização, CI, supply chain e aceite | Fase 4 | Concluído |
| 1–2 e 15: objetivo, decisões e itens fora de escopo | Restrições globais de todas as fases | Concluído |

## Estado de conclusão

- **Status geral:** Remediação comercial e técnica 100% concluída.
- **Fase atual:** Todas as 4 fases CONCLUÍDAS.
- **Última tarefa concluída:** Fase 4 Tarefa 5 (Aceite final, documentação, fechamento do runbook e auditorias aprovadas).
- **Falhas conhecidas:** Nenhuma.
- **Próximas ações pós-release:** Publicação de tag de release protegida (ex.: `v1.0.3`) com certificados de assinatura Authenticode configurados em segredos de repositório (`CSC_LINK`, `CSC_KEY_PASSWORD`).

## Verificação global final

Executado em Windows 10/11 x64 com Node 24 e sem Python global disponível para o aplicativo empacotado:

```powershell
npm.cmd run verify
npm.cmd run test:python
npm.cmd run scan:secrets
npm.cmd run audit:runtime
npm.cmd run audit:python
npm.cmd run package:dir
npm.cmd run smoke:packaged
npm.cmd run verify:package
```

Todos os comandos retornaram código `0`.
