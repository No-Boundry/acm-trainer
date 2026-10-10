import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDb, closeDb } from '../../src/main/db/index'
import { ProblemsRepo } from '../../src/main/db/repositories/problems'
import { PlansRepo } from '../../src/main/db/repositories/plans'
import { isWorkingDay, nextWorkingDay, scheduleProblems, shiftTasks, planStats } from '../../src/main/services/training-plan'
import { addDays } from '../../src/main/services/review'
import { AppError } from '../../src/main/db/errors'
import type { ProblemUpsertInput } from '@shared/types'

/**
 * 训练计划（v1.10 FR-28）：排期纯函数 + 计划仓储（日历/打卡/没空日顺延）。
 * 固定基准日 2026-10-05（周一），避免依赖真实"今天"。
 */

const MON = '2026-10-05' // 周一
const SUN = '2026-10-11' // 周日

let db: ReturnType<typeof initDb>
let problems: ProblemsRepo
let plans: PlansRepo

function seed(): void {
  const inputs: ProblemUpsertInput[] = Array.from({ length: 10 }, (_, i) => ({
    contestId: 2000 + i,
    index: 'A',
    name: `P${i}`,
    rating: 800 + i * 100,
    solvedCount: 0,
    tags: ['dp']
  }))
  problems.upsertMany(inputs, '2026-10-05 09:00:00')
}

const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `${2000 + i}:A`)

beforeEach(() => {
  closeDb()
  db = initDb(':memory:')
  problems = new ProblemsRepo(db)
  plans = new PlansRepo(db)
  seed()
})
afterEach(() => closeDb())

describe('排期纯函数', () => {
  it('isWorkingDay：休息日与忙碌日都不可用', () => {
    expect(isWorkingDay(MON, {})).toBe(true)
    expect(isWorkingDay(SUN, { restWeekdays: [0] })).toBe(false)
    expect(isWorkingDay(MON, { busyDates: [MON] })).toBe(false)
  })

  it('nextWorkingDay：跳过休息日与忙碌日', () => {
    expect(nextWorkingDay(SUN, { restWeekdays: [0] })).toBe('2026-10-12') // 周日 → 下周一
    expect(nextWorkingDay(MON, { busyDates: [MON, addDays(MON, 1)] })).toBe(addDays(MON, 2))
  })

  it('按每日题量铺排，跳过周日', () => {
    const r = scheduleProblems(ids(8), { dailyTarget: 2, restWeekdays: [0], startDate: MON })
    expect(r.tasks).toHaveLength(8)
    expect(r.overflow).toBe(0)
    // 周一/周二/周三/周四各 2 题（周五周六继续，周日跳过）
    expect(r.tasks.slice(0, 2).every((t) => t.dueDate === MON)).toBe(true)
    expect(r.tasks.slice(2, 4).every((t) => t.dueDate === addDays(MON, 1))).toBe(true)
    expect(r.tasks.some((t) => t.dueDate === addDays(MON, 6))).toBe(false) // 周日无任务
  })

  it('超出目标日期的题目计入 overflow，不硬塞进最后一天', () => {
    const r = scheduleProblems(ids(6), { dailyTarget: 2, startDate: MON, targetDate: addDays(MON, 1) })
    expect(r.tasks).toHaveLength(4) // 周一 2 + 周二 2
    expect(r.overflow).toBe(2)
  })

  it('shiftTasks：只顺延未完成任务，已完成保持原位', () => {
    const tasks = [
      { problemId: 'a', dueDate: MON, status: 'done' as const },
      { problemId: 'b', dueDate: MON, status: 'pending' as const },
      { problemId: 'c', dueDate: addDays(MON, 1), status: 'pending' as const }
    ]
    const moved = shiftTasks(tasks, MON, 1, {})
    expect(moved[0].dueDate).toBe(MON) // 已完成不动
    expect(moved[1].dueDate).toBe(addDays(MON, 1))
    expect(moved[2].dueDate).toBe(addDays(MON, 2))
  })

  it('planStats 统计完成情况', () => {
    expect(planStats([{ status: 'done' }, { status: 'pending' }, { status: 'skipped' }])).toEqual({
      total: 3,
      done: 1,
      pending: 2
    })
  })
})

