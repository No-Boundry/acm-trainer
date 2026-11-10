import type { Database } from 'better-sqlite3'
import type { ProblemSource, ProblemView } from '@shared/types'

interface ViewRow {
  problemId: string
  name: string
  source: ProblemSource
  rating: number | null
  lastOpenedAt: string
  firstOpenedAt: string
  openCount: number
}

/**
 * 刷题记录（v1.19 FR-40）。
 *
 * 每次在应用内打开题面（`statement:open`）写一条事件行，首页按题目聚合成
 * 「最近打开过的题」列表：最近打开时间倒序 + 累计次数 + 首次打开时间。
 * 只记「打开」这一事实，不影响练习记录（practice_records）与掌握度统计。
 */
export class ViewsRepo {
  constructor(private db: Database) {}

  /** 记录一次打开（题目不存在时静默忽略，避免题面打开被脏 id 打断） */
  record(problemId: string, at?: string): void {
    const exists = this.db.prepare('SELECT 1 FROM problems WHERE id = ?').get(problemId)
    if (!exists) return
    this.db
      .prepare(
        `INSERT INTO problem_views (problem_id, opened_at)
         VALUES (@problemId, COALESCE(@at, datetime('now','localtime')))`
      )
      .run({ problemId, at: at ?? null })
  }

  /** 最近的打开记录（按题目聚合，最近打开的排前面） */
  recent(limit = 12): ProblemView[] {
    // 非法/非正数回退默认 12，上限 100（首页只要十来条）
    const raw = Math.floor(Number(limit))
    const n = Number.isFinite(raw) && raw > 0 ? Math.min(100, raw) : 12
    const rows = this.db
      .prepare(
        `SELECT v.problem_id AS problemId,
                p.name AS name,
                p.source AS source,
                COALESCE(p.rating, p.difficulty) AS rating,
                MAX(v.opened_at) AS lastOpenedAt,
                MIN(v.opened_at) AS firstOpenedAt,
                COUNT(*)        AS openCount
         FROM problem_views v
         JOIN problems p ON p.id = v.problem_id
         GROUP BY v.problem_id
         ORDER BY lastOpenedAt DESC, v.problem_id ASC
         LIMIT @n`
      )
      .all({ n }) as ViewRow[]
    return rows.map((r) => ({
      problemId: r.problemId,
      name: r.name,
      source: r.source,
      rating: r.rating ?? null,
      lastOpenedAt: r.lastOpenedAt,
      firstOpenedAt: r.firstOpenedAt,
      openCount: r.openCount
    }))
  }

  /** 事件总数（用于测试与「共 N 次」计数） */
  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS c FROM problem_views').get() as { c: number }
    return row.c
  }

  /** 清空记录（设置页/测试用） */
  clear(): void {
    this.db.prepare('DELETE FROM problem_views').run()
  }
}
