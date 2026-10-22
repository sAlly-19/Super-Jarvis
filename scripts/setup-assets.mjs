import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

async function main() {
  console.log('[setup-assets] Setting up Jasper 3D assets...')

  const assetsModelDir = path.join(rootDir, 'assets', 'models')
  const publicModelDir = path.join(rootDir, 'public', 'models')

  ensureDir(assetsModelDir)
  ensureDir(publicModelDir)

  // 1. Setup facecap.glb with offline fallback and immutable pinned URL
  const facecapAssetPath = path.join(assetsModelDir, 'facecap.glb')
  const facecapPublicPath = path.join(publicModelDir, 'facecap.glb')

  try {
    if (fs.existsSync(facecapAssetPath) && fs.statSync(facecapAssetPath).size > 10000) {
      console.log(`[setup-assets] Usando asset local já existente em ${facecapAssetPath}`)
      fs.copyFileSync(facecapAssetPath, facecapPublicPath)
      console.log(`[setup-assets] Copiado facecap.glb para ${facecapPublicPath}`)
    } else if (fs.existsSync(facecapPublicPath) && fs.statSync(facecapPublicPath).size > 10000) {
      console.log(`[setup-assets] Usando asset de ${facecapPublicPath}`)
      fs.copyFileSync(facecapPublicPath, facecapAssetPath)
    } else {
      throw new Error('Asset local assets/models/facecap.glb ausente.')
    }
  } catch (err) {
    console.error('[setup-assets] Erro configurando facecap.glb:', err.message)
  }

  // Ensure electron binary and path.txt exist
  const electronDir = path.join(rootDir, 'node_modules', 'electron')
  const electronExe = path.join(electronDir, 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron')
  const electronPathTxt = path.join(electronDir, 'path.txt')
  if (!fs.existsSync(electronExe)) {
    const installJs = path.join(electronDir, 'install.js')
    if (fs.existsSync(installJs)) {
      console.log('[setup-assets] Electron binary missing. Running electron/install.js...')
      try {
        const { execSync } = await import('child_process')
        execSync(`node "${installJs}"`, { stdio: 'inherit' })
      } catch (err) {
        console.warn('[setup-assets] Warning: Could not auto-install electron binary:', err.message)
      }
    }
  }
  if (fs.existsSync(electronExe) && !fs.existsSync(electronPathTxt)) {
    fs.writeFileSync(electronPathTxt, process.platform === 'win32' ? 'electron.exe' : 'electron')
    console.log('[setup-assets] Configured electron/path.txt successfully.')
  }

  console.log('[setup-assets] Done!')
}

main().catch(console.error)

