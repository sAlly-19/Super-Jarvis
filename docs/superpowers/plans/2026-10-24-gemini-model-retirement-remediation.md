# Remediação do modelo Gemini retirado

**Data:** 24 de outubro de 2026  
**Branch:** `main`  
**Estado:** correção concluída; reteste online pendente por indisponibilidade de rede

## Incidente confirmado

- A credencial Gemini armazenada autentica com sucesso (`models.list`: HTTP 200).
- A geração com `models/gemini-2.5-flash` falha com HTTP 404 porque o modelo não está mais disponível para novos usuários.
- O modelo estático do Jasper deve ser migrado para `gemini/gemini-3.8-flash`.

## Escopo aprovado

- [x] Adicionar testes de regressão para o catálogo, a migração persistida e o allowlist do sidecar.
- [x] Atualizar catálogo TypeScript, normalização/migração e runtime Python.
- [x] Atualizar a tela de configurações e fixtures afetadas.
- [x] Executar testes focados, typecheck, suítes completas TypeScript/Python e build.
- [ ] Validar uma geração real sem expor a credencial do cliente.
- [x] Registrar evidências finais neste arquivo e no runbook comercial.

## Evidências TDD

### RED

- `npm.cmd test -- ai-provider-catalog`: 3 falhas esperadas; catálogo ainda retornava `gemini/gemini-2.5-flash`.
- `npm.cmd test -- config.test`: 1 falha esperada; configuração persistida não migrava o modelo retirado.
- `python -m unittest ...test_validate_provider_model_enforces_allowlist -v`: falha esperada; allowlist Python rejeitava `gemini/gemini-3.8-flash`.

### GREEN e verificação final

- `npm.cmd run typecheck`: aprovado, 0 erros.
- `npm.cmd test`: 189 testes em 37 suítes, 0 falhas.
- `npm.cmd run test:python`: 26 testes, 0 falhas.
- `npm.cmd run build`: aprovado para Main, Preload e Renderer.
- LiteLLM resolveu `gemini/gemini-3.8-flash` para `("gemini-3.8-flash", "gemini", None, None)`.
- A sondagem real foi executada sem revelar nem alterar a chave, mas tanto LiteLLM quanto REST direto expiraram por timeout de rede. O reteste online deve ser feito ao reiniciar o Jasper com conectividade ao endpoint `generativelanguage.googleapis.com`.

## Resultado implementado

- O catálogo, o sidecar e a interface usam exclusivamente `gemini/gemini-3.8-flash`.
- Configurações persistidas com `gemini/gemini-2.5-flash` são migradas automaticamente e regravadas de forma atômica.
- O modelo retirado permanece apenas em listas/testes de migração e rejeição.
- Nenhuma credencial foi exibida, alterada ou persistida por scripts de diagnóstico; todos os arquivos temporários foram removidos.
