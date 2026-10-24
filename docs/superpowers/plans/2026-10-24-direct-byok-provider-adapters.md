# Direct BYOK Provider Adapters Implementation Plan

## Follow-up: latência após conexão funcional

- Usuário confirmou funcionamento da geração; relatou espera excessiva.
- Gemini 3.8 Flash passa a usar `thinking_config.thinking_level=low`, suportado pelo SDK e recomendado pelo Google para menor latência.
- Logs `[Latency]` medem captura de tela, cada chamada LLM, ferramentas, texto pronto e síntese de voz, sem registrar conversa ou imagem.
- A síntese ainda aguarda o texto completo; streaming de voz não foi implementado nesta alteração.
- Teste de regressão observou ausência da configuração antes da implementação; suíte Python 37/37 e validação do parâmetro pelo SDK aprovadas.
- Não há medição de latência com a conta real nesta execução; a redução percebida ainda deve ser verificada no aplicativo.

## Follow-up: diagnóstico Gemini/service

- Confirmado com exceções reais do SDK Google: o código HTTP fica em `code`, não em `status_code`.
- Corrigida a classificação de 404, 429 e chave inválida retornada com HTTP 400.
- Log do runtime agora inclui HTTP e classe da exceção, sem corpo externo ou credencial.
- Regressão RED: três classificações falharam; GREEN: suíte Python 37/37.
- A chamada real não foi reproduzida nesta execução: o helper Electron falhou ao acessar a credencial local. O erro de geração do cliente ainda requer o novo diagnóstico de runtime; não está comprovadamente resolvido.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remover o LiteLLM e conectar Gemini, Groq e Ollama diretamente, com validação real de credencial/modelo e preservação do BYOK local.

**Architecture:** Um módulo Python de adaptadores traduz o contrato canônico do Jasper para cada SDK/API oficial. O runtime mantém o loop de agente e ferramentas, enquanto a configuração passa a testar o provedor antes de declarar conexão.

**Tech Stack:** Python 3.11, `google-genai==2.33.0`, `groq==1.7.0`, `httpx`, Electron/TypeScript, PyInstaller.

**Spec:** `docs/superpowers/specs/2026-10-24-direct-byok-provider-adapters-design.md`

## Global Constraints

- Trabalhar diretamente na branch `main`, conforme autorização prévia do usuário.
- Não alterar nem incluir no commit `test/api-connectivity-and-modal-flexibility.test.ts`, modificado previamente pelo usuário.
- Nenhuma credencial pode aparecer em código, teste, log, arquivo temporário persistente ou diff.
- Preservar licença, DPAPI, protocolo stdio privado e zero portas locais adicionais.
- Executar todo comportamento novo em ciclos RED → GREEN.

## Review Focus

- Resposta de ferramenta malformada deve virar resultado seguro, não encerrar o sidecar.
- Imagem base64 inválida deve ser rejeitada ou ignorada sem vazar dados.
- Erro externo contendo a chave deve ser categorizado sem propagar o segredo.
- Modelo ausente para a conta deve impedir o estado `connected`.
- Ollama desligado deve retornar diagnóstico local e não tentar provedor remoto.

---

### Task 1: Contrato e adaptadores diretos

**Files:**
- Create: `jasper-backend/provider_adapters.py`
- Create: `jasper-backend/tests/test_provider_adapters.py`

**Interfaces:**
- Produces: `ProviderToolCall`, `ProviderResponse`, `ProviderAdapterError`, `create_provider_adapter(provider, api_key)` e adaptadores com `validate_model(model)` e `complete(model, messages, tools, temperature)`.
- Consumes: esquema OpenAI-compatible atual de `TOOLS_SCHEMA` e histórico canônico de `runtime.py`.

- [x] Escrever testes de contrato, tradução de Gemini, Groq e Ollama, validação de modelos e categorização segura de erros.
- [x] Executar `python -m unittest jasper-backend/tests/test_provider_adapters.py -v` e confirmar falha por módulo ausente.
- [x] Implementar o módulo com imports preguiçosos dos SDKs e clientes injetáveis nos testes.
- [x] Reexecutar o teste focado e confirmar aprovação (6/6).

### Task 2: Integrar runtime e transcrição sem LiteLLM

**Files:**
- Modify: `jasper-backend/runtime.py`
- Modify: `jasper-backend/tests/test_runtime.py`

**Interfaces:**
- Consumes: interfaces produzidas pela Task 1.
- Produces: loop de ferramentas independente de provedor, validação real no `config` e Groq Whisper direto.

- [x] Alterar primeiro os testes do runtime para exigir adaptadores, validação e ausência de chamadas LiteLLM.
- [x] Executar os testes focados e confirmar cinco falhas esperadas no runtime antigo.
- [x] Migrar o loop, o fallback de síntese, o ciclo de vida do adaptador e a transcrição.
- [x] Reexecutar todos os testes Python e confirmar aprovação (36/36).

### Task 3: Supply chain, pacote comercial e documentação

**Files:**
- Modify: `jasper-backend/requirements.in`
- Modify: `jasper-backend/requirements.lock`
- Modify: `jasper-backend/jasper-backend.spec`
- Modify: `jasper-backend/requirements-audit.lock` se necessário
- Modify: `test-artifact/python-package.test.ts`
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-10-22-jarvis-commercial-remediation-runbook.md`
- Modify: `docs/superpowers/plans/2026-10-24-direct-byok-provider-adapters.md`
- Regenerate: `src/main/generated/backend-manifest.ts`

**Interfaces:**
- Consumes: módulos e dependências finais das Tasks 1–2.
- Produces: sidecar reproduzível sem LiteLLM e evidências de release.

- [x] Escrever/alterar primeiro o teste de artefato para exigir os SDKs oficiais e rejeitar LiteLLM.
- [x] Executar o teste focado e confirmar falha esperada.
- [x] Atualizar pins, lock com hashes e configuração PyInstaller.
- [x] Executar teste real sanitizado com as credenciais locais, sem imprimir segredos.
- [x] Executar typecheck, testes TypeScript, testes Python, build Electron, build sidecar, manifesto, testes do pacote e scan de segredos.
- [x] Atualizar este plano e o runbook com resultados exatos e registrar commit atômico na `main`.
