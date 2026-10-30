import fs from 'node:fs'
import { StateDatabase } from '../../../src/main/storage/state-database'
import { emailMigrations } from '../email/database'
export function webDatabase(filename = ':memory:') {
  const sql = [...emailMigrations(), fs.readFileSync('src/main/storage/migrations/009-web-research.sql', 'utf8')]
  return new StateDatabase(filename, sql[0], sql.slice(1))
}
