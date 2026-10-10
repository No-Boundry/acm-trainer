import type { Database } from 'better-sqlite3'
import type {
  PlanDayGroup,
  PlanTaskRow,
  PlanTaskStatus,
  ProblemRow,
  TrainingPlan,
  TrainingPlanDetail
} from '@shared/types'
import { AppError } from '../errors'
import { scheduleProblems, shiftTasks, type ScheduleOutcome } from '../../services/training-plan'
import type { ProblemsRepo } from './problems'

/**
 * 训练计划仓储（v1.10 FR-28）：计划 + 日历任务 + 没空日；排期/顺延调用 services/training-plan 的纯函数。
 */

interface PlanRow {
  id: number
  name: string
  listId: number | null
  targetDate: string | null
  dailyTarget: number
  ratingMin: number | null
  ratingMax: number | null
  knowledgeIds: string
  restWeekdays: string
  trackId: string | null
  createdAt: string
  updatedAt: string
  total: number
  doneCount: number
}

const PLAN_SELECT = `
  SELECT p.id, p.name, p.list_id AS listId, p.target_date AS targetDate,
         p.daily_target AS dailyTarget, p.rating_min AS ratingMin, p.rating_max AS ratingMax,
         p.knowledge_ids AS knowledgeIds, p.rest_weekdays AS restWeekdays, p.track_id AS trackId,
         p.created_at AS createdAt, p.updated_at AS updatedAt,
         (SELECT COUNT(*) FROM plan_tasks t WHERE t.plan_id = p.id) AS total,
         (SELECT COUNT(*) FROM plan_tasks t WHERE t.plan_id = p.id AND t.status = 'done') AS doneCount
  FROM training_plans p
`

interface TaskRow {
  id: number
  planId: number
  problemId: string
  dueDate: string
  status: PlanTaskStatus
  doneAt: string | null
}

const TASK_SELECT = `
  SELECT id, plan_id AS planId, problem_id AS problemId, due_date AS dueDate,
         status, done_at AS doneAt
  FROM plan_tasks
`

function parseJsonArray(raw: string, fallback: number[] | string[]): never[] {
  try {
    const v = JSON.parse(raw) as unknown
    return Array.isArray(v) ? (v as never[]) : (fallback as never[])
  } catch {
    return fallback as never[]
  }
}

export interface CreatePlanRowInput {
  name: string
  listId?: number | null
  targetDate?: string | null
  dailyTarget?: number
  ratingMin?: number | null
  ratingMax?: number | null
  knowledgeIds?: string[]
  restWeekdays?: number[]
  trackId?: string | null
}

export class PlansRepo {
  constructor(private db: Database) {}

  private mapPlan(r: PlanRow): TrainingPlan {
    const busy = this.db
      .prepare('SELECT date, reason FROM plan_busy_days WHERE plan_id = ? ORDER BY date')
      .all(r.id) as { date: string; reason: string }[]
    return {
      id: r.id,
      name: r.name,
      listId: r.listId,
      targetDate: r.targetDate,
      dailyTarget: r.dailyTarget,
      ratingMin: r.ratingMin,
      ratingMax: r.ratingMax,
      knowledgeIds: parseJsonArray(r.knowledgeIds, []) as unknown as string[],
      restWeekdays: parseJsonArray(r.restWeekdays, []) as unknown as number[],
      trackId: r.trackId,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      total: r.total,
      doneCount: r.doneCount,
      busyDays: busy
    }
  }

  create(input: CreatePlanRowInput): TrainingPlan {
    const name = (input.name ?? '').trim()
    if (!name) throw new AppError('VALIDATION', '计划名称不能为空')
    const daily = Math.min(20, Math.max(1, Math.floor(input.dailyTarget ?? 3)))
    const info = this.db
      .prepare(
        `INSERT INTO training_plans (name, list_id, target_date, daily_target, rating_min, rating_max,
                                     knowledge_ids, rest_weekdays, track_id)
         VALUES (@name, @listId, @targetDate, @dailyTarget, @ratingMin, @ratingMax,
                 @knowledgeIds, @restWeekdays, @trackId)`
      )
      .run({
        name,
        listId: input.listId ?? null,
        targetDate: input.targetDate ?? null,
        dailyTarget: daily,
        ratingMin: input.ratingMin ?? null,
        ratingMax: input.ratingMax ?? null,
        knowledgeIds: JSON.stringify(input.knowledgeIds ?? []),
        restWeekdays: JSON.stringify(input.restWeekdays ?? []),
        trackId: input.trackId ?? null
      })
    const plan = this.getById(Number(info.lastInsertRowid))
    if (!plan) throw new AppError('DB_ERROR', '计划创建失败')
    return plan
  }

