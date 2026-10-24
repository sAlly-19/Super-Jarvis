# Jasper Commercial Remediation Runbook

## Gemini Live — chamada em tempo real (24/10/2026)

- Microfone transmite PCM16 mono 16 kHz à sessão Gemini Live pelo Main/sidecar; áudio Google 24 kHz é reproduzido em blocos com lip-sync e interrupção do servidor.
- Chave Gemini independente do provedor de chat, protegida por DPAPI. Licença, consentimento e origem IPC obrigatórios também para início e áudio Live.
- Vozes Google selecionáveis; encerramento fecha conexão, limpa filas e termina árvores dos processos de ferramentas pendentes.
- Revisão independente corrigida com regressões de concorrência, remoção de chave durante conexão e cancelamento de ferramentas.
- Verificação: 194 testes TypeScript, 51 Python, 8 de artefato; typecheck, build Electron e PyInstaller aprovados. Manifesto atualizado para 111 arquivos.
- Chamada física e acesso ao modelo na conta do cliente ainda não foram verificados. Detalhes e retomada em `docs/superpowers/plans/2026-10-24-gemini-live-call.md`.

**Última atualização:** 24 de outubro de 2026  
**Branch de referência:** `main`  
**Especificação aprovada:** `docs/superpowers/specs/2026-10-22-jarvis-commercial-total-control-design.md`  
**Plano de remediação de auditoria:** `docs/superpowers/plans/2026-10-23-commercial-audit-remediation.md`  

## Objetivo

Este arquivo é o ponto de retomada e registro oficial de evidências da remediação comercial e técnica do Jasper AI. Todas as etapas de remediação de auditoria, atomicidade de licença, isolamento de processos, protocolo estrito, integridade de fuses, separação de testes de artefato e supply chain foram executadas em ordem estrita com disciplina de TDD e commits atômicos diretos na branch `main`.

## Ordem de execução e planos associados

- [x] Fase 1 — `2026-10-22-01-license-gated-runtime.md` (CONCLUÍDA)
- [x] Fase 2 — `2026-10-22-02-private-sidecar-protocol.md` (CONCLUÍDA)
- [x] Fase 3 — `2026-10-22-03-renderer-ipc-memory-cleanup.md` (CONCLUÍDA)
- [x] Fase 4 — `2026-10-22-04-commercial-packaging-release.md` (CONCLUÍDA)
- [x] Remediação de Auditoria — `2026-10-23-commercial-audit-remediation.md` (Tasks 1 a 10 CONCLUÍDAS)
- [x] Provider-Aware Settings — `2026-10-23-provider-aware-settings-dashboard.md` (Tasks 1 a 8 CONCLUÍDAS)
- [x] Direct BYOK Adapters — `2026-10-24-direct-byok-provider-adapters.md` (Tasks 1 a 3 CONCLUÍDAS)

## Linha de base verificada (Clean Execution)

- `npm.cmd run typecheck`: 0 erros TypeScript (`tsconfig.json` e `tsconfig.node.json`).
- `npm.cmd test`: 177 testes de fonte em 34 suítes, 0 falhas (executando exclusivamente testes de código-fonte).
- `npm.cmd run test:package`: 7 testes de artefato compilado (`test-artifact/python-package.test.ts`), 0 falhas.
- `python -m unittest discover -s jasper-backend/tests -v`: 26 testes unitários e de integração de runtime Python, 0 falhas.
- `npm.cmd run scan:secrets`: 163 arquivos rastreados sem segredos ou credenciais expostas.
- `npm.cmd run audit:runtime`: 0 vulnerabilidades em dependências de produção (`npm audit --omit=dev --audit-level=high`).
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/python-audit.ps1`: audit com `pip-audit` estrito sob hashes de `requirements-audit.lock` (Pillow atualizado para 13.0.0, 3 CVEs de filelock explicitamente ignorados devido à restrição do litellm <4.0).
- `npm.cmd run package:dir`: empacotamento completo com manifesto SHA-256 de 3.109 arquivos do sidecar e Electron Fuses aplicadas via `@electron/fuses`.
- `npm.cmd run verify:package`: inspeção direta das fuses no executável `Jasper AI.exe` (`onlyLoadAppFromAsar`, `enableEmbeddedAsarIntegrityValidation`, `runAsNode: false`), integridade do manifesto e ausência de portas de rede ou Python no PATH.
- `npm.cmd run smoke:packaged`: smoke test em PATH sanitizado (sem Python/Node global) aprovado com screenshot gerado.

## Decisões imutáveis implementadas

- Sem lease Ed25519 válido, somente ativação, verificação de HWID e controles básicos de janela funcionam.
- Lease offline: no máximo `259200` segundos (72 horas), com falha fechada imediata após expiração ou revogação.
- O agente opera em modo Total Control sem confirmações por operação e com consentimento vinculado à máquina (`controlConsentInstallationId`).
- O renderer nunca acessa o sidecar diretamente; todo o tráfego é intermediado pelo processo Main via IPC tipado e seguro.
- O sidecar roda exclusivamente via binário `onedir` embutido (`resources/jasper-backend/jasper-backend.exe`), sem WebSocket ou HTTP local (zero portas abertas), sem herança de segredos e com encerramento garantido de árvores de processo (`taskkill /T /F`).
- Credenciais independentes para Google Gemini e Groq criptografadas localmente via DPAPI (`safeStorage`), além de execução local direta para Ollama (`http://127.0.0.1:11434`).
- O pacote comercial enforce `publisherName: "CN=Jasper Team, O=Jasper Team, L=Sao Paulo, C=BR"` para atualizações e validação Authenticode.

