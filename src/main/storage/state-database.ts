import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'

export interface StateStatement {
  run(...params: SQLInputValue[]): void
  get(...params: SQLInputValue[]): Record<string, unknown> | undefined
  all(...params: SQLInputValue[]): Record<string, unknown>[]
}
export interface StateTransaction { exec(sql: string): void; prepare(sql: string): StateStatement }

/** Main-only SQLite connection; callbacks are synchronous and handles expire at commit/rollback. */
export class StateDatabase {
  private readonly database: DatabaseSync
  private inTransaction = false
  private closed = false

  constructor(filename: string, migrationSql: string, additionalMigrations: readonly string[] = []) {
    this.database = new DatabaseSync(filename)
    try {
      this.database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 1000;')
      const version = Number(this.database.prepare('PRAGMA user_version').get()!.user_version)
      const migrations = [migrationSql, ...additionalMigrations]
      if (version < 0 || version > migrations.length) throw new Error('unsupported_database_version')
      if (version === 0) {
        if (this.database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get()) throw new Error('unrecognized_database')
        if (fs.existsSync(filename) && fs.statSync(filename).size > 0) fs.copyFileSync(filename, `${filename}.pre-v1.bak`, fs.constants.COPYFILE_EXCL)
      }
      for (let nextVersion = version + 1; nextVersion <= migrations.length; nextVersion++) {
        if (nextVersion > 1 && filename !== ':memory:') {
          // SQLite's snapshot includes committed WAL data, unlike a plain file copy.
          this.database.prepare('VACUUM INTO ?').run(`${filename}.pre-v${nextVersion}.${randomUUID()}.bak`)
        }
        this.database.exec('BEGIN IMMEDIATE')
        try { this.database.exec(migrations[nextVersion - 1]); this.database.exec(`PRAGMA user_version = ${nextVersion}; COMMIT;`) }
        catch (error) { this.database.exec('ROLLBACK'); throw error }
      }
      this.database.exec('PRAGMA journal_mode = WAL;')
    } catch (error) { this.database.close(); throw error }
  }

  public transaction<T>(action: (tx: StateTransaction) => T): T {
    if (this.closed || this.inTransaction) throw new Error('invalid_transaction_state')
    if (action.constructor.name === 'AsyncFunction') throw new Error('async_transaction_forbidden')
    this.inTransaction = true
    let active = true
    const check = (): void => { if (!active) throw new Error('expired_transaction') }
    const tx: StateTransaction = {
      exec: sql => { check(); this.database.exec(sql) },
      prepare: sql => {
        check()
        const statement = this.database.prepare(sql)
        return {
          run: (...params) => { check(); statement.run(...params) },
          get: (...params) => { check(); return statement.get(...params) },
          all: (...params) => { check(); return statement.all(...params) }
        }
      }
    }
    try {
      this.database.exec('BEGIN IMMEDIATE')
      try {
        const result = action(tx)
        if (result && typeof (result as { then?: unknown }).then === 'function') throw new Error('async_transaction_forbidden')
        this.database.exec('COMMIT')
        return result
      } catch (error) { this.database.exec('ROLLBACK'); throw error }
    } finally { active = false; this.inTransaction = false }
  }

  public close(): void {
    if (this.inTransaction) throw new Error('transaction_in_progress')
    if (!this.closed) { this.database.close(); this.closed = true }
  }
}
