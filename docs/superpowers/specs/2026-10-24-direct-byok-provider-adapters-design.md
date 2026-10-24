# Direct BYOK Provider Adapters Design

**Data:** 24 de outubro de 2026
**Estado:** aprovado pelo usuário no chat para execução autônoma

## Objetivo

Substituir o LiteLLM no runtime comercial por integrações diretas com os provedores, mantendo o modelo BYOK: cada cliente informa sua própria chave, que permanece criptografada localmente via Electron `safeStorage`/DPAPI e só é entregue em memória ao sidecar licenciado pelo protocolo privado.

## Arquitetura

- `provider_adapters.py` define um contrato canônico de resposta, chamadas de ferramenta e erros, isolando as diferenças entre SDKs.
- Gemini usa o SDK oficial `google-genai`; Groq usa o SDK oficial `groq`; Ollama usa sua API HTTP local oficial via `httpx`.
- `runtime.py` preserva o loop atual de ferramentas, memória, visão, áudio e protocolo, mas delega cada completion ao adaptador ativo.
- Identificadores internos conservam o prefixo do provedor (`gemini/`, `groq/`, `ollama/`); cada adaptador remove o prefixo antes da chamada externa.
- A configuração do sidecar valida a credencial e a disponibilidade do modelo antes de publicar estado `connected`, evitando o falso positivo atual.

## Segurança e privacidade

- Nenhuma chave é persistida no Python, enviada ao renderer, registrada em logs ou colocada no ambiente do sidecar.
- Exceções externas são convertidas em categorias estáveis (`authentication`, `quota`, `model`, `network`, `service`) sem incluir detalhes sensíveis.
- O renderer recebe mensagens acionáveis, mas não recebe o corpo bruto da resposta do provedor.
- O endpoint Ollama permanece restrito a `http://127.0.0.1:11434`.

## Comportamento dos provedores

- Gemini: `google.genai.Client(api_key=...)`, geração assíncrona e function calling manual para preservar o controle local das ferramentas.
- Groq: `groq.AsyncGroq(api_key=...)`, Chat Completions e transcrição Whisper oficiais.
- Ollama: `POST /api/chat`, sem credencial e sem tráfego remoto.
- A validação consulta o catálogo do provedor e confirma que o modelo configurado está disponível para a conta. Ollama confirma o modelo por `/api/tags`.

## Compatibilidade

- O IPC Electron–sidecar permanece inalterado.
- O formato público de configuração e o armazenamento DPAPI permanecem inalterados.
- A interface mantém os três provedores e as chaves independentes.
- Configurações antigas continuam migradas pelos normalizadores existentes.

## Aceite

- Não existe importação ou dependência de runtime do LiteLLM.
- Gemini, Groq e Ollama convertem mensagens, imagens, ferramentas e respostas para o contrato comum.
- A configuração só retorna `connected` após validação real.
- Falhas de autenticação, quota, modelo e rede geram mensagens distintas e sem vazamento de chave.
- Testes de fonte, Python, build Electron, build do sidecar e testes de artefato passam.
