import { addDays, localDate } from './review'
import type { PlanTaskStatus } from '@shared/types'

/**
 * 训练计划排期（v1.10 FR-28）。纯函数，便于单测。
 *
 * 规则：
 * - 从 startDate 起，每个可用日安排 dailyTarget 道题（默认今天开始）；
 * - 跳过「每周固定休息日」与「没空日」；
 * - 若给了 targetDate，排到该日期为止；超出目标日期的题目计入 overflow（不强行塞进最后一天）；
 * - 任务顺序 = 传入题目顺序（通常来自题单顺序或按难度升序抽题结果）。
 */

export interface ScheduleOptions {
  dailyTarget: number
  /** 0=周日 … 6=周六 */
  restWeekdays?: number[]
  /** 忙碌日（'YYYY-MM-DD'） */
  busyDates?: string[]
  targetDate?: string | null
  startDate?: string
  /** 最多向后看多少天（防御死循环） */
  maxDays?: number
}

export interface ScheduledTask {
  problemId: string
  dueDate: string
}

export interface ScheduleOutcome {
  tasks: ScheduledTask[]
  overflow: number
  lastDate: string | null
}

/** 某日期是否为可用日（非休息日、非忙碌日） */
export function isWorkingDay(date: string, opts: Pick<ScheduleOptions, 'restWeekdays' | 'busyDates'>): boolean {
  const [y, m, d] = date.split('-').map(Number)
  const weekday = new Date(y, m - 1, d).getDay()
  if ((opts.restWeekdays ?? []).includes(weekday)) return false
  if ((opts.busyDates ?? []).includes(date)) return false
  return true
}

/** 下一个可用日（含传入日期本身） */
export function nextWorkingDay(
  date: string,
  opts: Pick<ScheduleOptions, 'restWeekdays' | 'busyDates'>,
  maxDays = 3650
): string {
  let cur = date
  for (let i = 0; i < maxDays; i++) {
    if (isWorkingDay(cur, opts)) return cur
    cur = addDays(cur, 1)
  }
  return cur
}

/** 把题目排到日历上 */
export function scheduleProblems(problemIds: string[], opts: ScheduleOptions): ScheduleOutcome {
  const dailyTarget = Math.max(1, Math.floor(opts.dailyTarget || 1))
  const start = opts.startDate ?? localDate()
  const target = opts.targetDate ?? null
  const maxDays = opts.maxDays ?? 3650
  const tasks: ScheduledTask[] = []
  let overflow = 0
  let day = nextWorkingDay(start, opts)
  let index = 0
  let guard = 0
  while (index < problemIds.length && guard < maxDays) {
    guard += 1
    if (target && day > target) {
      overflow += problemIds.length - index
      break
    }
    if (!isWorkingDay(day, opts)) {
      day = addDays(day, 1)
      continue
    }
    for (let i = 0; i < dailyTarget && index < problemIds.length; i++) {
      tasks.push({ problemId: problemIds[index], dueDate: day })
      index += 1
    }
    day = nextWorkingDay(addDays(day, 1), opts)
  }
  if (index < problemIds.length && overflow === 0) {
    overflow = problemIds.length - index
  }
  return { tasks, overflow, lastDate: tasks.at(-1)?.dueDate ?? null }
}

/**
 * 顺延：从 fromDate（含）起的未完成任务整体 +shiftDays，
 * 若目标日期不变则总题量不变、完成时间推迟（与「ACM 训练台」同思路）。
 */
export function shiftTasks(
  tasks: { problemId: string; dueDate: string; status: PlanTaskStatus }[],
  fromDate: string,
  shiftDays = 1,
  opts: Pick<ScheduleOptions, 'restWeekdays' | 'busyDates'> = {}
): ScheduledTask[] {
  return tasks.map((t) => {
    if (t.status !== 'pending' || t.dueDate < fromDate) {
      return { problemId: t.problemId, dueDate: t.dueDate }
    }
    const moved = addDays(t.dueDate, shiftDays)
    return { problemId: t.problemId, dueDate: nextWorkingDay(moved, opts) }
  })
}

/** 计划进度统计 */
export function planStats(tasks: { status: PlanTaskStatus }[]): {
  total: number
  done: number
  pending: number
} {
  const total = tasks.length
  const done = tasks.filter((t) => t.status === 'done').length
  return { total, done, pending: total - done }
}
