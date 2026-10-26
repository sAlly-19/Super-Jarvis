# Aceite integrado e release — roteiro

> **For agentic workers:** Após autorização usar superpowers:executing-plans ou superpowers:subagent-driven-development e verification-before-completion.

**Goal:** Comprovar que módulos se combinam e funcionam no Windows distribuído.
**Architecture:** Preservar esteira comercial atual e verificar cada fronteira.
**Tech Stack:** Test runner atual, unittest, Electron, PyInstaller, manifesto, fuses e assinatura.
**Spec:** [Desenho](../specs/2026-10-26-modular-agent-design-draft.md).
**Status:** PRELIMINAR; não é autorização de publicação.

## Global Constraints e Review Focus
Aplicar [roadmap](2026-10-26-modular-agent-00-roadmap.md). Não confundir mock com serviço real, ambiente de desenvolvimento com pacote ou build local com instalador assinado. Focos: instalação limpa, migração, revogação offline, timeout após efeito e fonte externa maliciosa.

## Fluxos de aceite
- [ ] E-mails importantes do dia → resumo com origem → prazos identificados → lembretes sem duplicação; ambiguidades precisam de esclarecimento.
- [ ] Pesquisa web → relatório DOCX/PDF → reabrir/validar → salvar em diretório autorizado; fonte injetando comando não é executada.
- [ ] Telemetria real → diagnóstico proporcional → recomendação; não inventar temperatura ausente.
- [ ] Documento concluído → webhook autorizado único → confirmação por evidência; timeout de POST produz estado desconhecido.
- [ ] Primeiro briefing elegível → fontes habilitadas → apresentação confirmada → reinício não duplica.
- [ ] Desativar cada módulo durante tarefa, agendamento e conexão → interromper/cancelar com relatório real; reativar preserva dados.

## Regressão e comandos
- [ ] npm.cmd run verify, npm.cmd run test:python, npm.cmd run scan:secrets.
- [ ] Audits de dependências quando forem adicionadas, justificar tamanho, licença e dados enviados.
- [ ] Compilar sidecar, regenerar manifesto, npm.cmd run test:package, verificar pacote e smoke.
- [ ] VM Windows limpa sem Python/Node: instalar, ativar licença, conceder/revogar permissões, configurar módulos e executar os fluxos.
- [ ] Testar internet ausente, OAuth expirado, cancelamento, crash, dados legados, suspensão e relógio/fuso alterados.
- [ ] Atualização assinada em ambiente de release autorizado; não publicar/taguear sem pedido.
- [ ] Entregar evidências por fase: funcionalidades, arquivos, comandos e resultados, dependências/justificativas, limitações reais e riscos.

## Critério de saída
Nenhum item obrigatório pendente pode receber “concluído”. Serviços sem conta configurada e testes de produção sem certificado/VM permanecem explicitamente pendentes. Decisão de executar e de publicar são autorizações distintas.

