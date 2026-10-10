import type { Database } from 'better-sqlite3'
import type {
  ListOrigin,
  ProblemList,
  ProblemListDetail,
  ProblemListItem,
  ProblemRow,
  ReviewEase,
  ReviewEntry
} from '@shared/types'
import { AppError } from '../errors'
import { localDate } from '../../services/review'
import type { ProblemsRepo } from './problems'

/**
 * 题单仓储（v1.10 FR-27）+ 题单内间隔复习（FR-29）。
 * 条目自带复习字段；题单聚合进度与「今日待复习」都在此实现。
 */

interface ListRow {
  id: number
  name: string
  description: string
  origin: ListOrigin
  trackId: string | null
  createdAt: string
  updatedAt: string
  total: number
  doneCount: number
  reviewCount: number
  dueCount: number
}

const LIST_SELECT = `
  SELECT l.id, l.name, l.description, l.origin, l.track_id AS trackId,
         l.created_at AS createdAt, l.updated_at AS updatedAt,
         (SELECT COUNT(*) FROM problem_list_items i WHERE i.list_id = l.id) AS total,
         (SELECT COUNT(*) FROM problem_list_items i WHERE i.list_id = l.id AND i.done = 1) AS doneCount,
         (SELECT COUNT(*) FROM problem_list_items i WHERE i.list_id = l.id AND i.review_stage > 0) AS reviewCount,
         (SELECT COUNT(*) FROM problem_list_items i
            WHERE i.list_id = l.id AND i.review_stage > 0 AND i.review_due IS NOT NULL
              AND i.review_due <= @today) AS dueCount
  FROM problem_lists l
`

interface ItemRow {
  id: number
  listId: number
  problemId: string
  position: number
  done: number
  doneAt: string | null
  note: string
  reviewStage: number
  reviewDue: string | null
  reviewLastAt: string | null
  reviewEase: ReviewEase | null
}

const ITEM_SELECT = `
  SELECT id, list_id AS listId, problem_id AS problemId, position, done,
         done_at AS doneAt, note,
         review_stage AS reviewStage, review_due AS reviewDue,
         review_last_at AS reviewLastAt, review_ease AS reviewEase
  FROM problem_list_items
`

function mapList(r: ListRow): ProblemList {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    origin: r.origin,
    trackId: r.trackId,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    total: r.total,
    doneCount: r.doneCount,
    reviewCount: r.reviewCount,
    dueCount: r.dueCount
  }
}

function mapItem(r: ItemRow): ProblemListItem {
  return {
    id: r.id,
    listId: r.listId,
    problemId: r.problemId,
    position: r.position,
    done: r.done === 1,
    doneAt: r.doneAt,
    note: r.note,
    reviewStage: r.reviewStage,
    reviewDue: r.reviewDue,
    reviewLastAt: r.reviewLastAt,
    reviewEase: r.reviewEase
  }
}

export interface CreateListInput {
  name: string
  description?: string
  origin?: ListOrigin
  trackId?: string | null
}

export class ListsRepo {
  constructor(private db: Database) {}

  create(input: CreateListInput): ProblemList {
    const name = (input.name ?? '').trim()
    if (!name) throw new AppError('VALIDATION', '题单名称不能为空')
    const info = this.db
      .prepare(
        `INSERT INTO problem_lists (name, description, origin, track_id) VALUES (?, ?, ?, ?)`
      )
      .run(name, input.description ?? '', input.origin ?? 'manual', input.trackId ?? null)
    const list = this.getById(Number(info.lastInsertRowid))
    if (!list) throw new AppError('DB_ERROR', '题单创建失败')
    return list
  }

  getById(id: number): ProblemList | null {
    const row = this.db.prepare(`${LIST_SELECT} WHERE l.id = @id`).get({ id, today: localDate() }) as
      | ListRow
      | undefined
    return row ? mapList(row) : null
  }

  list(): ProblemList[] {
    const rows = this.db
      .prepare(`${LIST_SELECT} ORDER BY l.updated_at DESC, l.id DESC`)
      .all({ today: localDate() }) as ListRow[]
    return rows.map(mapList)
  }

