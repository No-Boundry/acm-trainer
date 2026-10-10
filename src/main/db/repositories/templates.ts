import type { Database } from 'better-sqlite3'
import type { Template } from '@shared/types'
import { AppError } from '../errors'

interface TemplateRow {
  id: number
  category: string
  title: string
  language: string
  description: string
  code: string
  createdAt: string
  updatedAt: string
}

/**
 * 列名必须显式取别名（snake_case → camelCase）：
 * 此前用 `SELECT *` 后读 r.createdAt / r.updatedAt，实际列是 created_at / updated_at，
 * 导致返回值里两个时间字段恒为 undefined（与 v1.8.4 水平评估页空白同源缺陷）。
 */
const ROW_SELECT = `SELECT id, category, title, language, description, code,
         created_at AS createdAt, updated_at AS updatedAt FROM templates`

function mapRow(r: TemplateRow): Template {
  return {
    id: r.id,
    category: r.category,
    title: r.title,
    language: r.language,
    description: r.description,
    code: r.code,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt
  }
}

export interface CreateTemplateInput {
  category: string
  title: string
  language?: string
  description?: string
  code?: string
}

export class TemplatesRepo {
  constructor(private db: Database) {}

  create(input: CreateTemplateInput): Template {
    const info = this.db
      .prepare(
        `INSERT INTO templates (category, title, language, description, code)
         VALUES (@category, @title, @language, @description, @code)`
      )
      .run({
        category: input.category,
        title: input.title,
        language: input.language ?? 'C++',
        description: input.description ?? '',
        code: input.code ?? ''
      })
    const row = this.db
      .prepare(`${ROW_SELECT} WHERE id = ?`)
      .get(info.lastInsertRowid) as TemplateRow
    return mapRow(row)
  }

  getById(id: number): Template | null {
    const row = this.db.prepare(`${ROW_SELECT} WHERE id = ?`).get(id) as TemplateRow | undefined
    return row ? mapRow(row) : null
  }

  list(opts: { keyword?: string; category?: string }): Template[] {
    const conditions: string[] = []
    const params: unknown[] = []
    if (opts.keyword) {
      conditions.push('(title LIKE ? OR description LIKE ? OR code LIKE ?)')
      const kw = `%${opts.keyword}%`
      params.push(kw, kw, kw)
    }
    if (opts.category) {
      conditions.push('category = ?')
      params.push(opts.category)
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const rows = this.db
      .prepare(`${ROW_SELECT} ${where} ORDER BY category, title`)
      .all(...params) as TemplateRow[]
    return rows.map(mapRow)
  }

  categories(): string[] {
    const rows = this.db
      .prepare('SELECT DISTINCT category FROM templates ORDER BY category')
      .all() as { category: string }[]
    return rows.map((r) => r.category)
  }

  update(id: number, fields: Partial<CreateTemplateInput>): Template {
    const sets: string[] = []
    const params: Record<string, unknown> = { id }
    const map: Record<string, string> = {
      category: 'category',
      title: 'title',
      language: 'language',
      description: 'description',
      code: 'code'
    }
    for (const [key, col] of Object.entries(map)) {
      const val = fields[key as keyof CreateTemplateInput]
      if (val !== undefined) {
        sets.push(`${col} = @${col}`)
        params[col] = val
      }
    }
    if (sets.length === 0) {
      const existing = this.getById(id)
      if (!existing) throw new AppError('NOT_FOUND', '模板不存在')
      return existing
    }
    sets.push("updated_at = datetime('now','localtime')")
    const info = this.db
      .prepare(`UPDATE templates SET ${sets.join(', ')} WHERE id = @id`)
      .run(params)
    if (info.changes === 0) throw new AppError('NOT_FOUND', '模板不存在')
    const updated = this.getById(id)
    if (!updated) throw new AppError('NOT_FOUND', '模板不存在')
    return updated
  }

  delete(id: number): void {
    const info = this.db.prepare('DELETE FROM templates WHERE id = ?').run(id)
    if (info.changes === 0) throw new AppError('NOT_FOUND', '模板不存在')
  }
}
