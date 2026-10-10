import type { Database } from 'better-sqlite3'
import { AppError } from '../db/errors'
import { formatLocalSqlite } from './cf'

/**
 * 数据导出/导入（docs/01 FR-7.2/7.3，docs/03 §1）。
 *
 * 安全设计（FR-7 定向审查修复）：
 * - 导入前完整校验：表键必须齐全且为数组、列名走 PRAGMA 白名单（防标识符注入）、
 *   必填列（NOT NULL 且无默认值）必须存在、tags 名称唯一、settings 行类型校验；
 *   校验失败在任何 DELETE 之前抛错，不会清空任何数据。
 * - foreign_keys 切换放在事务外（事务内为 no-op），并恢复原值。
 * - 导出在只读事务内快照，保证表间一致性。
 */

export const EXPORT_VERSION = 1

/** 导入文件内容上限由 ipc 层限制（此处为行数软上限防御） */
const MAX_ROWS_PER_TABLE = 2_000_000

const TABLES = [
  'problems',
  'tags',
  'problem_tags',
  'practice_records',
  'notes',
  'templates',
  'contests',
  'contest_problems',
  'contest_submissions',
  'rating_history',
  // v1.10：题单 / 训练计划（按外键依赖顺序：主表在子表之前）
  'problem_lists',
  'problem_list_items',
  'training_plans',
  'plan_tasks',
  'plan_busy_days'
] as const

export type ExportTable = (typeof TABLES)[number]

export interface ExportPayload {
  version: number
  exportedAt: string
  [key: string]: unknown
}

export interface ImportCount {
  table: string
  count: number
}

/** SQL 标识符白名单（列名来自 PRAGMA table_info，均符合此正则） */
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

interface ColumnInfo {
  name: string
  notnull: number
  dflt_value: string | null
  pk: number
}

export function exportData(db: Database): ExportPayload {
  const payload: ExportPayload = {
    version: EXPORT_VERSION,
    exportedAt: formatLocalSqlite(new Date())
  }
  // 只读事务内快照，避免与自动保存等并发写交叉（表间状态一致）
  db.transaction(() => {
    for (const t of TABLES) {
      payload[t] = db.prepare(`SELECT * FROM ${t}`).all()
    }
    payload.settings = db.prepare('SELECT key, value FROM settings').all()
  })()
  return payload
}

function getColumnWhitelist(db: Database, table: string): ColumnInfo[] {
  return db.pragma(`table_info(${table})`) as unknown as ColumnInfo[]
}

/**
 * 导入前完整校验。任何不满足都会抛 AppError，
 * 此时尚未执行任何 DELETE/INSERT。
 */
function validatePayload(db: Database, payload: unknown): asserts payload is ExportPayload {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new AppError('VALIDATION', '备份文件格式不正确')
  }
  const p = payload as ExportPayload
  if (p.version !== EXPORT_VERSION) {
    throw new AppError('VALIDATION', `不支持的备份版本: ${String(p.version)}`)
  }

  for (const t of TABLES) {
    const rows = p[t]
    if (!Array.isArray(rows)) {
      throw new AppError('VALIDATION', `备份缺少数据表: ${t}（导入已中止，未修改任何数据）`)
    }
    if (rows.length > MAX_ROWS_PER_TABLE) {
      throw new AppError('VALIDATION', `备份中 ${t} 表行数异常（${rows.length} 行）`)
    }

    const cols = getColumnWhitelist(db, t)
    const allowed = new Set(cols.map((c) => c.name))
    const required = cols
      .filter((c) => c.notnull === 1 && c.dflt_value === null)
      .map((c) => c.name)

    for (const row of rows) {
      if (row === null || typeof row !== 'object' || Array.isArray(row)) {
        throw new AppError('VALIDATION', `备份中 ${t} 表存在非法行（导入已中止）`)
      }
      const keys = Object.keys(row)
      for (const k of keys) {
        if (!IDENT_RE.test(k) || !allowed.has(k)) {
          throw new AppError('VALIDATION', `备份中 ${t} 表包含未知列: ${k}（导入已中止）`)
        }
      }
      for (const r of required) {
        if (!(r in row)) {
          throw new AppError('VALIDATION', `备份中 ${t} 表缺少必填列: ${r}（可能是旧版本备份，导入已中止）`)
        }
      }
    }

    // tags 名称唯一性预检（避免 UNIQUE 冲突导致整库回滚且报错不友好）
    if (t === 'tags') {
      const seen = new Set<string>()
      for (const row of rows as Record<string, unknown>[]) {
        const name = row.name
        if (typeof name !== 'string' || name.length === 0) {
          throw new AppError('VALIDATION', '备份中 tags 表存在非法名称（导入已中止）')
        }
        if (seen.has(name)) {
          throw new AppError('VALIDATION', `备份中标签名重复: ${name}（导入已中止）`)
        }
        seen.add(name)
      }
    }
  }

  const settings = p.settings
  if (!Array.isArray(settings)) {
    throw new AppError('VALIDATION', '备份缺少 settings 数据（导入已中止）')
  }
  for (const s of settings) {
    if (
      s === null ||
      typeof s !== 'object' ||
      typeof (s as { key?: unknown }).key !== 'string' ||
      typeof (s as { value?: unknown }).value !== 'string'
    ) {
      throw new AppError('VALIDATION', '备份中 settings 表存在非法行（导入已中止）')
    }
  }
}

export function importData(db: Database, payload: unknown): ImportCount[] {
  validatePayload(db, payload)

  // FK 开关必须在事务外切换（事务内为 no-op），并恢复原值
  const prevFk = db.pragma('foreign_keys', { simple: true }) as number
  let result: ImportCount[]
  try {
    db.pragma('foreign_keys = OFF')
    result = db.transaction((): ImportCount[] => {
      // 清空（逆序，配合 FK OFF 任意顺序均安全）
      for (const t of [...TABLES].reverse()) {
        db.prepare(`DELETE FROM ${t}`).run()
      }
      db.prepare('DELETE FROM settings').run()

      const counts: ImportCount[] = []
      for (const t of TABLES) {
        const rows = payload[t] as Record<string, unknown>[]
        counts.push({ table: t, count: rows.length })
        if (rows.length === 0) continue
        // 列名已经过白名单校验且均为合法标识符
        const cols = Object.keys(rows[0])
        const quoted = cols.map((c) => `"${c}"`).join(', ')
        const placeholders = cols.map(() => '?').join(', ')
        const insert = db.prepare(`INSERT INTO ${t} (${quoted}) VALUES (${placeholders})`)
        for (const row of rows) {
          insert.run(...cols.map((c) => row[c] ?? null))
        }
      }

      // settings 全量替换（与"覆盖全部本地数据"语义一致）
      const settings = payload.settings as { key: string; value: string }[]
      const setStmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
      for (const s of settings) {
        setStmt.run(s.key, s.value)
      }
      return counts
    })()
  } catch (err) {
    if (err instanceof AppError) throw err
    throw new AppError(
      'DB_ERROR',
      `导入失败（数据已回滚）: ${err instanceof Error ? err.message : String(err)}`
    )
  } finally {
    db.pragma(`foreign_keys = ${prevFk ? 'ON' : 'OFF'}`)
  }
  return result
}
