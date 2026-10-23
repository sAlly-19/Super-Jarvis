# Política de Assinatura Windows e Authenticode

Este documento estabelece os padrões e requisitos de assinatura de código (Authenticode) para os artefatos comerciais do Jasper AI no Windows.

## 1. Requisitos Obrigatórios de Segurança

Todos os binários distribuídos comercialmente devem satisfazer:
1. **Status Authenticode Válido:** O status retornado por `Get-AuthenticodeSignature` deve ser estritamente `Valid`.
2. **Identidade do Publicador:** O certificado deve ter o Subject correspondente ao publicador oficial autorizado:
   `CN=Jasper Team, O=Jasper Team, L=Sao Paulo, C=BR`.
3. **Carimbo de Data/Hora Criptográfico (Timestamp RFC 3161):**
   Todos os binários devem ser carimbados contra uma autoridade de carimbo de tempo (ex.: `http://timestamp.digicert.com`), garantindo que as assinaturas permaneçam válidas mesmo após a expiração do certificado raiz.
4. **Electron Fuses Ativos:** A integridade do ASAR é validada pelo executável através das fuses embutidas (`enableEmbeddedAsarIntegrityValidation=true` e `onlyLoadAppFromAsar=true`).

## 2. Artefatos Alvos de Assinatura

Durante o pipeline de CI/CD de Release, os seguintes arquivos são assinados antes da publicação:
- **Sidecar Python:** `release\win-unpacked\resources\jasper-backend\jasper-backend.exe` e executáveis internos auxiliares.
- **Executável Principal Electron:** `release\win-unpacked\Jasper AI.exe`.
- **Instalador NSIS Comercial:** `release\Jasper-AI-Setup-*.exe`.
- **Arquivos de Atualização:** Metadados e binários consumidos pelo `electron-updater`.

## 3. Configuração de Segredos na CI (GitHub Actions)

As credenciais de assinatura **nunca** residem no repositório nem são acessíveis em pull requests de branches não confiáveis.

Os seguintes secrets devem estar configurados no ambiente de release protegido:
- `CSC_LINK`: Conteúdo codificado em Base64 do certificado de assinatura (.pfx).
- `CSC_KEY_PASSWORD`: Senha de proteção da chave privada do certificado .pfx.
- `AZURE_KEY_VAULT_TENANT_ID` / `AZURE_KEY_VAULT_CLIENT_ID` / `AZURE_KEY_VAULT_CLIENT_SECRET`: (Se utilizado Azure Trusted Signing).

## 4. Verificação de Assinatura

A verificação é automatizada pelo script PowerShell:
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-authenticode.ps1 `
    -Paths "release\win-unpacked\Jasper AI.exe", "release\win-unpacked\resources\jasper-backend\jasper-backend.exe" `
    -ExpectedPublisher "CN=Jasper Team, O=Jasper Team, L=Sao Paulo, C=BR"
```

Se qualquer assinatura estiver ausente, corrompida, sem carimbo de tempo ou divergir do publicador esperado, o script encerra com código `1` e interrompe a publicação do release.
