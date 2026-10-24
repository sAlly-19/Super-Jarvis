# Jasper AI Desktop

Aplicativo desktop comercial para Windows com avatar 3D interativo, voz em tempo real e agente autônomo total de controle de sistema operacional. O renderer roda estritamente isolado do processo principal do Electron e todo o tráfego do agente é intermediado por canais IPC tipados no processo Main.

## Arquitetura Comercial

- **Processo Principal (Main):** Electron 44, TypeScript, Node.js 24 LTS, com Electron Fuses ativas (`enableEmbeddedAsarIntegrityValidation=true`, `onlyLoadAppFromAsar=true`).
- **Processo de Interface (Renderer):** HTML5, CSS3, Three.js e TensorFlow.js, carregado exclusivamente pelo protocolo privilegiado `app://jasper/index.html` com Content Security Policy estrita (`script-src 'self'`).
- **Sidecar de Agente (Python):** Binário independente compilado via PyInstaller no formato `onedir` (`resources/jasper-backend/jasper-backend.exe`), com dependências travadas via hashes SHA-256 (`requirements.lock`).
- **Protocolo de Comunicação Privado:** Enquadramento binário com prefixo de 4 bytes big-endian e envelopes JSON versionados sobre `stdio` privado (stdin/stdout). **Zero portas de rede locais** (sem WebSocket ou HTTP em `127.0.0.1:8765`).
- **Integridade Criptográfica:** O Main valida o manifesto SHA-256 (`backend-manifest.ts`) embutido no ASAR de cada arquivo do sidecar antes de permitir execução. Arquivos extras ou alterados causam falha fechada imediata.
- **Licenciamento Criptográfico:** Validação de lease Ed25519 com amarração em Hardware ID (HWID). Quando sem licença válida, a aplicação opera em shell de ativação bloqueado sem inicializar o sidecar Python.
- **Consentimento Operacional Comercial:** Termo de consentimento de controle autônomo vinculado à instalação (`controlConsentInstallationId`). Sem confirmações modais repetitivas por comando.
- **Log de Auditoria Rotativo:** Registro de eventos em disco limitado a 5 MiB com rotação de até 5 arquivos históricos, com redação obrigatória de chaves de API, JWTs, senhas e credenciais.
- **Memória Única Sincronizada:** Persistência em `userData/memory.json` sincronizada com o runtime do agente e poda automática de retenção a cada 30 dias.
- **Provedores de IA e Credenciais Independentes (BYOK):** Suporte nativo a **Google Gemini** (`gemini/gemini-3.8-flash`), **Groq** (`groq/llama-3.3-70b-versatile`) com chaves de API independentes criptografadas localmente via Windows DPAPI (`safeStorage`), e **Ollama** (`ollama/qwen2.5:3b`) via execução local (`http://127.0.0.1:11434`) sem necessidade de chave de API. O processo Renderer recebe exclusivamente resumos mascarados e o sidecar Python recebe apenas a credencial do provedor ativo.

## Requisitos de Desenvolvimento

- Node.js 24 LTS (motor `>=24 <25`)
- npm 11+
- Python 3.11 (via `uv` ou cpython-3.11)
- Windows 10/11 x64
- Windows PowerShell 5.1+

## Comandos do Projeto

### Instalação e Desenvolvimento
```powershell
npm ci
npm run dev
```

`npm run dev` localiza somente instalações determinísticas do Python 3.11, valida a versão e fornece o caminho absoluto ao processo Electron. Para usar outra instalação, defina `JASPER_PYTHON_EXECUTABLE` com o caminho absoluto de um executável Python 3.11. O aplicativo comercial empacotado usa o sidecar incluído e não exige Python instalado na máquina do cliente.

### Bateria de Verificação e Testes
```powershell
npm run verify           # Executa typecheck, testes reais TS e compilação electron-vite
npm run test:python       # Executa testes unitários do protocolo e runtime Python
npm run scan:secrets      # Escaneia o repositório contra vazamento de credenciais
npm run audit:runtime     # Auditoria de segurança de dependências npm contra o registro oficial
npm run audit:python      # Auditoria de vulnerabilidades em dependências travadas do Python
```

### Compilação do Sidecar Python
```powershell
npm run build:python      # Compila o backend Python em build/python-backend/jasper-backend
npm run sbom:python       # Gera SBOM CycloneDX das dependências Python
```

### Empacotamento e Teste de Aceitação Empacotado
```powershell
npm run package:dir       # Gera a distribuição descompactada em release/win-unpacked
npm run verify:package    # Valida integridade do sidecar, manifesto SHA-256 e fuses
npm run smoke:packaged    # Executa smoke test com PATH sanitizado (sem Python/Node global)
```

### Release e Assinatura Authenticode
```powershell
npm run dist:win          # Compila o instalador NSIS comercial para Windows x64
```
A verificação de assinatura Authenticode é realizada por:
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-authenticode.ps1 `
    -Paths "release\win-unpacked\Jasper AI.exe", "release\win-unpacked\resources\jasper-backend\jasper-backend.exe" `
    -ExpectedPublisher "CN=Jasper Team, O=Jasper Team, L=Sao Paulo, C=BR"
```
Consulte `docs/release/windows-signing.md` para detalhes sobre configuração de certificados na CI/CD do GitHub Actions.
