import type { Database } from 'better-sqlite3'
import {
  RESULT_STATUSES,
  type DifficultyStatsResult,
  type PracticeRecord,
  type ResultStatus,
  type StatsResult
} from '@shared/types'
import type { DifficultyRawRow } from '../../services/difficulty-stats'
import { buildDifficultyStats } from '../../services/difficulty-stats'
import { AppError } from '../errors'

interface RecordRow {
  id: number
  problemId: string
  status: ResultStatus
  durationSeconds: number | null
  note: string | null
  isMistake: number
  importSource: string | null
  createdAt: string
}

function mapRow(r: RecordRow): PracticeRecord {
  return {
    id: r.id,
    problemId: r.problemId,
    status: r.status,
    durationSeconds: r.durationSeconds,
    note: r.note,
    isMistake: r.isMistake === 1,
    importSource: r.importSource,
    createdAt: r.createdAt
  }
}

const ROW_SELECT = `
  SELECT id, problem_id AS problemId, status,
         duration_seconds AS durationSeconds, note,
         is_mistake AS isMistake, import_source AS importSource,
         created_at AS createdAt
  FROM practice_records
`

export interface CreateRecordInput {
  problemId: string
  status: ResultStatus
  durationSeconds?: number | null
  note?: string | null
  isMistake?: boolean
  /** v1.2 FR-8.9：导入来源标记（如 'luogu-import'），用于幂等去重 */
  importSource?: string | null
}

export class RecordsRepo {
  constructor(private db: Database) {}

  create(input: CreateRecordInput): PracticeRecord {
    if (!RESULT_STATUSES.includes(input.status)) {
      throw new AppError('VALIDATION', `非法状态: ${input.status}`)
    }
    const info = this.db
      .prepare(
        `INSERT INTO practice_records (problem_id, status, duration_seconds, note, is_mistake, import_source)
         VALUES (@problemId, @status, @durationSeconds, @note, @isMistake, @importSource)`
      )
      .run({
        problemId: input.problemId,
        status: input.status,
        durationSeconds: input.durationSeconds ?? null,
        note: input.note ?? null,
        isMistake: input.isMistake ? 1 : 0,
        importSource: input.importSource ?? null
      })
    const row = this.db
      .prepare(`${ROW_SELECT} WHERE id = ?`)
      .get(info.lastInsertRowid) as RecordRow
    return mapRow(row)
  }

  /** 该题是否已有指定来源的导入记录（幂等去重，FR-8.9.3） */
  hasImport(problemId: string, source: string): boolean {
    const row = this.db
      .prepare('SELECT 1 AS x FROM practice_records WHERE problem_id = ? AND import_source = ? LIMIT 1')
      .get(problemId, source)
    return row !== undefined
  }

  getById(id: number): PracticeRecord | null {
    const row = this.db.prepare(`${ROW_SELECT} WHERE id = ?`).get(id) as RecordRow | undefined
    return row ? mapRow(row) : null
  }