  getById(id: number): TrainingPlan | null {
    const row = this.db.prepare(`${PLAN_SELECT} WHERE p.id = ?`).get(id) as PlanRow | undefined
    return row ? this.mapPlan(row) : null
  }

  list(): TrainingPlan[] {
    const rows = this.db
      .prepare(`${PLAN_SELECT} ORDER BY p.updated_at DESC, p.id DESC`)
      .all() as PlanRow[]
    return rows.map((r) => this.mapPlan(r))
  }

  delete(id: number): void {
    const info = this.db.prepare('DELETE FROM training_plans WHERE id = ?').run(id)
    if (info.changes === 0) throw new AppError('NOT_FOUND', '计划不存在')
  }

  /** 用题目 id 覆盖式写入排期（先清空旧任务） */
  schedule(id: number, problemIds: string[]): ScheduleOutcome {
    const plan = this.getById(id)
    if (!plan) throw new AppError('NOT_FOUND', '计划不存在')
    const outcome = scheduleProblems(problemIds, {
      dailyTarget: plan.dailyTarget,
      restWeekdays: plan.restWeekdays,
      busyDates: plan.busyDays.map((b) => b.date),
      targetDate: plan.targetDate
    })
    const insert = this.db.prepare(
      `INSERT INTO plan_tasks (plan_id, problem_id, due_date, status) VALUES (?, ?, ?, 'pending')`
    )
    const run = this.db.transaction(() => {
      this.db.prepare('DELETE FROM plan_tasks WHERE plan_id = ?').run(id)
      for (const t of outcome.tasks) insert.run(id, t.problemId, t.dueDate)
      this.db
        .prepare("UPDATE training_plans SET updated_at = datetime('now','localtime') WHERE id = ?")
        .run(id)
    })
    run()
    return outcome
  }

  /** 追加没空日并顺延其后未完成任务 */
  markBusy(id: number, date: string, reason = ''): TrainingPlan {
    const plan = this.getById(id)
    if (!plan) throw new AppError('NOT_FOUND', '计划不存在')
    this.db
      .prepare('INSERT OR REPLACE INTO plan_busy_days (plan_id, date, reason) VALUES (?, ?, ?)')
      .run(id, date, reason)
    this.reschedule(id)
    const updated = this.getById(id)
    if (!updated) throw new AppError('NOT_FOUND', '计划不存在')
    return updated
  }

  unmarkBusy(id: number, date: string): TrainingPlan {
    this.db.prepare('DELETE FROM plan_busy_days WHERE plan_id = ? AND date = ?').run(id, date)
    const updated = this.getById(id)
    if (!updated) throw new AppError('NOT_FOUND', '计划不存在')
    return updated
  }

  /**
   * 顺延：从最早受影响的未完成日期开始，把该日之后（含）的未完成任务整体后移，
   * 跳过休息日与没空日，保证总题量不变。
   */
  reschedule(id: number, fromDate?: string): ScheduleOutcome {
    const plan = this.getById(id)
    if (!plan) throw new AppError('NOT_FOUND', '计划不存在')
    const tasks = this.db.prepare(`${TASK_SELECT} WHERE plan_id = ? ORDER BY due_date, id`).all(id) as TaskRow[]
    if (tasks.length === 0) return { tasks: [], overflow: 0, lastDate: null }
    const busy = plan.busyDays.map((b) => b.date)
    const start =
      fromDate ??
      [plan.busyDays.map((b) => b.date).sort()[0], tasks.find((t) => t.status === 'pending')?.dueDate]
        .filter((x): x is string => !!x)
        .sort()[0] ??
      tasks[0].dueDate

    // 找出受影响区间（start 起的未完成任务）重新铺排，其余保持不动
    const affected = tasks.filter((t) => t.status === 'pending' && t.dueDate >= start)
    if (affected.length === 0) {
      return { tasks: [], overflow: 0, lastDate: tasks.at(-1)?.dueDate ?? null }
    }
    const kept = tasks.filter((t) => !(t.status === 'pending' && t.dueDate >= start))
    // 受影响段从 start 起按每日题量重排（跳过休息日/没空日）
    const rescheduled = scheduleProblems(
      affected.map((t) => t.problemId),
      {
        dailyTarget: plan.dailyTarget,
        restWeekdays: plan.restWeekdays,
        busyDates: busy,
        startDate: start,
        targetDate: plan.targetDate
      }
    )
    const update = this.db.prepare('UPDATE plan_tasks SET due_date = ? WHERE plan_id = ? AND problem_id = ?')
    const run = this.db.transaction(() => {
      for (const t of rescheduled.tasks) update.run(t.dueDate, id, t.problemId)
    })
    run()
    return {
      tasks: [...kept.map((k) => ({ problemId: k.problemId, dueDate: k.dueDate })), ...rescheduled.tasks],
      overflow: rescheduled.overflow,
      lastDate: rescheduled.lastDate
    }
  }

