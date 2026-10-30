# Memória semântica local e permanente — proposta para revisão

**Data:**30/10/2026. **Estado:** desenho aprovado pelo usuário com “Sim”; autorizado detalhar os planos executivos. Nome draft preservado para não quebrar referências. A aprovação do desenho não autoriza executar planos ainda não revisados, instalar dependências, baixar pesos ou gerar release.

## 1. Objetivo e decisões recebidas

**Execução autorizada posterior ao desenho:** planos01/02 executados por autorização específica; candidata atual Transformers.js4.3.2 e ONNX Community/paraphrase-multilingual-MiniLM-L12-v2-ONNX, revisão d4c06bf0d7680171ac30042a1387e1fdb7a90021, com Apache2 explícita e gate real CPU offline. Referências3.8.1/Xenova abaixo registram a pesquisa inicial, não a escolha vigente. Resultados e limites no progresso30/10;03/04 ainda não implementados.

O Jasper deve aproveitar conhecimento acumulado, recuperar contexto por significado e evitar pedir novamente informações já conhecidas. Fatos, preferências e habilidades permanecem até exclusão manual. Memória factual e habilidades procedurais são componentes separados e conectados. O usuário escolheu aprendizagem automática de habilidades a partir de tarefas bem-sucedidas; essa segunda entrega terá especificação própria.

Decisões confirmadas: busca/armazenamento locais, sem chave adicional de embeddings; trechos relevantes podem ser enviados à IA configurada. Pesos do modelo serão baixados na ativação do módulo ou no primeiro uso com o módulo já ativo, não incluídos no instalador. Preservar Main/ModuleBridge, execução direta, licença72h e Total Control sem confirmação por operação. Sem Planner obrigatório ou geração de executáveis nesta fase.

## 2. Estado atual verificado

`src/main/memory.ts` é a fonte canônica atual, em JSON vinculado à instalação. O MemoryStore filtra fatos mais antigos que30 dias tanto em load quanto em save. Tipos atuais: ID, fact, createdAt; nome e preferências ficam em campos próprios. O Main encaminha memory_snapshot e recebe memory_upsert pelo stdio. O runtime também usa fatos no prompt.

Não criar uma segunda fonte concorrente com os mesmos fatos. A mudança de retenção precisa ocorrer antes de qualquer leitura legada que ainda elimine fatos por idade. Não prometer recuperação de memórias que já foram eliminadas anteriormente. Nenhum arquivo de memória pessoal foi lido para este desenho.

## 3. Arquitetura proposta e alternativas

**Recomendação:** manter uma fonte canônica de memória compatível com a API atual e acrescentar índice local reconstruível, com busca híbrida: correspondência textual para nomes/identificadores e embeddings para significado. Main mantém autorização/persistência; inferência local roda fora da UI e do event loop principal, com fila e cancelamento. Python recebe somente contexto relevante autorizado.

Alternativa mais simples: busca apenas textual, sem modelo adicional. Menor preparação e consumo, mas não atende à mesma recuperação por significado. Não é a recomendação para o objetivo declarado. Embeddings remotos não fazem parte da abordagem local aprovada.

Proposta de armazenamento: evoluir o formato do MemoryStore para conteúdo protegido por safeStorage e usar SQLite como índice derivado, reutilizando a infraestrutura existente. IDs/revisões mínimos podem ficar em metadados; texto, termos e vetores devem permanecer protegidos. Versão do índice inclui versão de modelo/tokenização; troca de modelo reconstrói derivados sem reescrever fatos. Formato/migração exatos serão fixados nos planos após aprovação desta arquitetura.

## 4. Retenção, edição e exclusão

Remover a expiração automática de30 dias para fatos e preferências e não introduzir outra limpeza por idade ou relevância. Conhecimento pouco usado pode ter menor posição na busca, mas não será apagado automaticamente. Limites de recursos devem impedir trabalho excessivo e informar indisponibilidade; nunca eliminar registros silenciosamente para liberar espaço.

Migração deve preservar os dados existentes, detectar o formato antigo antes de chamar load/save que aplicavam TTL e publicar a versão nova atomicamente. Falha de proteção, JSON inválido, instalação divergente ou migração interrompida não autoriza substituir a memória por documento vazio. Backups e comportamento de recuperação devem constar do plano de persistência.

Editar/corrigir invalida versões de índice antigas. Apagar remove fonte canônica e derivados, com geração/revisão que impeçam callbacks de reindexação ou aprendizagem de recriar o item. Invalidar contextos de memória em Main/sidecar. Não prometer revogação de dados já enviados a provedores nem apagamento forense de backups/WAL.

## 5. Preparação do modelo sob demanda

Ao ativar Memória semântica, verificar artefatos locais. Se ausentes, iniciar uma preparação visível no painel. Se o módulo já estiver ativo e faltar o recurso no primeiro uso, iniciar a mesma preparação, sem tarefas de download duplicadas. Abrir o aplicativo/painel com módulo desligado não faz download.