## Matriz de cobertura da especificação

| Seções da especificação | Plano responsável | Status |
| --- | --- | :---: |
| 3–4: estados, licença, boot e fronteira de confiança | Fase 1 & Remediation Tasks 1–2 | Concluído com evidência |
| 5–6 e 11: sidecar, protocolo, falhas e recuperação | Fase 2 & Remediation Tasks 3–5 | Concluído com evidência |
| 7–10: Main/preload/renderer, controle, memória, logs e privacidade | Fase 3 & Settings Tasks 1–8 | Concluído com evidência |
| 12–14: pacote, atualização, CI, supply chain e aceite | Fase 4 & Remediation Tasks 7–10 | Concluído com evidência |
| 1–2 e 15: objetivo, decisões e itens fora de escopo | Restrições globais de todas as fases | Concluído com evidência |

## Itens de Release-Only (Execução de Produção)

Os seguintes passos finais pertencem estritamente à esteira de publicação em CI protegida e ao operador de release:
1. **Assinatura Authenticode de Produção**: disparada via push de tag `v*` no GitHub Actions configurada com os segredos `CSC_LINK` e `CSC_KEY_PASSWORD`.
2. **Teste em VM Windows Limpa**: verificação de instalação do `.exe` assinado e teste de atualização em feed oficial em máquina sem Python instalado (Responsável: Engenharia de Release / Publicação).

## Hotfix — Retirada do Gemini 2.5 Flash (24/10/2026)

- O erro de geração foi rastreado até a retirada de `models/gemini-2.5-flash` para novos usuários, apesar de a chave do cliente autenticar corretamente.
- Catálogo, sidecar e interface foram atualizados para `gemini/gemini-3.8-flash`.
- O `ConfigStore` migra e persiste automaticamente instalações ainda configuradas com `gemini/gemini-2.5-flash`.
- Evidência local: typecheck aprovado; 189 testes TypeScript em 37 suítes; 26 testes Python; build Electron aprovado.
- A sondagem online pós-correção ficou pendente porque o endpoint expirou por timeout durante a verificação. O histórico e os comandos estão em `2026-10-24-gemini-model-retirement-remediation.md`.

## Hotfix — Retirada do Groq Llama 3.3 70B (24/10/2026)

- A credencial Groq foi validada com sucesso; o erro era causado pela retirada de `llama-3.3-70b-versatile` para contas Free e Developer.
- Catálogo, sidecar e interface foram atualizados para `groq/openai/gpt-oss-120b`.
- O `ConfigStore` migra e persiste automaticamente configurações antigas, sem solicitar novamente a chave do cliente.
- Evidência online: o modelo antigo retornou HTTP 404 `model_not_found`, enquanto `openai/gpt-oss-120b` retornou HTTP 200 com a mesma credencial.
- Evidência local: typecheck aprovado; 191 testes TypeScript em 37 suítes; 27 testes Python; build Electron aprovado.
- Registro detalhado em `2026-10-24-groq-model-retirement-remediation.md`.

## Migração Oficial — Adaptadores BYOK Diretos e Remoção de LiteLLM (24/10/2026)

- LiteLLM foi completamente eliminado do runtime, supply chain e empacotamento PyInstaller.
- Implementados adaptadores diretos oficiais via `google-genai==2.33.0`, `groq==1.7.0` e `httpx==0.28.1` em `jasper-backend/provider_adapters.py`.
- O sidecar `jasper-backend.exe` foi recompilado com PyInstaller onedir, excluindo litellm e incluindo os módulos SDK oficiais.
- Manifesto de integridade `src/main/generated/backend-manifest.ts` regenerado com 2.067 arquivos hasheados com SHA-256.
- Evidência local:
  - `npm.cmd run typecheck`: 0 erros.
  - `npm.cmd test`: 191 testes TypeScript em 37 suítes, 0 falhas.
  - `npm.cmd run test:python`: 36 testes Python unitários e de integração, 0 falhas.
  - `npm.cmd run test:package`: 7 testes de artefato aprovados.
  - `npm.cmd run audit:python`: 0 vulnerabilidades no supply chain Python (eliminadas as vulnerabilidades do LiteLLM).
  - `npm.cmd run scan:secrets`: 181 arquivos verificados sem credenciais.
- Registro detalhado em `docs/superpowers/plans/2026-10-24-direct-byok-provider-adapters.md`.
