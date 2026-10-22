# RELATÓRIO 7 — Build e Distribuição

## 7.1 Auditoria do Empacotamento Atual e Cadeia de Suprimentos

### [DIST-01] ~91 MB de Dependências Exclusivas do Renderer e Artefatos `.tsbuildinfo` Empacotados Redundantemente no `app.asar`
- **ID:** `DIST-01`
- **Severidade:** `MÉDIA` | **Confiança:** `Confirmada` | **Categoria:** `Distribuição`
- **Arquivo e intervalo de linhas:** [`package.json#L34-L49`](../package.json#L34-L49), [`electron-builder.yml#L8-L13`](../electron-builder.yml#L8-L13)
- **Descrição técnica:**
  As bibliotecas `@tensorflow/tfjs` (~60 MB), `three` (~27 MB) e `@tensorflow-models/speech-commands` são utilizadas exclusivamente no processo Renderer e já são inteiramente compiladas e embutidas pelo Vite dentro do bundle `out/renderer/assets/index-*.js`.
  Contudo, como constam no bloco `"dependencies"` (e não em `"devDependencies"`), o `electron-builder` copia todas as suas pastas completas de `node_modules/` para dentro do pacote final `resources/app.asar`. Além disso, o arquivo de cache do TypeScript `node_modules/@tensorflow/tfjs/dist/tsconfig.tsbuildinfo` (4,65 MB) é copiado para dentro do pacote.
- **Impacto:** O instalador NSIS e a pasta descompactada do aplicativo sofrem um inchaço desnecessário de quase 90 MB.
- **Recomendação:** Mover essas três dependências para `"devDependencies"` no `package.json` ou adicionar regras de exclusão no `electron-builder.yml`:
  ```yaml
  files:
    - "!node_modules/three/**/*"
    - "!node_modules/@tensorflow/**/*"
    - "!**/*.tsbuildinfo"
  ```

---

### [DIST-02] Executáveis Sem Assinatura Digital, Ausência de Workflow de Publicação para Releases e Download em Runtime de Modelos OCR
- **ID:** `DIST-02`
- **Severidade:** `ALTA` | **Confiança:** `Confirmada` | **Categoria:** `Distribuição`
- **Arquivo e intervalo de linhas:** [`electron-builder.yml#L22-L49`](../electron-builder.yml#L22-L49), [`.github/workflows/ci.yml#L1-L70`](../.github/workflows/ci.yml#L1-L70), [`scripts/setup-assets.mjs#L24-L41`](../scripts/setup-assets.mjs#L24-L41), [`scripts/scan-secrets.mjs#L20-L29`](../scripts/scan-secrets.mjs#L20-L29)
- **Descrição técnica:**
  1. **Ausência de assinatura Authenticode:** Os executáveis gerados não são assinados digitalmente por um certificado confiável pelo Windows. Isso resulta em alertas agressivos do Windows Defender SmartScreen para todos os usuários no primeiro lançamento e impede que o `electron-updater` verifique assinaturas confiáveis antes de aplicar patches.
  2. **Ausência de workflow de release automatizado:** `.github/workflows/ci.yml` apenas roda testes e typecheck. Não existe pipeline para gerar a tag, compilar o instalador e fazer o upload dos binários para o repositório de distribuição pública.
  3. **Download de modelos em runtime pelo Tesseract:** O pacote de idioma `por.traineddata` não é incluído em `extraResources`, sendo baixado da internet na primeira execução do OCR.
  4. **Padrões de escaneamento de segredos incompletos:** `scan-secrets.mjs` não valida regex para chaves Google AI (`AIza[0-9A-Za-z\-_]{35}`) nem tokens GitHub (`github_pat_`).
- **Recomendação:** Adicionar assinatura Authenticode (ou Azure Trusted Signing), empacotar os arquivos `.traineddata` localmente e atualizar as regras de escaneamento de segredos.

---

## 7.2 Análise Completa da Futura Arquitetura: Repositório de Código Privado + Releases Públicas

O modelo planejado pelo usuário consiste em:
- O repositório de código-fonte torna-se **privado**.
- Apenas as releases compiladas (instaladores `.exe`, `.blockmap`, `latest.yml`) permanecem públicas em um segundo repositório (`jasper-avatar-releases`).
- O código-fonte não deve ser publicado intencionalmente nas releases.

Abaixo está a avaliação técnica, operacional e de segurança dessa transição em 6 pilares essenciais:

### 1. Histórico Pregresso e Falsa Sensação de Segurança
A auditoria inspecionou todos os commits do Git desde a criação do repositório (`git log --all --full-history`). Não foram encontradas credenciais commitadas no histórico.
**Alerta Crítico:** Como o repositório foi público no passado, qualquer pessoa que já tenha clonado ou bifurcado (forked) o projeto possui o código-fonte de `license-manager.ts` e `config-store.ts`. Tornar o repositório privado **não impede** que quem já clonou o código contorne o licenciamento através das falhas [SEC-01]. As correções de código são obrigatórias antes da comercialização.

### 2. Proteção do Código no Pacote Distribuível (`app.asar`)
Por padrão, o formato `.asar` do Electron é apenas um arquivo de arquivamento (similar a um `.tar`), sem criptografia ou proteção contra leitura:
- Qualquer usuário final pode extrair os arquivos com `npx asar extract resources/app.asar ./app-source` e visualizar todo o código JavaScript compilado de `out/main/index.js`, `out/preload/index.js` e dos scripts PowerShell em `resources/scripts/`.
- **Como proteger:** É altamente recomendado habilitar o plugin oficial `bytecodePlugin` do `electron-vite` para compilar o código do processo Main e do Preload diretamente em **bytecode binário V8 (`.jsc`)**. O código JavaScript puro deixa de existir no `.asar`, inviabilizando a engenharia reversa trivial.

### 3. Workflow de Publicação Automatizado (Sem Vazamento de Código)
Para publicar instaladores no repositório público `jasper-avatar-releases` a partir do repositório privado de código:
1. Criar um Fine-Grained Personal Access Token (PAT) no GitHub com permissão restrita de leitura/escrita de conteúdo (`Contents: Read and write`) **apenas** no repositório `sAlly-19/jasper-avatar-releases`.
2. Salvar esse token como um GitHub Secret (`RELEASES_TOKEN`) no repositório privado de código.
3. Configurar uma GitHub Action `.github/workflows/release.yml` no repositório privado disparada pela criação de tags `v*`:
   - Executa `npm ci`, `npm run typecheck`, `npm test` e `npm run dist:win`.
   - Utiliza a GitHub CLI (`gh release create <tag> --repo sAlly-19/jasper-avatar-releases release/*.exe release/*.blockmap release/latest.yml`) para carregar exclusivamente os instaladores.
   - O repositório de releases deve conter apenas um `README.md`. Como nenhum código-fonte é commitado nele, os arquivos automáticos `Source code (zip)` gerados pelo GitHub na release pública conterão apenas o `README.md` do repositório de releases, nunca o código-fonte privado do app.

### 4. Funcionamento do Auto-Update (`electron-updater`)
A configuração atual em [`electron-builder.yml#L47-L49`](../electron-builder.yml#L47-L49) já está perfeitamente alinhada com esse modelo:
```yaml
publish:
  provider: generic
  url: https://github.com/sAlly-19/jasper-avatar-releases/releases/latest/download
```
- Usando o provedor genérico (`generic`) apontando para `/releases/latest/download`, o aplicativo cliente baixa `latest.yml` e os executáveis via HTTP GET público sem precisar de nenhum token de API do GitHub embutido no cliente.
- **Requisito Obrigatório:** O pipeline de release deve sempre fazer o upload de três artefatos para a mesma tag: o instalador `.exe`, o arquivo de hash em bloco `.exe.blockmap` e o manifesto de versão `latest.yml`.

### 5. Conformidade de Licenças de Código Aberto (OSS Compliance)
Todas as dependências declaradas em `package.json` utilizam licenças comerciais permissivas (**MIT**, **Apache 2.0**, **BSD-2-Clause**, **ISC**). Nenhuma dependência GPL ou AGPL com cláusulas de "viralidade" de código-fonte foi detectada, o que confere total conformidade legal para fechar o código-fonte do Jasper Avatar e comercializá-lo, desde que o arquivo de avisos de licença de terceiros (gerado automaticamente pelo Electron) seja mantido na pasta de instalação.