  update(id: number, fields: { name?: string; description?: string; trackId?: string | null }): ProblemList {
    const sets: string[] = []
    const params: Record<string, unknown> = { id }
    if (fields.name !== undefined) {
      const name = fields.name.trim()
      if (!name) throw new AppError('VALIDATION', '题单名称不能为空')
      sets.push('name = @name')
      params.name = name
    }
    if (fields.description !== undefined) {
      sets.push('description = @description')
      params.description = fields.description
    }
    if (fields.trackId !== undefined) {
      sets.push('track_id = @trackId')
      params.trackId = fields.trackId
    }
    if (sets.length === 0) {
      const cur = this.getById(id)
      if (!cur) throw new AppError('NOT_FOUND', '题单不存在')
      return cur
    }
    sets.push("updated_at = datetime('now','localtime')")
    const info = this.db.prepare(`UPDATE problem_lists SET ${sets.join(', ')} WHERE id = @id`).run(params)
    if (info.changes === 0) throw new AppError('NOT_FOUND', '题单不存在')
    const updated = this.getById(id)
    if (!updated) throw new AppError('NOT_FOUND', '题单不存在')
    return updated
  }

  delete(id: number): void {
    const info = this.db.prepare('DELETE FROM problem_lists WHERE id = ?').run(id)
    if (info.changes === 0) throw new AppError('NOT_FOUND', '题单不存在')
  }

  /** 追加题目（已存在的跳过），返回实际新增数 */
  addProblems(listId: number, problemIds: string[]): number {
    const list = this.getById(listId)
    if (!list) throw new AppError('NOT_FOUND', '题单不存在')
    const exists = this.db.prepare(
      'SELECT 1 AS x FROM problem_list_items WHERE list_id = ? AND problem_id = ?'
    )
    const nextPos = (
      this.db
        .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM problem_list_items WHERE list_id = ?')
        .get(listId) as { p: number }
    ).p
    const insert = this.db.prepare(
      `INSERT INTO problem_list_items (list_id, problem_id, position) VALUES (?, ?, ?)`
    )
    const valid = this.db.prepare('SELECT 1 AS x FROM problems WHERE id = ?')
    const run = this.db.transaction((ids: string[]) => {
      let added = 0
      let pos = nextPos
      for (const pid of ids) {
        if (!valid.get(pid)) continue
        if (exists.get(listId, pid)) continue
        insert.run(listId, pid, pos)
        pos += 1
        added += 1
      }
      return added
    })
    const added = run([...new Set(problemIds)])
    this.db.prepare("UPDATE problem_lists SET updated_at = datetime('now','localtime') WHERE id = ?").run(listId)
    return added
  }

  removeItem(listId: number, problemId: string): void {
    const info = this.db
      .prepare('DELETE FROM problem_list_items WHERE list_id = ? AND problem_id = ?')
      .run(listId, problemId)
    if (info.changes === 0) throw new AppError('NOT_FOUND', '题单中没有这道题')
    this.db.prepare("UPDATE problem_lists SET updated_at = datetime('now','localtime') WHERE id = ?").run(listId)
  }

  /** 勾选完成：首次完成自动进入复习第 1 档 */
  setDone(listId: number, problemId: string, done: boolean): ProblemListItem {
    const row = this.getItem(listId, problemId)
    if (!row) throw new AppError('NOT_FOUND', '题单中没有这道题')
    const today = localDate()
    if (done) {
      if (row.reviewStage <= 0) {
        // 首次完成 → 进入复习第 1 档（1 天后复习）
        this.db
          .prepare(
            `UPDATE problem_list_items
                SET done = 1, done_at = @today,
                    review_stage = 1,
                    review_due = date(@today, '+1 day'),
                    review_last_at = @today
              WHERE list_id = @listId AND problem_id = @problemId`
          )
          .run({ today, listId, problemId })
      } else {
        // 已进入复习的条目：重新勾选只更新完成时间，不动复习排期
        this.db
          .prepare(
            `UPDATE problem_list_items SET done = 1, done_at = @today
              WHERE list_id = @listId AND problem_id = @problemId`
          )
          .run({ today, listId, problemId })
      }
    } else {
      this.db
        .prepare(
          `UPDATE problem_list_items SET done = 0, done_at = NULL
            WHERE list_id = @listId AND problem_id = @problemId`
        )
        .run({ listId, problemId })
    }
    this.db.prepare("UPDATE problem_lists SET updated_at = datetime('now','localtime') WHERE id = ?").run(listId)
    const updated = this.getItem(listId, problemId)
    if (!updated) throw new AppError('NOT_FOUND', '题单中没有这道题')
    return updated
  }

