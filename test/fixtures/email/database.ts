import fs from 'node:fs'
import { StateDatabase } from '../../../src/main/storage/state-database'
export const emailMigrations = () => ['001-module-state.sql', '002-capability-invocations.sql', '003-tasks.sql', '004-task-evidence.sql', '005-reminders.sql', '006-reminder-imports.sql', '007-pc-health.sql', '008-email.sql'].map(name => fs.readFileSync(`src/main/storage/migrations/${name}`, 'utf8'))
export function emailDatabase(filename = ':memory:', version = 8) {
  const sql = emailMigrations().slice(0, version)
  return new StateDatabase(filename, sql[0], sql.slice(1))
}
