# Saúde do PC — consulta com módulo indisponível

28/10/2026. Main, sem commit/push. Executáveis somente ao finalizar o projeto ou quando indispensáveis para testar, conforme orientação do usuário.

## Diagnóstico

O renderer consultava getPcHealth em toda abertura das configurações/evento de mudança, mesmo com o módulo desativado. O evento de licença também consultava após bloquear a tela. Main rejeita corretamente com pc_health_unavailable. Não remover autorização nem habilitar módulos automaticamente.

## Correção e evidência

Skills systematic-debugging e TDD. Regressão Chromium observada RED: Disabled health module was queried. Aplicar o mesmo preflight listModules de Lembretes, verificando enabled/authorized/running antes de buscar métricas. Invalidar respostas anteriores e limpar painel em caso indisponível; não consultar após evento de licença bloqueada. Main continua validando toda operação, inclusive corridas com desativação.

- [x] Reproduzir a chamada indevida em teste sintético Chromium.
- [x] Corrigir preflight e atualização após licença bloqueada.
- [x] Teste Chromium GREEN, typecheck e build de desenvolvimento aprovados (exit0). Whitespace aprovado. Aviso conhecido de bundle acima de500kB permanece. Nenhum executável gerado.

Próximo teste manual: reiniciar npm run dev e abrir configurações com Saúde do PC desativado; o painel deve orientar a ativação sem chamar pc-health:get. Habilitar o módulo para obter leituras; desativar deve limpar o painel. Sem teste no perfil licenciado alegado nesta rodada.
