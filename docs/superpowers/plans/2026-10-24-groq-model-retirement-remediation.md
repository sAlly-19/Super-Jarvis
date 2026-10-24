# Remediação do modelo Groq retirado

**Data:** 24 de outubro de 2026
**Branch:** `main`
**Estado:** concluído

## Incidente confirmado

- A chave Groq armazenada foi aceita pela API.
- `llama-3.3-70b-versatile` retornou HTTP 404 `model_not_found` para a conta configurada.
- `openai/gpt-oss-120b`, substituto oficial, retornou HTTP 200 com a mesma conta.
- O identificador LiteLLM correspondente deve ser `groq/openai/gpt-oss-120b`.

## Escopo aprovado

- [x] Adicionar testes de regressão para catálogo, migração, sidecar e interface.
- [x] Atualizar o catálogo e migrar automaticamente configurações persistidas.
- [x] Atualizar o allowlist do sidecar e a interface.
- [x] Executar testes focados e verificação completa.
- [x] Registrar evidências finais no runbook comercial.

## Evidências TDD

### RED

- `npm.cmd test -- ai-provider-catalog`: 3 falhas esperadas; catálogo ainda publicava o Llama retirado.
- `npm.cmd test -- config.test`: 1 falha esperada; configuração Groq antiga não era migrada.
- `npm.cmd test -- settings-dashboard`: 1 falha esperada; interface ainda exibia o identificador retirado.
- Testes focados Python: 2 falhas esperadas; allowlist rejeitava GPT-OSS e a normalização preservava o modelo antigo.

### GREEN e verificação final

- Testes focados: catálogo 4/4, configuração 16/16, dashboard 8/8 e runtime Python 9/9.
- `npm.cmd run typecheck`: aprovado, sem erros TypeScript.
- `npm.cmd test`: 191 testes em 37 suítes, 0 falhas.
- `npm.cmd run test:python`: 27 testes, 0 falhas.
- `npm.cmd run build`: build Electron aprovado para Main, preload e renderer.
- Sondagem Groq: `openai/gpt-oss-120b` retornou HTTP 200 com a mesma credencial que recebia HTTP 404 no modelo retirado.
- Resolução LiteLLM: `groq/openai/gpt-oss-120b` foi interpretado como modelo `openai/gpt-oss-120b` no provedor `groq`.
- A configuração persistida antiga é migrada para o novo identificador sem exigir que o cliente informe novamente sua chave.