Estados propostos: não preparado, baixando, verificando, pronto, cancelado e erro. Mostrar progresso e ação para tentar novamente; não bloquear a interface nem anunciar busca semântica pronta antes do teste de carregamento. Falha não apaga fatos existentes e não troca para um serviço remoto. O estado de persistência permanente deve ser separado do estado do motor de busca.

Baixar somente uma variante de pesos e os arquivos auxiliares necessários, de origem/versionamento fixados pelo aplicativo. Manifesto com tamanho e SHA-256 verificados antes da publicação atômica. Não executar código remoto do modelo. Revalidar módulo/licença antes de publicar o recurso; desligar/cancelar interrompe a operação. Arquivo parcial nunca é carregado. Arquivos íntegros podem ser reutilizados em ativações posteriores sem novo download.

Após a preparação, consultas de embeddings usam apenas arquivos locais. A biblioteca não deve fazer downloads implícitos nem acessar CDN durante inferência. Rede fica restrita ao mecanismo explícito de preparação. Não instalar outro serviço ou abrir porta local.

## 6. Candidato técnico e limites da pesquisa

Candidato investigado, ainda não selecionado: Transformers.js com ONNX multilíngue paraphrase-multilingual-MiniLM-L12-v2 em INT8. Listagem consultada informa118MB para model_int8.onnx e17,1MB para tokenizer.json, além de configurações pequenas. Não baixar o repositório inteiro, que reúne múltiplas variantes. Esses números não são tamanho final do runtime, instalador ou RAM.

O modelo original declara Apache-2.0. Antes de selecionar os artefatos convertidos, validar proveniência, licenças/notices de pacote/runtime/pesos, compatibilidade Electron/Windows e versão fixa. Documentação estável3.8.1 consultada permite caminho de modelo local, allowRemoteModels=false e runtime WASM local. Isso demonstra uma API candidata, não validação do binário ou qualidade em português.

O plano deve verificar CPU, pico de RAM, latência fria/quente, instalação em caminho com espaços, ausência de rede na inferência e pares positivos/negativos em português. Não prometer melhoria universal nem escolher parâmetros de relevância apenas por exemplos favoráveis.

## 7. Recuperação e integração propostas

Consultas de chat e Live recuperam poucos trechos relevantes dentro de um orçamento de contexto explícito, com origem, ID e revisão. Não injetar toda a memória permanente em cada pedido. Dados recuperados são contexto, não instruções de sistema, autorização ou prova de execução.

Itens semelhantes não serão fundidos apenas pela proximidade de vetores. Correção explícita do usuário tem precedência; fatos contraditórios precisam de origem e tratamento visível, sem apagar silenciosamente informação distinta. A proposta inicial reaproveita captura de fatos existente e edição/remoção no painel; não grava automaticamente páginas/e-mails inteiros como fatos sobre o usuário.

Desligar a recuperação semântica preserva a memória. Gestão local continua exigindo licença/consentimento. O desenho não adiciona sincronização de memórias entre PCs/clientes nem treinamento dos pesos dos modelos de conversa.

## 8. Habilidades aprendidas — fronteira da próxima entrega

O índice deve poder recuperar referências de habilidades no futuro, sem misturar fatos com procedimentos. Armazenamento, promoção automática por sucesso observado, parâmetros, versões, reutilização, desativação e exclusão de habilidades pertencem a uma especificação própria após o núcleo de memória.

Aprender não concede novas permissões: a execução continua nas ferramentas autorizadas. Código de saída zero não prova automaticamente sucesso do objetivo; texto final do modelo também não. Não reintroduzir confirmação por operação para resolver essa diferença. A política exata de evidência de sucesso precisa ser definida nessa segunda entrega.

## 9. Validação e próximos gates

Planos deverão separar persistência/migração/retencão, preparação do recurso, índice/busca, integração chat/Live/painel e aceite. TDD, uma revisão final, scanner, tipos, testes Python/TS e build de desenvolvimento. Testes usam diretórios/perfis sintéticos; não migrar a memória real como teste.

Critérios: fatos existentes preservados, nenhuma expiração por idade, busca positiva e negativa em português, edição/exclusão sem ressurreição, modelo ausente/corrompido/download interrompido, falha de proteção, licença/módulo revogados e ausência de rede após preparo. Manter roadmap de release separado; sem executável agora.

Este documento contém propostas técnicas para revisão, não decisões já confirmadas em todos os detalhes. Após aprovação escrita, criar os planos executivos; só depois da revisão dos planos iniciar implementação.

## Referências primárias

- https://huggingface.co/docs/transformers.js/v3.8.1/en/custom_usage
- https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2/tree/main/onnx
- https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2/tree/main
- https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2
- https://github.com/huggingface/transformers.js
