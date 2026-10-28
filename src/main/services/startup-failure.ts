import { app, dialog } from 'electron'
interface FailureReporter { show(title: string, message: string): void; exit(code: number): void; log(message: string): void }
export function reportStartupFailure(error: unknown, reporter: FailureReporter = {
  show: (title, message) => dialog.showErrorBox(title, message), exit: code => app.exit(code), log: message => console.error(message)
}): void {
  const mismatch = error instanceof Error && error.message === 'module_installation_mismatch'
  reporter.log(`[Startup] ${mismatch ? 'module_installation_mismatch' : 'initialization_failed'}`)
  const message = mismatch
    ? 'Não foi possível confirmar que os módulos salvos pertencem a esta máquina. Seus arquivos foram preservados. Feche e reabra o Jasper; se persistir, verifique a identificação desta instalação antes de migrar os dados.'
    : 'Não foi possível inicializar o Jasper. Seus arquivos foram preservados. Feche e reabra o aplicativo; se persistir, consulte o diagnóstico de inicialização no terminal.'
  try { reporter.show('Jasper — falha na inicialização', message) } catch { /* Still terminate cleanly if the desktop cannot display a dialog. */ }
  reporter.exit(1)
}
