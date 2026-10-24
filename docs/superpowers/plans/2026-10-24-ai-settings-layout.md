# Ajuste visual — IA & Voz

## Escopo

Melhorar a legibilidade da tela existente, preservando IDs, eventos, credenciais e comportamento. Manter visual monocromático. Não alterar backend ou integração de voz.

- [x] Separar provedor/modelo da seleção de voz e explicar Gemini Live em aviso próprio.
- [x] Evitar títulos de credenciais comprimidos pelo badge; padronizar campos e botões.
- [x] Exibir Ollama em largura completa e adaptar a grade à largura do painel.
- [x] Verificar build e layout em Chromium; registrar resultado.

Alterações locais preservadas, incluindo a implementação anterior de palmas e o artefato não rastreado do backend.

## Evidências

- `node scripts/test-settings-layout.cjs`: aprovado em 1100, 800 e 600 px. Confere ausência de overflow nos cartões/campos, alinhamento dos seletores e tamanho dos botões. Usa HTML estático, sem backend e sem credenciais reais.
- Screenshot de 1100 px inspecionado: títulos das credenciais legíveis, badges em linha própria, campos e ações alinhados, aviso Live separado.
- `npm.cmd test`: 196 testes, zero falhas.
- `npm.cmd run build`: aprovado; aviso existente de chunk acima de 500 kB permanece.
- `git diff --check`: aprovado.

Não foi alterada a escolha do provedor, a persistência das chaves nem a chamada de voz. Reiniciar o aplicativo para carregar o layout compilado.
