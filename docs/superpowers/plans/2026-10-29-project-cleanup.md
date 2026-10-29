# Limpeza conservadora — jasper-avatar

**Data:** 29/10/2026. **Estado:** concluída. Usuário autorizou remover somente arquivos sem uso, preservando configurações JSON e limitando a operação a este projeto.

## Resultado

Removidos **341 arquivos**, somando **1.113,39 MiB (aproximadamente 1,09 GiB)**:

- 190 artefatos antigos de release, incluindo instaladores, executável extraído, bibliotecas e o duplicado portátil cujo nome terminava com espaço NBSP.
- 16 intermediários regeneráveis do PyInstaller em `build/python-backend/work`.
- 44 arquivos de bytecode Python do código-fonte.
- 1 cache incremental TypeScript.
- 88 saídas sintéticas com timestamp em downloads, cuja origem residual está documentada em `audit-reports/06-testes-e-validacoes.md`.
- 2 PDFs inválidos de 40 bytes contendo exclusivamente o marcador de mock de PDF.

O manifest individual está em `.superpowers/project-cleanup-2026-10-29/removal-manifest.csv`. O script de seleção/remoção e snapshots de verificação estão na mesma pasta. O arquivo com NBSP foi removido separadamente pelo caminho literal estendido do Windows após conferir diretório pai, ausência de reparse point e tamanho; não foi usado um comando destrutivo em outro shell.

## Preservado

Nenhum arquivo JSON foi excluído ou alterado. Os 13 JSONs encontrados nas áreas verificadas (raiz, resources, src, public e release) tiveram SHA-256 conferido antes/depois; demais árvores de configuração/dependências não foram tocadas. Por exigência do usuário, release conserva quatro JSONs do pacote anterior, mesmo sem o restante do pacote.

Código e modificações anteriores, Git, planos, relatórios, ledgers/evidências de testes, assets, dependências Node, ambientes Python de desenvolvimento/auditoria e o sidecar já compilado foram preservados. Build de desenvolvimento em out mantido porque ainda serve ao uso local. Downloads sem origem sintética comprovada foram mantidos. Nenhuma modificação no site de vendas ou em outra pasta externa.

## Verificação e limites

- Todos os alvos foram verificados como internos ao caminho absoluto deste projeto; sem seguir junctions/symlinks e sem apagar arquivos rastreados no Git.
- Após a limpeza principal, git status permaneceu idêntico ao snapshot inicial; este documento é a única adição documental desta tarefa.
- Resolução do Python de desenvolvimento, dependência Electron, `out/main/index.js` e configuração OAuth local continuam disponíveis.
- Hashes JSON inalterados e ausência dos arquivos removidos conferidos; diff sem erros de whitespace.
- Nenhum teste ou build do produto foi refeito: não houve alteração de código e isso recriaria caches removidos. Pacotes comerciais antigos foram intencionalmente apagados; testes dependentes de release precisam de um novo pacote quando essa etapa for necessária/autorizada. Não foi gerado executável novo.

## Retomada

Execução direta de chat/voz permanece a entrega anterior. Gmail continua configurado. Próxima fase é detalhar Pesquisa web pelo roteiro08 e skill brainstorming, adequando a integração à execução direta em vez de restaurar o planejador antigo. Não iniciar código de novo módulo a partir do roteiro preliminar; primeiro resolver escopo e escolhas de implementação com o usuário.
