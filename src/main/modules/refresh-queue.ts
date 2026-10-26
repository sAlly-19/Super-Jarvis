/** Every caller gets a fresh snapshot after prior negotiation, including after a failure. */
export class ModuleRefreshQueue {
  private tail: Promise<unknown> = Promise.resolve()

  public run<T>(refresh: () => Promise<T>): Promise<T> {
    const next = this.tail.then(refresh)
    this.tail = next.catch(() => {})
    return next
  }
}