  /** 兼容旧调用：按天顺延（未使用 busy 时会走 reschedule 全量重排） */
  shiftFrom(id: number, fromDate: string, shiftDays = 1): void {
    const plan = this.getById(id)
    if (!plan) throw new AppError('NOT_FOUND', '计划不存在')
    const tasks = this.db.prepare(`${TASK_SELECT} WHERE plan_id = ?`).all(id) as TaskRow[]
    const moved = shiftTasks(
      tasks.map((t) => ({ problemId: t.problemId, dueDate: t.dueDate, status: t.status })),
      fromDate,
      shiftDays,
      { restWeekdays: plan.restWeekdays, busyDates: plan.busyDays.map((b) => b.date) }
    )
    const update = this.db.prepare('UPDATE plan_tasks SET due_date = ? WHERE plan_id = ? AND problem_id = ?')
    const run = this.db.transaction(() => {
      for (const t of moved) update.run(t.dueDate, id, t.problemId)
    })
    run()
  }

  toggleTask(id: number, problemId: string): PlanTaskRow {
    const row = this.db
      .prepare(`${TASK_SELECT} WHERE plan_id = ? AND problem_id = ?`)
      .get(id, problemId) as TaskRow | undefined
    if (!row) throw new AppError('NOT_FOUND', '计划中没有这道题')
    const next: PlanTaskStatus = row.status === 'done' ? 'pending' : 'done'
    this.db
      .prepare(
        `UPDATE plan_tasks SET status = @status, done_at = @doneAt WHERE plan_id = @id AND problem_id = @problemId`
      )
      .run({
        status: next,
        doneAt: next === 'done' ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null,
        id,
        problemId
      })
    this.db.prepare("UPDATE training_plans SET updated_at = datetime('now','localtime') WHERE id = ?").run(id)
    const updated = this.db
      .prepare(`${TASK_SELECT} WHERE plan_id = ? AND problem_id = ?`)
      .get(id, problemId) as TaskRow
    return { ...updated, problem: null } as PlanTaskRow
  }

  /** 计划详情：按日期分组的任务 + 题目信息（题目统一走 ProblemsRepo.byIds 的行映射） */
  detail(id: number, problems: ProblemsRepo): TrainingPlanDetail {
    const plan = this.getById(id)
    if (!plan) throw new AppError('NOT_FOUND', '计划不存在')
    const tasks = this.db
      .prepare(`${TASK_SELECT} WHERE plan_id = ? ORDER BY due_date, id`)
      .all(id) as TaskRow[]
    const byId = new Map(problems.byIds([...new Set(tasks.map((t) => t.problemId))]).map((p) => [p.id, p]))
    const busyMap = new Map(plan.busyDays.map((b) => [b.date, b.reason]))
    const groups = new Map<string, PlanDayGroup>()
    for (const t of tasks) {
      const row: PlanTaskRow = {
        ...t,
        problem: (byId.get(t.problemId) ?? null) as ProblemRow | null
      }
      const g = groups.get(t.dueDate) ?? {
        date: t.dueDate,
        tasks: [],
        busy: busyMap.has(t.dueDate),
        reason: busyMap.get(t.dueDate) ?? ''
      }
      g.tasks.push(row)
      groups.set(t.dueDate, g)
    }
    return { plan, days: [...groups.values()].sort((a, b) => a.date.localeCompare(b.date)) }
  }
}