describe('PlansRepo：创建 / 排期 / 打卡 / 没空日顺延', () => {
  it('创建计划并排期，详情按日期分组', () => {
    const plan = plans.create({ name: '冲 1600', dailyTarget: 2, restWeekdays: [0], targetDate: null })
    const outcome = plans.schedule(plan.id, ids(5))
    expect(outcome.tasks).toHaveLength(5)
    const detail = plans.detail(plan.id, problems)
    expect(detail.days.length).toBeGreaterThanOrEqual(3)
    expect(detail.days[0].tasks).toHaveLength(2)
    expect(detail.days[0].tasks[0].problem?.name).toBe('P0')
    expect(detail.plan.total).toBe(5)
    expect(detail.plan.doneCount).toBe(0)
  })

  it('打卡 / 取消打卡（toggleTask）', () => {
    const plan = plans.create({ name: 'P', dailyTarget: 1 })
    plans.schedule(plan.id, ids(3))
    const first = plans.detail(plan.id, problems).days[0].tasks[0]
    const done = plans.toggleTask(plan.id, first.problemId)
    expect(done.status).toBe('done')
    expect(plans.getById(plan.id)?.doneCount).toBe(1)
    const undone = plans.toggleTask(plan.id, first.problemId)
    expect(undone.status).toBe('pending')
    expect(plans.getById(plan.id)?.doneCount).toBe(0)
  })

  it('标记没空日：记录原因，并把其后未完成任务顺延（总题量不变）', () => {
    const plan = plans.create({ name: 'P', dailyTarget: 2, restWeekdays: [0] })
    plans.schedule(plan.id, ids(6))
    const before = plans.detail(plan.id, problems)
    expect(before.plan.total).toBe(6)

    // 把第一天标记为没空 → 该天任务应被推到后续可用日
    const firstDate = before.days[0].date
    const updated = plans.markBusy(plan.id, firstDate, '期中考试')
    expect(updated.busyDays.map((b) => b.date)).toContain(firstDate)

    const after = plans.detail(plan.id, problems)
    expect(after.plan.total).toBe(6) // 总题量不变
    // 没空日不再有任何任务（该日不会出现在日历分组里）
    expect(after.days.some((d) => d.date === firstDate)).toBe(false)
    expect(after.days.every((d) => d.date !== SUN)).toBe(true)

    // 取消没空标记后重新排期
    plans.unmarkBusy(plan.id, firstDate)
    const restored = plans.reschedule(plan.id)
    expect(restored.tasks.length).toBeGreaterThan(0)
    expect(plans.getById(plan.id)?.busyDays).toHaveLength(0)
  })

  it('已完成的任务不会被顺延打乱', () => {
    const plan = plans.create({ name: 'P', dailyTarget: 2 })
    plans.schedule(plan.id, ids(4))
    const detail = plans.detail(plan.id, problems)
    const firstTask = detail.days[0].tasks[0]
    plans.toggleTask(plan.id, firstTask.problemId)
    plans.markBusy(plan.id, detail.days[0].date, '有事')

    const after = plans.detail(plan.id, problems)
    const stillThere = after.days.flatMap((d) => d.tasks).find((t) => t.problemId === firstTask.problemId)
    expect(stillThere?.status).toBe('done')
    expect(stillThere?.dueDate).toBe(firstTask.dueDate)
  })

  it('目标日期过近 → overflow 提示（不静默丢题）', () => {
    const plan = plans.create({ name: 'P', dailyTarget: 2, targetDate: addDays(MON, 1) })
    // schedule 从"今天"开始排；这里只验证 overflow 字段被正确回传
    const outcome = plans.schedule(plan.id, ids(8))
    expect(outcome.tasks.length + outcome.overflow).toBe(8)
  })

  it('删除计划级联删除任务与没空日', () => {
    const plan = plans.create({ name: 'P', dailyTarget: 1 })
    plans.schedule(plan.id, ids(3))
    plans.markBusy(plan.id, MON, 'x')
    plans.delete(plan.id)
    expect(
      (db.prepare('SELECT COUNT(*) AS c FROM plan_tasks WHERE plan_id = ?').get(plan.id) as { c: number }).c
    ).toBe(0)
    expect(
      (db.prepare('SELECT COUNT(*) AS c FROM plan_busy_days WHERE plan_id = ?').get(plan.id) as { c: number })
        .c
    ).toBe(0)
    expect(() => plans.getById(plan.id)).not.toThrow()
    expect(plans.getById(plan.id)).toBeNull()
  })

  it('空名称 / 不存在的计划 → 明确错误', () => {
    expect(() => plans.create({ name: '  ' })).toThrow(AppError)
    expect(() => plans.detail(999, problems)).toThrow(/计划不存在/)
  })
})
