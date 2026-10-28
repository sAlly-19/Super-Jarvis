# Recuperação da identidade na inicialização — 28/10/2026

Usuário informou UnhandledPromiseRejectionWarning/module_installation_mismatch ao iniciar Electron em desenvolvimento. Diagnóstico somente leitura confirmou que a identidade salva nos módulos coincide com a identidade de licença persistida e com a leitura atual de hardware. O código anterior permitia timeout de4s na consulta Windows, usando outro fingerprint como fallback e mantendo-o em cache. Essa é uma causa provável da divergência transitória; a execução original não continha o HWID produzido no momento da falha para provar qual fallback foi usado.

## Correção

- getHardwareInfo conserva o algoritmo e o formato de fingerprint existentes; tolerância da consulta Windows ampliada para12s e opção interna de nova leitura limitada a20s.
- openModuleStore tenta a leitura normal e, somente para module_installation_mismatch, refaz a consulta real de hardware antes de tentar novamente. Não adota o ID do JSON como identidade, não regrava preferências e não migra automaticamente instalações realmente diferentes.
- A confirmação dos módulos ocorre antes de abrir/migrar o SQLite, evitando alterações de banco em inicialização rejeitada por identidade.
- A promessa de inicialização agora tem catch. Falhas persistentes recebem mensagem local e saída com código1, em vez de rejeição não tratada. Dados inesperados do erro não são copiados para o diagnóstico público.
- Licença, consentimento e validações de máquina permanecem obrigatórios. Nenhuma chave/lease foi copiada para testes ou editada no perfil real. Nenhum arquivo pessoal foi removido ou reatrelado.

## Evidências

Cinco regressões: fallback transitório recupera preferências sem reescrever bytes; divergência real continua bloqueada; erro/corrupção preserva arquivo; erro de startup encerra mesmo quando o diálogo falha; refresh Windows atualiza o cache compartilhado mantendo o mesmo cálculo de hash. Primeiro teste RED por helper ausente; implementação e suíte final GREEN.

npm run verify com Node24:287/287 testes, typecheck e build aprovados. Duas aberturas reais do Electron sobre build de desenvolvimento e duas do executável final concluíram com exit0, sem module_installation_mismatch ou UnhandledPromiseRejection. Harness usou perfil temporário contendo apenas cópia do modules.json local, sem credenciais. Preferências copiadas e arquivo original ficaram byte a byte preservados. LICENSE_REQUIRED em chamadas do renderer é esperado nesse perfil sem licença e não equivale a aceite de execução licenciada.

Pacote reconstruído e aprovado em11/11 testes de artefato e verify:package. Executável: `release/win-unpacked/Jasper AI.exe`; SHA-256 `5146683488F7E6AACC8AE8B11EA9394602297891FF20078F621E082F838F121C`. Python de produção não mudou; sidecar anterior reutilizado e manifesto regenerado. Sem publicação, commit/push ou nova fase.

Logs locais: `.cache/installation-verify.log`, `.cache/installation-artifacts.log`, `.cache/installation-integrity.log`, `.cache/installation-startup-dev.log`, `.cache/installation-startup-packaged.log`; relatórios e logs dos perfis isolados nas pastas homônimas. Scanner incluindo novos não ignorados e diff --check aprovados.

Retomada: encerrar a execução antiga e iniciar npm run dev novamente, ou abrir o executável atualizado. Reteste do usuário no perfil licenciado ainda não informado. Aceite de Saúde do PC continua separado deste conserto de startup; não iniciar módulo novo automaticamente.
