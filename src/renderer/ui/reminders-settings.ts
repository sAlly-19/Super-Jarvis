import type { ImportReport, MutationRequest, NativeSchedule, ReminderPreferences, ReminderView, ReminderOverdueSummary } from '@shared'

type RowAction = 'edit' | 'complete' | 'snooze' | 'delete'
export function renderReminderRows(container: HTMLElement, items: ReminderView[], action: (action: RowAction, item: ReminderView) => void): void {
  container.replaceChildren()
  if (!items.length) { const empty = document.createElement('p'); empty.textContent = 'Nenhum lembrete nesta página.'; container.append(empty); return }
  for (const item of items) {
    const row = document.createElement('article'); row.className = 'reminder-row'
    const title = document.createElement('strong'); title.textContent = item.title
    const detail = document.createElement('p'); detail.textContent = item.description
    const date = document.createElement('small')
    date.textContent = `${item.schedule.localDateTime.replace('T', ' ')} · ${item.schedule.timeZone} · ${item.schedule.recurrence}${item.nextDueUtc ? ` · próximo: ${new Date(item.nextDueUtc).toLocaleString('pt-BR', { timeZone: item.schedule.timeZone })}` : ''}`
    const buttons = document.createElement('div'); buttons.className = 'reminders-toolbar'
    for (const [id, label] of [['edit', 'Editar'], ['complete', 'Concluir ocorrência'], ['snooze', 'Adiar 10min'], ['delete', 'Excluir']] as const) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'btn-toggle'; button.textContent = label
      button.disabled = id !== 'delete' && (item.state !== 'active' || (id !== 'edit' && !item.occurrenceKey))
      button.addEventListener('click', () => action(id, item)); buttons.append(button)
    }
    row.append(title, detail, date, buttons); container.append(row)
  }
}
let initialized = false
export function initializeRemindersSettings(): void {
  if (initialized || !document.getElementById('reminders-controls')) return
  initialized = true
  const api = window.electronAPI
  const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
  const input = (id: string) => element<HTMLInputElement>(id)
  const controls = element<HTMLFieldSetElement>('reminders-controls'), feedback = element('reminders-feedback'), list = element('reminders-list')
  const editor = element<HTMLFormElement>('reminders-editor')
  let items: ReminderView[] = [], next: string | null = null, editing: ReminderView | null = null, preferences: ReminderPreferences | null = null
  let previewToken: string | null = null, generation = 0, busy = false, available = false, overdueGeneration = 0
  let overdue: ReminderOverdueSummary | null = null
  const seen = new Set<string>()
  const reportText = (report: ImportReport) => `${report.created} criados, ${report.updated} atualizados, ${report.unchanged} sem alterações. ${report.conflicts.length} conflitos, ${report.rejected.length} rejeitados. ${[...report.conflicts, ...report.rejected].map(item => `${item.uid || 'Item'}: ${item.reason}`).join('; ')} ${report.warnings.join(' ')}`
  const failure = (error: unknown) => {
    const message = String(error)
    feedback.textContent = /unsupported_export/.test(message) ? 'Esta seleção possui recorrência, fuso ou exceções que não podem ser exportados sem perda. Nenhum arquivo foi gravado.'
      : /stale/.test(message) ? 'O lembrete mudou. Atualize a lista e tente novamente.'
      : /limit/.test(message) ? 'O calendário excede os limites: 2 MiB ou 1.000 componentes.'
      : 'Não foi possível concluir. Confira o módulo, a licença, as datas e o fuso; atualize a lista antes de tentar novamente.'
  }
  const run = async (work: () => Promise<void>) => {
    if (busy) return
    busy = true; controls.disabled = true
    try { await work() } catch (error) { failure(error) }
    finally { busy = false; controls.disabled = !available }
  }
  const renderOverdue = async (batch: ReminderOverdueSummary, acknowledge = true) => {
    if (!available) return
    const current = ++overdueGeneration, accessGeneration = generation
    const key = `${batch.batchId}:${batch.total}`
    if (acknowledge && seen.has(key)) return
    overdue = batch
    element('reminders-overdue-title').textContent = `${batch.total} ocorrência(s) atrasada(s)`
    const target = element('reminders-overdue-list'); target.replaceChildren()
    for (const occurrence of batch.preview) {
      const row = document.createElement('p')
      // Text only; deleted or unavailable items still retain their occurrence reference.
      try {
        const item = await api.getReminder(occurrence.reminderId)
        row.textContent = `${item?.title || 'Lembrete'} · ${occurrence.nominalLocalTime.replace('T', ' ')}${item ? ` · ${item.schedule.timeZone}` : ''}`
        if (item?.state === 'active' && ['missed', 'notified', 'pending'].includes(occurrence.state)) {
          const actions = document.createElement('span'); actions.className = 'reminders-toolbar'
          for (const [action, label] of [['complete', 'Concluir esta ocorrência'], ['snooze', 'Adiar esta ocorrência 10min']] as const) {
            const button = document.createElement('button'); button.type = 'button'; button.className = 'btn-toggle'; button.textContent = label
            button.addEventListener('click', () => { void run(async () => {
              await api.mutateReminder({ type: action, id: item.id, expectedRevision: item.revision, occurrenceKey: occurrence.key,
                ...(action === 'snooze' ? { untilUtc: new Date(Math.max(Date.now(), Date.parse(occurrence.snoozedUntilUtc || occurrence.dueUtc)) + 600_000).toISOString() } : {}) } as MutationRequest)
              actions.replaceChildren(document.createTextNode(action === 'complete' ? 'Ocorrência concluída.' : 'Ocorrência adiada.'))
              await refresh()
            }) })
            actions.append(button)
          }
          row.append(actions)
        }
      }
      catch { row.textContent = occurrence.nominalLocalTime.replace('T', ' ') }
      if (!available || current !== overdueGeneration || accessGeneration !== generation) return
      target.append(row)
    }
    element('reminders-overdue').hidden = false
    element('reminders-overdue-more').hidden = !batch.cursor
    if (acknowledge) requestAnimationFrame(() => {
      const summary = element('reminders-overdue'), rect = summary.getBoundingClientRect()
      const foreground = rect.width > 0 && rect.height > 0 && summary.contains(document.elementFromPoint(rect.left + Math.min(30, rect.width / 2), rect.top + Math.min(20, rect.height / 2)))
      if (foreground && !summary.hidden && overdue?.batchId === batch.batchId && overdue.total === batch.total) {
        seen.add(key); void api.acknowledgeOverdueReminders(batch.batchId, batch.total).then(accepted => { if (!accepted) seen.delete(key) }).catch(() => { seen.delete(key) })
      }
    })
  }
  async function refresh(cursor?: string): Promise<void> {
    const current = ++generation
    try {
      const modules = await api.listModules(), module = modules.find(item => item.id === 'reminders')
      if (current !== generation) return
      if (!module?.enabled || !module.authorized || module.lifecycle !== 'running') {
        available = false
        controls.disabled = true; list.replaceChildren(); editor.hidden = true; element('reminders-overdue').hidden = true
        feedback.textContent = 'Ative Lembretes nos módulos acima, com licença e consentimento válidos.'; return
      }
      const [page, prefs] = await Promise.all([api.listReminders({ limit: 100, state: element<HTMLSelectElement>('reminders-state').value as 'active' | 'completed', ...(cursor ? { cursor } : {}) }), api.reminderPreferences({ type: 'get' })])
      if (current !== generation) return
      items = page.items; next = page.nextCursor; preferences = prefs
      available = true
      renderReminderRows(list, items, (action, item) => {
        if (action === 'edit') { openEditor(item); return }
        void run(async () => {
          const request: MutationRequest = action === 'delete' ? { type: 'delete', items: [{ id: item.id, expectedRevision: item.revision }] }
            : action === 'complete' ? { type: 'complete', id: item.id, expectedRevision: item.revision, occurrenceKey: item.occurrenceKey! }
            : { type: 'snooze', id: item.id, expectedRevision: item.revision, occurrenceKey: item.occurrenceKey!, untilUtc: new Date(Math.max(Date.now(), Date.parse(item.nextDueUtc || '')) + 600_000).toISOString() }
          await api.mutateReminder(request); await refresh()
        })
      })
      input('reminders-pref-zone').value = prefs.timeZone; input('reminders-pref-time').value = prefs.allDayTime; input('reminders-pref-notifications').checked = prefs.notificationsEnabled
      element('reminders-next').hidden = !next
      element<HTMLButtonElement>('reminders-export').disabled = !items.length
      controls.disabled = busy
      feedback.textContent = 'Lembretes locais disponíveis. O Jasper precisa permanecer aberto para avisar.'
      const batch = await api.getOverdueReminders()
      if (batch && current === generation) void renderOverdue(batch)
    } catch (error) { if (current === generation) { available = false; controls.disabled = true; failure(error) } }
  }
  function openEditor(item: ReminderView | null): void {
    editing = item; editor.hidden = false
    input('reminder-title').value = item?.title || ''; input('reminder-description').value = item?.description || ''
    input('reminder-date').value = item?.schedule.localDateTime || ''; input('reminder-zone').value = item?.schedule.timeZone || preferences?.timeZone || 'UTC'
    element<HTMLSelectElement>('reminder-recurrence').value = item?.schedule.recurrence || 'none'; input('reminder-anchor').value = String(item?.schedule.anchorDay || 1)
    for (const id of ['reminder-date', 'reminder-zone', 'reminder-recurrence', 'reminder-anchor']) (element(id) as HTMLInputElement).disabled = item?.source === 'ical'
    element('reminder-edit-note').textContent = item?.source === 'ical' ? 'A agenda importada é preservada. Aqui você pode editar título e descrição; reimportação conflitante manterá sua edição local.' : 'Use o horário no fuso informado. Dia 31 avisa no último dia dos meses curtos. Lacunas de horário são ajustadas para o primeiro instante válido.'
    input('reminder-title').focus()
  }
  editor.addEventListener('submit', event => {
    event.preventDefault()
    void run(async () => {
      const title = input('reminder-title').value.trim(), description = input('reminder-description').value
      const date = input('reminder-date').value
      const schedule: NativeSchedule = { policy: 'jasper', localDateTime: date.length === 16 ? date + ':00' : date, timeZone: input('reminder-zone').value.trim(), recurrence: element<HTMLSelectElement>('reminder-recurrence').value as NativeSchedule['recurrence'], anchorDay: Number(input('reminder-anchor').value) }
      await api.mutateReminder(editing ? { type: 'update', id: editing.id, expectedRevision: editing.revision, patch: { title, description, ...(editing.source === 'ical' ? {} : { schedule }) } } : { type: 'create', title, description, schedule })
      editor.hidden = true; editing = null; await refresh()
    })
  })
  input('reminder-date').addEventListener('change', () => { if (!editing) input('reminder-anchor').value = String(Number(input('reminder-date').value.slice(8, 10)) || 1) })
  element('reminders-new').addEventListener('click', () => openEditor(null))
  element('reminders-cancel-edit').addEventListener('click', () => { editor.hidden = true; editing = null })
  element('reminders-refresh').addEventListener('click', () => { void refresh() })
  element('reminders-state').addEventListener('change', () => { void refresh() })
  element('reminders-next').addEventListener('click', () => { if (next) void refresh(next) })
  element('reminders-save-preferences').addEventListener('click', () => { void run(async () => {
    if (!preferences) return
    await api.reminderPreferences({ type: 'update', expectedRevision: preferences.revision, patch: { timeZone: input('reminders-pref-zone').value.trim(), allDayTime: input('reminders-pref-time').value, notificationsEnabled: input('reminders-pref-notifications').checked } }); await refresh()
  }) })
  element('reminders-import').addEventListener('click', () => { void run(async () => {
    const result = await api.importReminders({ type: 'preview' })
    if (result.status === 'preview') { previewToken = result.token!; element('reminders-import-preview').hidden = false; element('reminders-import-report').textContent = `${result.count} itens válidos. ${reportText(result.report)}` }
  }) })
  element('reminders-import-apply').addEventListener('click', () => { void run(async () => {
    if (!previewToken) return
    const result = await api.importReminders({ type: 'apply', token: previewToken }); previewToken = null; element('reminders-import-preview').hidden = true
    await refresh(); feedback.textContent = reportText(result.report)
  }) })
  element('reminders-import-cancel').addEventListener('click', () => { void run(async () => { await api.importReminders({ type: 'cancel' }); previewToken = null; element('reminders-import-preview').hidden = true }) })
  element('reminders-export').addEventListener('click', () => { void run(async () => { const saved = await api.exportReminders({ items: items.map(item => ({ id: item.id, expectedRevision: item.revision })) }); feedback.textContent = saved ? 'Calendário exportado.' : 'Exportação cancelada.' }) })
  element('reminders-overdue-dismiss').addEventListener('click', () => { element('reminders-overdue').hidden = true })
  element('reminders-overdue-more').addEventListener('click', () => { if (overdue?.cursor) void api.getOverdueReminders(overdue.cursor, overdue.batchId).then(batch => { if (batch) return renderOverdue(batch, false) }).catch(failure) })
  const unsubscribers = [api.onRemindersChanged(() => { void refresh() }), api.onOverdueReminders(batch => { void renderOverdue(batch) }), api.onLicenseState(snapshot => {
    if (snapshot.state !== 'unlocked') { available = false; ++generation; controls.disabled = true; list.replaceChildren(); editor.hidden = true; editor.reset(); element('reminders-overdue').hidden = true; seen.clear() }
    else void refresh()
  })]
  window.addEventListener('beforeunload', () => unsubscribers.forEach(unsubscribe => unsubscribe()), { once: true })
  window.addEventListener('jasper-modules-changed', () => { void refresh() })
  element('btn-settings')?.addEventListener('click', () => { void refresh() })
  void refresh()
}
