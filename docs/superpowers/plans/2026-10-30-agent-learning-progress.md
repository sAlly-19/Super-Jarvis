# Memória e habilidades — intenção e continuidade

**Data:**30/10/2026. **Estado:** desenho em discussão, sem autorização de implementação nem dependência escolhida.

Usuário aprovou avançar à Memória semântica e quer que o Jarvis melhore com o tempo. Perguntou se habilidades/skills devem ser adicionadas juntas ou separadas. Casa inteligente e Webhooks adiados por falta de dispositivos/integrações atuais; Documentos e Outlook continuam adiados.

Proposta apresentada para discussão: memória factual/preferências, biblioteca de habilidades procedurais separada e feedback de execução. Habilidades reutilizam ferramentas já autorizadas do Main/ModuleBridge, sem restaurar Planner obrigatório. Lembrar conteúdo não concede autoridade nem permite promover instruções de páginas/e-mails a habilidades automaticamente.

Melhorar por recuperação de contexto, procedimentos e resultados observados não significa treinar ou atualizar automaticamente os pesos dos modelos Gemini/Groq. Não prometer melhoria monotônica: procedimentos precisam de versão, correção e possibilidade de desativação/reversão.

Código atual `src/main/memory.ts` retém fatos por30 dias. Não alterar silenciosamente essa regra: política de memória duradoura, captura/edição/exclusão, aprendizagem de habilidades e embeddings precisam de decisões antes da especificação e dos planos. Preferências do usuário: skills no desenvolvimento, artefatos .md, main, sem instaladores; perguntar quando houver alternativas materiais.

Próximo passo: esclarecer como habilidades serão ensinadas/adquiridas; consolidar desenho escrito para revisão e só então separar planos executivos. Nenhuma mudança de produto nesta rodada.

## Decisão do usuário — aprendizagem e retenção

Usuário escolheu aprendizagem automática a partir de tarefas bem-sucedidas, com permanência na memória até exclusão manual. Habilidades aprendidas não terão expiração automática. Isso aprova a direção funcional; não autoriza implementar antes de revisar especificação/plano.

Entendimento a consolidar: distinguir o resultado observado de sucesso presumido; transformar execução em procedimento parametrizado, sem copiar segredos ou promover conteúdo externo a instrução autorizada. Manter versões e correções, sem remover automaticamente habilidades antigas. Não adicionar confirmação por operação ao Total Control.

Ponto de decisão seguinte: processamento/índice local versus serviço externo para recuperação semântica. Recomendação a discutir: armazenamento e busca locais, sem outro cadastro/chave; trechos recuperados podem integrar o contexto enviado ao modelo de IA já configurado. Não prometer que o modelo remoto deixa de receber esses trechos. A abrangência da retenção permanente sobre todos os fatos atuais, além das habilidades, deve ficar explícita na especificação; não alterar o MemoryStore de30 dias nesta rodada documental.

## Decisão do usuário — abordagem local

Usuário respondeu “SIM” à recomendação de armazenamento e busca locais, sem outra chave de API, ciente de que trechos recuperados poderão integrar o contexto do modelo configurado. Não foi escolhido ainda modelo/biblioteca de embeddings nem autorizado download/instalação.

Tratar a iniciativa como arquitetura e decompor em duas entregas: (1) memória semântica/local e política de retenção; (2) habilidades aprendidas conectadas à memória e ferramentas atuais. Cada entrega terá desenho escrito e planos próprios antes da implementação; separar componentes não exige serviço externo nem outro produto. Reutilizar os gates e módulos do Main, sem reintroduzir Planner obrigatório.

Inspeção confirmou expiração de fatos em load e save do MemoryStore atual, snapshot de memória para o sidecar e persistência via memory_upsert. Portanto, mudar apenas a recuperação semântica não basta para tornar as memórias permanentes; regras de retenção e migração precisam ser explícitas. Nenhum dado real do usuário foi aberto nesta inspeção, somente código-fonte.

## Decisão do usuário — retenção de fatos e preferências

Usuário confirmou “SIM” que a permanência vale também para todos os fatos e preferências, além das habilidades. O desenho deve substituir a expiração automática de30 dias por retenção até exclusão manual. Preservar registros existentes na migração; não prometer recuperar registros já eliminados pelo comportamento antigo. Não modificar load/save antes da aprovação da especificação e dos planos.

## Pesquisa de viabilidade local — sem instalação

