import type { Database } from 'better-sqlite3'
import type { Note } from '@shared/types'
import { AppError } from '../errors'

interface NoteRow {
  id: number
  problemId: string | null
  title: string
  content: string
  tags: string
  createdAt: string
  updatedAt: string
}

function mapRow(r: NoteRow): Note {
  return {
    id: r.id,
    problemId: r.problemId,
    title: r.title,
    content: r.content,
    tags: r.tags ? r.tags.split(',').filter(Boolean) : [],
    createdAt: r.createdAt,
    updatedAt: r.updatedAt
  }
}

const ROW_SELECT = `
  SELECT id, problem_id AS problemId, title, content, tags,
         created_at AS createdAt, updated_at AS updatedAt
  FROM notes
`

export interface CreateNoteInput {
  title: string
  content: string
  problemId?: string | null
  tags?: string[]
}

export class NotesRepo {
  constructor(private db: Database) {}

  create(input: CreateNoteInput): Note {
    const info = this.db
      .prepare(
        `INSERT INTO notes (problem_id, title, content, tags)
         VALUES (@problemId, @title, @content, @tags)`
      )
      .run({
        problemId: input.problemId ?? null,
        title: input.title,
        content: input.content,
        tags: (input.tags ?? []).join(',')
      })
    const row = this.db
      .prepare(`${ROW_SELECT} WHERE id = ?`)
      .get(info.lastInsertRowid) as NoteRow
    return mapRow(row)
  }

  getById(id: number): Note | null {
    const row = this.db.prepare(`${ROW_SELECT} WHERE id = ?`).get(id) as NoteRow | undefined
    return row ? mapRow(row) : null
  }

  list(opts: { keyword?: string; problemId?: string | null }): Note[] {
    const conditions: string[] = []
    const params: unknown[] = []
    if (opts.keyword) {
      conditions.push('(title LIKE ? OR content LIKE ? OR tags LIKE ?)')
      const kw = `%${opts.keyword}%`
      params.push(kw, kw, kw)
    }
    if (opts.problemId !== undefined && opts.problemId !== null) {
      conditions.push('problem_id = ?')
      params.push(opts.problemId)
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const rows = this.db
      .prepare(`${ROW_SELECT} ${where} ORDER BY updated_at DESC, id DESC`)
      .all(...params) as NoteRow[]
    return rows.map(mapRow)
  }

  update(id: number, fields: Partial<CreateNoteInput>): Note {
    const sets: string[] = []
    const params: Record<string, unknown> = { id }
    if (fields.title !== undefined) {
      sets.push('title = @title')
      params.title = fields.title
    }
    if (fields.content !== undefined) {
      sets.push('content = @content')
      params.content = fields.content
    }
    if (fields.tags !== undefined) {
      sets.push('tags = @tags')
      params.tags = fields.tags.join(',')
    }
    if (fields.problemId !== undefined) {
      sets.push('problem_id = @problemId')
      params.problemId = fields.problemId
    }
    if (sets.length === 0) {
      const existing = this.getById(id)
      if (!existing) throw new AppError('NOT_FOUND', '笔记不存在')
      return existing
    }
    sets.push("updated_at = datetime('now','localtime')")
    const info = this.db
      .prepare(`UPDATE notes SET ${sets.join(', ')} WHERE id = @id`)
      .run(params)
    if (info.changes === 0) throw new AppError('NOT_FOUND', '笔记不存在')
    const updated = this.getById(id)
    if (!updated) throw new AppError('NOT_FOUND', '笔记不存在')
    return updated
  }

  delete(id: number): void {
    const info = this.db.prepare('DELETE FROM notes WHERE id = ?').run(id)
    if (info.changes === 0) throw new AppError('NOT_FOUND', '笔记不存在')
  }
}
