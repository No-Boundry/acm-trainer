import type { Database } from 'better-sqlite3'

export class SettingsRepo {
  constructor(private db: Database) {}

  get(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    return row?.value ?? null
  }

  set(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(key, value)
  }

  getAll(): Record<string, string> {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as {
      key: string
      value: string
    }[]
    const out: Record<string, string> = {}
    for (const r of rows) out[r.key] = r.value
    return out
  }
}

/** 内置设置项默认值（v1.4：权值/映射/资料初始值维持现状） */
export const SETTING_DEFAULTS: Record<string, string> = {
  syncReminderEnabled: 'true',
  defaultContestMinutes: '120',
  noteAutoSaveMs: '2000',
  editorIndent: 'tab',
  userName: '',
  avatarFile: '',
  ratingWeights: '{"practice":0.7,"contest":0.3}',
  luoguDiffRatings: '{"1":900,"2":1100,"3":1300,"4":1500,"5":1750,"6":2050,"7":2300}'
}
