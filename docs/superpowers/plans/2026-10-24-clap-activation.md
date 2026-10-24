# Ativação por palmas

## Decisão e escopo

Substituir a ativação por nome por duas palmas, separadas por 180–800 ms. O nome continua sendo identidade do assistente, não uma senha de voz. Manter o botão de microfone e a chave persistida `enableWakeWord` para compatibilidade.

Detecção local de transientes curtos, sem treinamento, rede ou gravação persistida. O microfone fica aberto enquanto a detecção estiver habilitada e o runtime autorizado. Pausar e liberar os recursos ao iniciar chamada ou bloquear licença. Sons semelhantes a palmas ainda podem ativar: não é um mecanismo de autenticação.

## Execução

- [x] Testes de duas palmas, eco, intervalo, ruído contínuo e cooldown.
- [x] Detector e captura WebAudio com cancelamento de inicialização e liberação de recursos.
- [x] Integrar no gerenciador existente; remover treinador por nome da tela e do runtime.
- [x] Testes de ciclo de vida em Electron, typecheck, suíte e build.
- [x] Registrar resultados e limitações para retomada.

## Estado inicial

Branch `main`. Preservar artefato não rastreado `jasper-backend/%SystemDrive%/` (não pertence à tarefa). Não alterar licença, credenciais ou backend de IA.

## Evidências — 24/10/2026

- `npm.cmd test`: 196 testes em 36 suítes, zero falhas. Cinco testes comportamentais substituem três antigos testes que exigiam o treinamento por nome.
- `npm.cmd run typecheck`: aprovado.
- `npm.cmd run test:wake`: `WAKE_LIFECYCLE_PASS`, com captura real WebAudio/AudioWorklet no Electron, PCM sintético de duas palmas, stop/restart, cancelamento imediato, pedido de permissão tardio e inicializações sobrepostas. Sem serviço de IA ou credencial.
- `npm.cmd run build`: aprovado; permanece aviso de chunk do renderer acima de 500 kB (684,56 kB).
- Revisão independente encontrou limpeza de bootstrap antigo que poderia interromper uma captura nova: a pausa compartilhada foi removida desse caminho; bloqueio de licença cancela a captura imediatamente. Avisos sobre falsos positivos e privacidade foram preservados também na atualização dinâmica da interface.
- Teste reproduziu falha de cancelamento imediato antes da correção; agora a geração é reservada antes de qualquer espera na inicialização do engine.

## Como utilizar e retomar

Reiniciar o aplicativo; em IA & Voz habilitar **Ativar com duas palmas** e salvar. Aguardar o estado **Aguardando duas palmas**, então bater duas palmas com aproximadamente 0,4 segundo entre elas. O botão de microfone continua disponível. Licença/consentimento continuam obrigatórios.

Não houve validação acústica com o microfone e o ambiente físicos do cliente: os testes de áudio usam PCM sintético e dispositivo de teste. Distância, ganho do dispositivo e ruídos podem exigir ajustes futuros de limiar; sons semelhantes podem ativar. Os modelos/arquivos antigos de Speech Commands permanecem inativos para evitar uma limpeza desnecessária de assets e dados locais nesta tarefa. Não houve publicação ou geração de novo instalador.