  list(opts: {
    problemId?: string
    mistakeOnly?: boolean
    page?: number
    pageSize?: number
  }): {
    total: number
    items: PracticeRecord[]
  } {
    const page = Math.max(1, Math.floor(opts.page ?? 1))
    const pageSize = Math.min(200, Math.max(1, Math.floor(opts.pageSize ?? 50)))
    const conditions: string[] = []
    const params: unknown[] = []
    if (opts.problemId) {
      conditions.push('problem_id = ?')
      params.push(opts.problemId)
    }
    if (opts.mistakeOnly) {
      conditions.push('is_mistake = 1')
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const total = (
      this.db.prepare(`SELECT COUNT(*) AS c FROM practice_records ${where}`).get(...params) as {
        c: number
      }
    ).c
    const rows = this.db
      .prepare(
        `${ROW_SELECT} ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`
      )
      .all(...params, pageSize, (page - 1) * pageSize) as RecordRow[]
    return { total, items: rows.map(mapRow) }
  }

  update(
    id: number,
    fields: { status?: ResultStatus; note?: string | null; isMistake?: boolean }
  ): PracticeRecord {
    const sets: string[] = []
    const params: Record<string, unknown> = { id }
    if (fields.status !== undefined) {
      if (!RESULT_STATUSES.includes(fields.status)) {
        throw new AppError('VALIDATION', `非法状态: ${fields.status}`)
      }
      sets.push('status = @status')
      params.status = fields.status
    }
    if (fields.note !== undefined) {
      sets.push('note = @note')
      params.note = fields.note
    }
    if (fields.isMistake !== undefined) {
      sets.push('is_mistake = @isMistake')
      params.isMistake = fields.isMistake ? 1 : 0
    }
    if (sets.length === 0) {
      const existing = this.getById(id)
      if (!existing) throw new AppError('NOT_FOUND', '记录不存在')
      return existing
    }
    const info = this.db
      .prepare(`UPDATE practice_records SET ${sets.join(', ')} WHERE id = @id`)
      .run(params)
    if (info.changes === 0) throw new AppError('NOT_FOUND', '记录不存在')
    const updated = this.getById(id)
    if (!updated) throw new AppError('NOT_FOUND', '记录不存在')
    return updated
  }

  delete(id: number): void {
    const info = this.db.prepare('DELETE FROM practice_records WHERE id = ?').run(id)
    if (info.changes === 0) throw new AppError('NOT_FOUND', '记录不存在')
  }

  /** 某题最近一次练习状态 */
  latestStatus(problemId: string): ResultStatus | null {
    const row = this.db
      .prepare(
        `SELECT status FROM practice_records WHERE problem_id = ?
         ORDER BY created_at DESC, id DESC LIMIT 1`
      )
      .get(problemId) as { status: ResultStatus } | undefined
    return row?.status ?? null
  }

  /**
   * 按题目难度标签统计（v1.9 FR-22）。
   * attempted = 有练习记录的题目数（去重）；ac = 其中曾 AC 的题目数；
   * CF 按 rating 200 一档分段（<800 / 800–999 … / 3000+），洛谷 0–7，力扣 1–3。
   */
  difficultyStats(): DifficultyStatsResult {
    const rows = this.db
      .prepare(
        `SELECT p.source AS source,
                CASE
                  WHEN p.source = 'cf' THEN
                    CASE
                      WHEN p.rating IS NULL THEN 'na'
                      WHEN p.rating < 800 THEN 'lt800'
                      WHEN p.rating >= 3000 THEN 'ge3000'
                      ELSE CAST(p.rating / 200 * 200 AS TEXT)
                    END
                  WHEN p.source IN ('luogu','leetcode') THEN
                    CASE WHEN p.difficulty IS NULL THEN 'na' ELSE 'd' || p.difficulty END
                  ELSE 'na'
                END AS bucket,
                COUNT(DISTINCT p.id) AS attempted,
                COUNT(DISTINCT CASE WHEN r.status = 'AC' THEN p.id END) AS ac
         FROM practice_records r
         JOIN problems p ON p.id = r.problem_id
         GROUP BY p.source, bucket`
      )
      .all() as DifficultyRawRow[]
    return buildDifficultyStats(rows)
  }

  /** 统计（docs/03-详细设计 §3.2 records:stats） */
  stats(days = 30): StatsResult {
    const base = this.db.prepare(`
      SELECT
        COUNT(*) AS totalAttempts,
        SUM(CASE WHEN status = 'AC' THEN 1 ELSE 0 END) AS acCount,
        COUNT(DISTINCT problem_id) AS distinctProblems,
        SUM(CASE WHEN duration_seconds IS NOT NULL THEN duration_seconds ELSE 0 END) AS practiceSeconds
      FROM practice_records
    `).get() as {
      totalAttempts: number
      acCount: number
      distinctProblems: number
      practiceSeconds: number
    }

    const daily = this.db
      .prepare(
        `SELECT substr(created_at, 1, 10) AS date,
                COUNT(*) AS count,
                SUM(CASE WHEN status = 'AC' THEN 1 ELSE 0 END) AS acCount
         FROM practice_records
         WHERE created_at >= datetime('now', 'localtime', ?)
         GROUP BY substr(created_at, 1, 10)
         ORDER BY date`
      )
      .all(`-${days} days`) as { date: string; count: number; acCount: number }[]

    const weekly = this.db
      .prepare(
        `SELECT strftime('%Y-W%W', created_at) AS week,
                COUNT(*) AS count,
                SUM(CASE WHEN status = 'AC' THEN 1 ELSE 0 END) AS acCount
         FROM practice_records
         WHERE created_at >= datetime('now', 'localtime', '-84 days')
         GROUP BY strftime('%Y-W%W', created_at)
         ORDER BY week`
      )
      .all() as { week: string; count: number; acCount: number }[]

    const tagStats = this.db
      .prepare(
        `SELECT t.name AS tag,
                COUNT(*) AS count,
                SUM(CASE WHEN r.status = 'AC' THEN 1 ELSE 0 END) AS acCount
         FROM practice_records r
         JOIN problem_tags pt ON pt.problem_id = r.problem_id
         JOIN tags t ON t.id = pt.tag_id
         WHERE r.created_at >= datetime('now', 'localtime', '-90 days')
         GROUP BY t.name
         ORDER BY count DESC
         LIMIT 30`
      )
      .all() as { tag: string; count: number; acCount: number }[]

    const accuracy =
      base.totalAttempts > 0 ? Number(((base.acCount / base.totalAttempts) * 100).toFixed(1)) : null

    return {
      totalAttempts: base.totalAttempts,
      acCount: base.acCount,
      accuracy,
      distinctProblems: base.distinctProblems,
      practiceSeconds: base.practiceSeconds,
      daily,
      weekly,
      tagStats
    }
  }
}