  setNote(listId: number, problemId: string, note: string): ProblemListItem {
    const info = this.db
      .prepare('UPDATE problem_list_items SET note = ? WHERE list_id = ? AND problem_id = ?')
      .run(note, listId, problemId)
    if (info.changes === 0) throw new AppError('NOT_FOUND', '题单中没有这道题')
    const updated = this.getItem(listId, problemId)
    if (!updated) throw new AppError('NOT_FOUND', '题单中没有这道题')
    return updated
  }

  /** 写入复习结果（由 services/review 计算出的 stage/due） */
  applyReview(listId: number, problemId: string, stage: number, due: string, ease: ReviewEase): ProblemListItem {
    const info = this.db
      .prepare(
        `UPDATE problem_list_items
            SET review_stage = @stage, review_due = @due, review_last_at = @today, review_ease = @ease,
                done = 1, done_at = COALESCE(done_at, @today)
          WHERE list_id = @listId AND problem_id = @problemId`
      )
      .run({ stage, due, ease, today: localDate(), listId, problemId })
    if (info.changes === 0) throw new AppError('NOT_FOUND', '题单中没有这道题')
    this.db.prepare("UPDATE problem_lists SET updated_at = datetime('now','localtime') WHERE id = ?").run(listId)
    const updated = this.getItem(listId, problemId)
    if (!updated) throw new AppError('NOT_FOUND', '题单中没有这道题')
    return updated
  }

  getItem(listId: number, problemId: string): ProblemListItem | null {
    const row = this.db
      .prepare(`${ITEM_SELECT} WHERE list_id = ? AND problem_id = ?`)
      .get(listId, problemId) as ItemRow | undefined
    return row ? mapItem(row) : null
  }

  /**
   * 题单详情：条目 + 题目信息（保持 position 顺序）。
   * 题目统一走 ProblemsRepo.byIds（已做行映射：tags/practiced/lastStatus 等派生字段）。
   */
  detail(listId: number, problems: ProblemsRepo): ProblemListDetail {
    const list = this.getById(listId)
    if (!list) throw new AppError('NOT_FOUND', '题单不存在')
    const rows = this.db
      .prepare(`${ITEM_SELECT} WHERE list_id = ? ORDER BY position, id`)
      .all(listId) as ItemRow[]
    const byId = new Map(problems.byIds(rows.map((r) => r.problemId)).map((p) => [p.id, p]))
    return {
      list,
      items: rows.map((r) => ({
        ...mapItem(r),
        problem: (byId.get(r.problemId) ?? null) as ProblemRow | null
      }))
    }
  }

  /** 今日待复习（跨题单，含题单名） */
  dueReviews(problems: ProblemsRepo, today = localDate()): ReviewEntry[] {
    const rows = this.db
      .prepare(
        `SELECT i.id, i.list_id AS listId, i.problem_id AS problemId, i.position, i.done,
                i.done_at AS doneAt, i.note,
                i.review_stage AS reviewStage, i.review_due AS reviewDue,
                i.review_last_at AS reviewLastAt, i.review_ease AS reviewEase,
                l.name AS listName
           FROM problem_list_items i
           JOIN problem_lists l ON l.id = i.list_id
          WHERE i.review_stage > 0 AND i.review_due IS NOT NULL AND i.review_due <= ?
          ORDER BY i.review_due, i.id`
      )
      .all(today) as (ItemRow & { listName: string })[]
    const byId = new Map(problems.byIds([...new Set(rows.map((r) => r.problemId))]).map((p) => [p.id, p]))
    return rows.map((r) => ({
      ...mapItem(r),
      listName: r.listName,
      problem: (byId.get(r.problemId) ?? null) as ProblemRow | null
    }))
  }
}
