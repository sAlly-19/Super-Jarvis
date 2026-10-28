/** Match the NSIS shortcut identity; the process must use it before creating windows or toasts. */
export function initializeAppIdentity(application: { setAppUserModelId(id: string): void }, platform: NodeJS.Platform = process.platform): void {
  if (platform === 'win32') application.setAppUserModelId('com.jasper.avatar')
}
