import esbuild from 'esbuild'
import { spawnSync } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import os from 'os'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

// Keep generated bundles and runtime data out of the repository.
const tempTestRoot = path.join(os.tmpdir(), `jasper-tests-${process.pid}-${Date.now()}`)
const tempUserData = path.join(tempTestRoot, 'user-data')
const resolvedTempRoot = path.resolve(os.tmpdir())
const resolvedTestRoot = path.resolve(tempTestRoot)
if (!resolvedTestRoot.startsWith(`${resolvedTempRoot}${path.sep}`)) {
  throw new Error('Diretório temporário de testes fora da pasta temporária do sistema.')
}
fs.mkdirSync(resolvedTestRoot, { recursive: true })
fs.mkdirSync(tempUserData, { recursive: true })
fs.symlinkSync(path.join(rootDir, 'node_modules'), path.join(tempTestRoot, 'node_modules'), 'junction')

// Create a real mock shim for Electron APIs so production classes run cleanly under Node.js test runner
const electronMockShim = `
import os from 'node:os';
import path from 'node:path';
const tempUserData = ${JSON.stringify(tempUserData)};

export const app = {
  getPath: (name) => tempUserData,
  getAppPath: () => ${JSON.stringify(rootDir)},
  getVersion: () => '1.0.1-test',
  isPackaged: false,
  whenReady: () => Promise.resolve(),
  quit: () => {}
};

export const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (str) => Buffer.from(str, 'utf-8'),
  decryptString: (buf) => buf.toString('utf-8')
};

export const clipboard = {
  readText: () => Promise.resolve(''),
  writeText: () => Promise.resolve()
};

export const nativeImage = {
  createFromPath: () => ({
    isEmpty: () => true,
    getSize: () => ({ width: 0, height: 0 }),
    toBitmap: () => Buffer.alloc(0)
  })
};

export const BrowserWindow = class {
  constructor() {}
  loadURL() { return Promise.resolve(); }
  webContents = {
    session: { webRequest: { onBeforeRequest(_filter, _handler) {} } },
    setAudioMuted() {},
    getTitle() { return 'Página Corporativa Jasper'; },
    capturePage() { return Promise.resolve({ toDataURL: () => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' }); },
    executeJavaScript(script) {
      if (typeof script === 'string' && script.includes('.click()')) return Promise.resolve({ found: true });
      if (typeof script === 'string' && script.includes('credentialRisk')) return Promise.resolve({ found: true, credentialRisk: false });
      if (typeof script === 'string' && script.includes('el.value =')) return Promise.resolve({ found: true });
      if (typeof script === 'string' && (script.includes('extract_table') || script.includes('table'))) {
        return Promise.resolve({ found: true, headers: ['Plano', 'Valor'], rows: [['Jasper Pro', 'R$ 197']] });
      }
      return Promise.resolve('Mocked page content');
    },
    printToPDF: () => Promise.resolve(Buffer.from('%PDF-1.4 Mock PDF Stream Generated\\n%%EOF'))
  };
  destroy() {}
  isDestroyed() { return false; }
};

export const shell = {
  openExternal: () => Promise.resolve()
};

export const desktopCapturer = {
  getSources: () => Promise.resolve([
    {
      name: 'Entire Screen',
      id: 'screen:0:0',
      thumbnail: {
        toJPEG: () => Buffer.from('fake-jpeg-data'),
        getSize: () => ({ width: 1280, height: 720 })
      }
    }
  ])
};

export const dialog = {
  showMessageBox: () => Promise.resolve({ response: 1, checkboxChecked: false }),
  showOpenDialog: () => Promise.resolve({ canceled: true, filePaths: [] })
};

export const session = {
  defaultSession: {
    setPermissionRequestHandler() {},
    setPermissionCheckHandler() {}
  }
};

export const ipcMain = {
  _handlers: new Map(),
  _listeners: new Map(),
  handle(channel, fn) { this._handlers.set(channel, fn); },
  on(channel, fn) { this._listeners.set(channel, fn); },
  removeListener(channel) { this._listeners.delete(channel); },
  removeAllListeners() { this._handlers.clear(); this._listeners.clear(); }
};

export const ipcRenderer = {
  invoke() { return Promise.resolve(); },
  send() {},
  on() {},
  removeListener() {}
};

export const screen = {
  getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } })
};

export default { app, safeStorage, clipboard, nativeImage, BrowserWindow, shell, desktopCapturer, dialog, session, screen, ipcMain, ipcRenderer };
`

const mockPath = path.join(tempTestRoot, '_electron-mock.mjs')
fs.writeFileSync(mockPath, electronMockShim, 'utf-8')

const updaterMockShim = `
export const autoUpdater = {
  autoDownload: false,
  autoInstallOnAppQuit: false,
  on() { return this; },
  checkForUpdates: () => Promise.resolve(null),
  downloadUpdate: () => Promise.resolve([]),
  quitAndInstall() {}
};
`
const updaterMockPath = path.join(tempTestRoot, '_electron-updater-mock.mjs')
fs.writeFileSync(updaterMockPath, updaterMockShim, 'utf-8')

// Bundle tests with esbuild resolving real TypeScript classes and @shared aliases
console.log('[run-tests] Empacotando testes com as implementações REAIS do sistema...')

function findTestFiles(dir, baseDir = dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  let files = []
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...findTestFiles(fullPath, baseDir))
    } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      const rel = path.relative(baseDir, fullPath).replace(/\\/g, '/')
      files.push(rel)
    }
  }
  return files.sort()
}

const filterArg = process.argv.slice(2).find((arg) => !arg.startsWith('-'))
const allDiscovered = findTestFiles(path.join(rootDir, 'test'))
const selectedFiles = filterArg
  ? allDiscovered.filter((f) => f.includes(filterArg))
  : allDiscovered

const testFiles = selectedFiles.map((rel) => ({
  in: rel,
  out: rel.replace(/\.test\.ts$/, '.test.mjs').replace(/\//g, '_')
}))

for (const tf of testFiles) {
  esbuild.buildSync({
    entryPoints: [path.join(rootDir, 'test', tf.in)],
    outfile: path.join(tempTestRoot, tf.out),
    bundle: true,
    platform: 'node',
    format: 'esm',
    alias: {
      'electron': mockPath,
      'electron-updater': updaterMockPath,
      '@shared': path.join(rootDir, 'src', 'shared', 'index.ts')
    },
    external: [
      'three',
      '@tensorflow/tfjs',
      '@tensorflow-models/speech-commands',
      'dotenv',
      'systeminformation',
      'exceljs',
      'docx',
      'qrcode',
      'pdf-parse',
      'mammoth',
      'jsqr',
      'tesseract.js'
    ]
  })
}

console.log('[run-tests] Executando suíte de testes de integração real...')
const outFiles = testFiles.map((tf) => path.join(tempTestRoot, tf.out))
const res = spawnSync(process.execPath, ['--test', '--test-force-exit', '--test-timeout=120000', '--test-concurrency=1', ...outFiles], {
  cwd: rootDir,
  stdio: 'inherit',
  timeout: 300000
})

// Cleanup all generated test artifacts.
try {
  fs.rmSync(resolvedTestRoot, { recursive: true, force: true })
} catch {}

process.exit(res.status ?? 0)
