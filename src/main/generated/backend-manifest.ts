export interface ManifestFileEntry {
  path: string
  sha256: string
}

export interface BackendManifest {
  protocolVersion: 1
  backendVersion: string
  executable: string
  files: ManifestFileEntry[]
}

export const DEFAULT_BACKEND_MANIFEST: BackendManifest = {
  protocolVersion: 1,
  backendVersion: '2.0.0',
  executable: 'jasper-backend.exe',
  files: []
}
