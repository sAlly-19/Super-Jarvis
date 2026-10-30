# Memória semântica — roteiro de implementação

**Retomada vigente30/10:** este roteiro preliminar foi substituído pelos planos executivos30/10. Componentes01 e preparo02 foram implementados; ver progresso `2026-10-30-semantic-memory-progress.md` para gates/testes atuais. A candidata autorizada vigente é Transformers4.3.2 + ONNX Community. Próxima etapa técnica:03, índice derivado e recuperação. Itens abaixo preservam o escopo preliminar, não instruem reiniciar decisões já tomadas.

**Atualização30/10/2026:** este roteiro preliminar foi detalhado no [desenho aprovado](../specs/2026-10-30-semantic-memory-design-draft.md) e no [mapa executivo00](2026-10-30-semantic-memory-00-execution-map.md). Decisões vigentes: fatos/preferências permanentes até exclusão manual, recuperação local, modelo baixado ao ativar/primeiro uso, sem Planner obrigatório. Planos01–04 aguardam revisão; método nativo/main já escolhido. Habilidades aprendidas automaticamente são uma segunda entrega a especificar.

> **For agentic workers:** REQUIRED SUB-SKILL após aprovação: superpowers:executing-plans ou superpowers:subagent-driven-development. Não iniciar código a partir deste rascunho.

**Goal:** Entregar o módulo 09 da proposta: Memória semântica.
**Architecture:** Capacidade registrada no núcleo; executor e persistência a confirmar após D1/D2.
**Tech Stack:** Reutilizar stack atual; nenhuma dependência nova aprovada.
**Spec:** [Desenho preliminar](../specs/2026-10-26-modular-agent-design-draft.md).
**Status:** BLOQUEADO PARA IMPLEMENTAÇÃO — escopo preliminar.
**Depends on:** 01 + 02 + D2/D8.

## Global Constraints
Aplicam-se todas as restrições e o procedimento TDD do [roadmap](2026-10-26-modular-agent-00-roadmap.md). Configuração por Sistema & Automação, persistência do switch, permissões verificadas na execução, dados preservados ao desligar e nenhuma nova tarefa automática após desativação.

## Arquivos e reuso a confirmar
- Reutilizar: src/main/memory.ts; src/shared/types/memory.ts; jasper-backend/runtime.py.
- Caminho proposto: `src/main/memory/semantic-index.ts` (não criado; responsabilidade/contrato final dependem das decisões).
- Testes propostos: `test/semantic-memory.test.ts`.
- Interfaces: consumir registro/estado/política de 01 e execução/resultados de 02; contratos exatos serão definidos somente após aprovação dos núcleos.

## Escopo funcional
Indexar fatos/preferências autorizados; recuperar por significado e contexto; deduplicar, atualizar, corrigir, listar e apagar; separar fato de hipótese.

## Decisão a perguntar antes de detalhar
Embeddings locais versus remotos, licença do modelo, custo/download e armazenamento de índices (D2/D8). Não enviar memórias para novo provedor sem consentimento.

## Review Focus e testes de aceite
Migração sem alterar fonte canônica; retenção atual de 30 dias; apagar fato remove vetor/cache; índice reconstruível; indisponibilidade do embedding; instalação/HWID divergente; recuperação com origem e confiança.

## Entregas separáveis
- [ ] Apresentar alternativas e obter decisão; pesquisar API oficial vigente ao detalhar integração externa.
- [ ] Especificar ferramentas com entradas/saídas, permissões, efeitos, timeout, cancelamento e verificações observáveis.
- [ ] Escrever teste vermelho para cada comportamento citado acima; fixar limites e mensagens no plano executivo.
- [ ] Implementar capacidade real e configuração/diagnóstico na tela existente; passar testes e regressões de chat/Live.
- [ ] Testar desligamento durante execução, reinício, licença revogada, configuração incompleta e falha parcial; sem expor segredo ou dado pessoal em auditoria.
- [ ] Demonstrar fluxo composto pelo orquestrador com evidência; testar aplicativo Windows empacotado.
- [ ] Registrar dependências, resultados reais e limitações; solicitar autorização antes de avançar para outra fase.

## Critério de conclusão
Não basta ferramenta funcionar isoladamente: switch persistente, configuração segura, estado operacional verdadeiro, descoberta pelo orquestrador, validação de permissão, cancelamento e artefato empacotado devem ser comprovados. Conta/serviço ainda não configurado é pendência, nunca sucesso simulado.

