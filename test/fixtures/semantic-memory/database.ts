import fs from 'node:fs'
import { StateDatabase } from '../../../src/main/storage/state-database'
import { emailMigrations } from '../email/database'
export function semanticMigrations() {
  return [...emailMigrations(), ...['009-web-research.sql', '010-semantic-memory.sql'].map(file => fs.readFileSync(`src/main/storage/migrations/${file}`, 'utf8'))]
}
export function semanticDatabase(filename = ':memory:') {
  const sql = semanticMigrations()
  return new StateDatabase(filename, sql[0], sql.slice(1))
}
