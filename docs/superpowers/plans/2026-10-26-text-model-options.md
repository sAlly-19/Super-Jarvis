# Mais modelos para texto

## Escopo

Adicionar Gemini 3.6 Flash, 3.5 Flash-Lite, 3.1 Flash-Lite e Groq GPT-OSS 20B ao catálogo existente. Não alterar defaults, modelos Live ou chaves. Usar allowlists iguais no Main/renderer e Python. Modelos disponíveis na conta dependem das permissões/cota do cliente; não há fallback automático.

Fontes oficiais consultadas em 26/10/2026:
- https://ai.google.dev/gemini-api/docs/models
- https://console.groq.com/docs/models

## Progresso

- [x] Teste vermelho do catálogo com as novas opções.
- [x] Catálogo TypeScript e allowlist Python ampliados.
- [x] Rótulos curtos no seletor; texto das credenciais não vinculado a um único modelo.
- [x] Testes, compilação e sidecar empacotado.

Não reintroduzir modelos 2.5 ou Llama restritos a contas legadas/Enterprise. Não alterar a chamada Gemini Live. Preservar a pasta não rastreada do backend.

## Verificação

- `npm.cmd test`: 196 testes aprovados; a expectativa antiga de lista Groq única em settings-draft foi atualizada.
- `npm.cmd run test:python`: 51 testes aprovados, incluindo validação dos quatro novos IDs.
- `npm.cmd run typecheck`: aprovado.
- PyInstaller recompilado usando o ambiente local existente; manifesto SHA-256 regenerado (111 arquivos).
- `npm.cmd run test:package`: 8 testes aprovados, incluindo handshake do executável e worker de ferramentas.
- Layout validado em 1100, 800 e 600 px.
- Build Electron aprovado; permanece aviso de chunk acima de 500 kB.

Não foram realizadas chamadas de geração com as credenciais do cliente. Cota/permissões e disponibilidade podem variar. Não implementado fallback automático nem tratamento adicional do HTTP 503 nesta tarefa. Reiniciar o app para escolher o modelo em IA & Voz; instaladores já distribuídos precisam de nova publicação.