Documentação oficial Transformers.js permite feature-extraction local, caminho próprio de modelos e desabilitar carregamento remoto. Candidato investigado: ONNX multilíngue `Xenova/paraphrase-multilingual-MiniLM-L12-v2`; não adotado nem baixado. Licenças do pacote, pesos originais/conversão, integridade, versão fixa, desempenho em português e compatibilidade com Electron devem ser validados antes de aprovar componente comercial. Não confundir usar a biblioteca com ter modelo treinado pelo Jasper.

Fontes consultadas: https://huggingface.co/docs/transformers.js/en/custom_usage ; https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2 ; https://github.com/huggingface/transformers.js . A documentação main não foi tratada como versão estável automaticamente.

Proposta a discutir: recuperação híbrida (significado por embeddings locais + correspondência textual para nomes/caminhos), contra alternativa inicial somente textual, que é menor mas não entrega a mesma recuperação por significado. Nenhuma biblioteca escolhida/instalada. Decisão material seguinte para o modelo local: distribuir junto ao instalador ou baixar no primeiro uso; apresentação ao usuário recomenda distribuição incluída para o produto comercial funcionar sem download adicional dessa função. Sem gerar instalador agora.

## Decisão do usuário — distribuição sob demanda

Usuário escolheu **download no primeiro uso ou ao ativar o módulo**, em vez de incorporar os pesos ao instalador. Registrar essa preferência como vigente; a recomendação anterior de pesos incluídos não foi adotada. Ativação deve preparar o recurso, com progresso/cancelamento/erro explícitos; primeiro uso pode disparar preparação se o módulo já estiver ativo e o modelo faltar. Não baixar ao abrir o aplicativo ou com módulo desligado. Depois da preparação, inferência local offline; não criar consulta remota de embeddings como fallback.

Somente arquivos necessários da variante selecionada, versão fixa e integridade verificada; não clonar todas as variantes do repositório. Tamanho de referência investigado:118MB de pesos INT8 +17,1MB tokenizer e configurações (~135MB), não inclui runtime nem mede RAM. Pacote/runtime, licença e benchmark permanecem candidatos para revisão; nenhum download de pesos ou instalação executado nesta conversa.

Desenho da primeira entrega preparado para revisão em `docs/superpowers/specs/2026-10-30-semantic-memory-design-draft.md`. Habilidades automáticas serão uma segunda especificação dependente da memória, sem presumir como aprovados detalhes ainda não discutidos de promoção/versionamento.

## Desenho aprovado e planos preparados

Usuário respondeu “Sim” à revisão do desenho escrito. Essa aprovação autorizou detalhar planos, não executar artefatos ainda não apresentados. Método nativo/main continua escolhido; não perguntar novamente por nativo/subagentes.

Planos escritos e autorrevisados:

1. `2026-10-30-semantic-memory-00-execution-map.md`: ordem, contratos, limites propostos e gates.
2. `2026-10-30-semantic-memory-01-permanent-store.md`: fonte canônica protegida, migração sem TTL, mutações com token e adaptador.
3. `2026-10-30-semantic-memory-02-model-preparation.md`: manifesto pinado, downloader, worker e gate real offline.
4. `2026-10-30-semantic-memory-03-retrieval.md`: índice derivado010, chunks, ranking e qualidade PT-BR.
5. `2026-10-30-semantic-memory-04-integration.md`: composição, origem de captura, chat/Live/painel e aceite.

Autorrevisão corrigiu: dependência circular do gateworker antes do downloader; token completo (geração+revisão) para impedir ressurreição após editar; save legado rastreado em vez de full replace cego; namespace de fontes para evitar colisão de IDs; tipos de tokenizer/chunks/manifesto; estado com token null quando proteção indisponível; escopo de preparação10min independente de recall3s; restore/diagnóstico não disparam download. Qualidade real, hashes definitivos, licenças da conversão e compatibilidade Electron são gates de execução, não testes já aprovados.

Validação documental: cinco planos, zero links locais ausentes; diff check sem erro. Nenhum teste de produto, dependência, modelo, migração, índice, commit/push ou instalador executado nesta rodada. Nenhum agente disparado: autorrevisão conforme writing-plans.

**Próximo gate:** usuário revisar/aprovar os planos no mapa00. Depois executar01 pelo método nativo/main, com ledgers e evidências. Habilidades automáticas continuam desenho posterior, não implementadas como efeito colateral da memória.
Execução01 autorizada com Sim e implementada em componentes isolados. Progresso/evidências em 2026-10-30-semantic-memory-progress.md. Fonte ativa só será trocada em04; sem downloads/instalação/perfil real/commit/push.02 é a próxima etapa.
