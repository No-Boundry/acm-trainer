import type { Database } from 'better-sqlite3'
import type { RatingSnapshot } from '@shared/types'

/**
 * 行 → 快照：DB 列为 snake_case（created_at），必须显式取别名，
 * 否则 createdAt 为 undefined —— 水平评估页趋势图会调 createdAt.slice() 抛错导致整页空白（v1.8.4 修复）。
 */
const ROW_SELECT = `SELECT id, rating, source, detail, created_at AS createdAt FROM rating_history`

export class RatingRepo {
  constructor(private db: Database) {}

  /** 写入一条评分快照 */
  insert(rating: number, source: 'practice' | 'contest' | 'manual', detail?: string | null): RatingSnapshot {
    const info = this.db
      .prepare(
        `INSERT INTO rating_history (rating, source, detail)
         VALUES (?, ?, ?)`
      )
      .run(rating, source, detail ?? null)
    return this.db
      .prepare(`${ROW_SELECT} WHERE id = ?`)
      .get(info.lastInsertRowid) as RatingSnapshot
  }

  /** 全部历史（升序，便于趋势图） */
  history(): RatingSnapshot[] {
    return this.db
      .prepare(`${ROW_SELECT} ORDER BY created_at ASC, id ASC`)
      .all() as RatingSnapshot[]
  }
}
