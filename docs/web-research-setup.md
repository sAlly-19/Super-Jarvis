# Pesquisa web

## Usar

1. Abra **Configurações → Sistema & Automação** e ative **Pesquisa web**.
2. Conecte ou reconecte o agente para negociar o catálogo atualizado. Se uma chamada já estiver aberta, encerre e inicie outra para disponibilizar as ferramentas novas.
3. Peça uma pesquisa no chat ou por voz. O agente pode buscar e depois ler as páginas, usando o modelo de IA já configurado pelo cliente. A busca não exige outra chave.

O painel permite consultar as dez últimas pesquisas, abrir detalhes em texto e limpar o histórico. O botão **Testar busca** faz somente a consulta pública “Electron documentation”, sem salvar um registro. Abrir a tela ou diagnosticar o módulo não dispara essa consulta.

## Fontes e limites

A busca usa a interface HTML pública do DuckDuckGo. Não é uma API oficial nem há garantia de disponibilidade: CAPTCHA, bloqueio, limite de requisições ou mudança de layout produzem um estado explícito. Não há troca automática para API paga, outro buscador ou proxy.

A leitura atual é **HTTP**. Páginas que exigem JavaScript retornam `render_unavailable`; o navegador permanece adiado porque seu teste de contenção de rede não foi aprovado. Não há login, formulários, compras, PDF ou contorno de CAPTCHA/paywall nesta entrega.

Links de busca são candidatos a fontes; um snippet não equivale a uma página lida. Detalhes registram URL final, horário da consulta e data de publicação quando informada pela fonte. Resumo é texto da IA, não prova de veracidade. Para informações atuais, uma nova pesquisa é necessária; o histórico não atualiza suas datas silenciosamente.

## Armazenamento e proteção

Pergunta, resultados, resumo e conteúdo limitado são protegidos pelo `safeStorage` do Electron, com proteção do Windows na composição de produção. Mantêm-se dez pesquisas por ordem de criação e até três páginas por pesquisa. Texto por página:48KiB UTF-8; envelope por pesquisa:256KiB antes de cifrar. A inclusão da11ª remove a mais antiga atomicamente.

Se a proteção falhar, a resposta de rede pode continuar em memória temporária, sem gravar texto puro nem apagar dados protegidos anteriores. Esse conteúdo volátil não é promovido silenciosamente ao disco quando a proteção volta. A tela distingue histórico indisponível de vazio. Desligar o módulo preserva os registros salvos, mas invalida solicitações e recibos em andamento.

Limpar o histórico invalida callbacks pendentes por geração. É exclusão lógica; backups de migração e arquivos SQLite/WAL podem conter ciphertext anterior. Não é apagamento forense nem sincronização entre computadores.

Licença válida e consentimento Total Control continuam necessários. Não há confirmação por consulta. O histórico local continua protegido por esses requisitos mesmo com o módulo desativado. O backend precisa anunciar `webResearchRuntimeVersion:1`; versões antigas não recebem as ferramentas web.

## Verificações locais

```powershell
node scripts/run-tests.mjs web-
node scripts/test-web-ui.cjs
npm run test:python
npm run verify
npm run audit:runtime
node scripts/scan-secrets.mjs --include-untracked
```

O teste visual usa um perfil temporário, dados sintéticos e rede bloqueada. O aceite stdio utiliza Main/bridge/runtime reais com modelo e páginas sintéticos. Nenhum desses testes exige licença pessoal, conta ou instalador. `scripts/test-web-browser.cjs` é uma prova histórica de gate reprovado; não é esperado passar nem faz parte da entrega HTTP.

Consulta pública separada em30/10/2026,09:39:41 de Brasília: busca “Electron documentation” retornou cinco resultados; leitura HTTP de `https://www.electronjs.org/docs/latest/` retornou conteúdo. É uma observação pontual; não garante que outras consultas ou sites responderão.

Para decisões e evidências, veja [progresso](superpowers/plans/2026-10-29-web-research-progress.md).
