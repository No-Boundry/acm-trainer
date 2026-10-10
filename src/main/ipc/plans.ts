import { IpcChannels } from '@shared/channels'
import type {
  CreatePlanInput,
  PlanTaskRow,
  SchedulePlanResult,
  TrainingPlan,
  TrainingPlanDetail
} from '@shared/types'
import type { Repos } from '../services'
import { AppError } from '../db/errors'
import { pickProblemsForList } from '../services/problem-list'
import { localDate } from '../services/review'
import { SKILL_NODE_MAP } from '@shared/skill-tree'
import { handle } from './helpers'

/** v1.10：训练计划（FR-28）——日历排期 + 没空日顺延 + 每日打卡 */
export function registerPlansIpc(repos: Repos): void {
  handle<unknown, TrainingPlan[]>(IpcChannels.PlansList, () => repos.plans.list())

  handle<{ id: number }, TrainingPlanDetail>(IpcChannels.PlansGet, ({ id }) =>
    repos.plans.detail(id, repos.problems)
  )

  handle<CreatePlanInput, { planId: number; scheduled: number; overflow: number }>(
    IpcChannels.PlansCreate,
    (req) => {
      // 题目来源优先级：显式 problemIds > 题单 > 自动抽题
      let problemIds: string[] = req.problemIds ?? []
      if (problemIds.length === 0 && req.listId) {
        const detail = repos.lists.detail(req.listId, repos.problems)
        problemIds = detail.items.map((i) => i.problemId)
      }
      if (problemIds.length === 0 && (req.generateCount ?? 0) > 0) {
        const tags = new Set<string>()
        for (const id of req.knowledgeIds ?? []) {
          const node = SKILL_NODE_MAP.get(id)
          if (node) for (const t of node.tags) tags.add(t)
        }
        const { ids } = pickProblemsForList(repos.problems, {
          knowledgeTags: [...tags],
          count: req.generateCount ?? 0,
          ratingMin: req.ratingMin ?? null,
          ratingMax: req.ratingMax ?? null,
          excludePracticed: req.excludePracticed ?? false
        })
        problemIds = ids
      }
      if (problemIds.length === 0) {
        throw new AppError('VALIDATION', '没有可排期的题目：请选择题单、或用知识点+题量自动抽题')
      }
      const plan = repos.plans.create({
        name: req.name?.trim() || `训练计划 ${localDate()}`,
        listId: req.listId ?? null,
        targetDate: req.targetDate ?? null,
        dailyTarget: req.dailyTarget ?? 3,
        ratingMin: req.ratingMin ?? null,
        ratingMax: req.ratingMax ?? null,
        knowledgeIds: req.knowledgeIds ?? [],
        restWeekdays: req.restWeekdays ?? [],
        trackId: req.trackId ?? null
      })
      const outcome = repos.plans.schedule(plan.id, problemIds)
      return { planId: plan.id, scheduled: outcome.tasks.length, overflow: outcome.overflow }
    }
  )

  handle<{ id: number }, void>(IpcChannels.PlansDelete, ({ id }) => repos.plans.delete(id))

  handle<{ id: number; problemId: string }, PlanTaskRow>(IpcChannels.PlansToggleTask, (req) =>
    repos.plans.toggleTask(req.id, req.problemId)
  )

  handle<{ id: number; date: string; reason?: string }, TrainingPlan>(IpcChannels.PlansMarkBusy, (req) =>
    repos.plans.markBusy(req.id, req.date, req.reason ?? '')
  )

  handle<{ id: number; date: string }, TrainingPlan>(IpcChannels.PlansUnmarkBusy, (req) =>
    repos.plans.unmarkBusy(req.id, req.date)
  )

  handle<{ id: number; fromDate?: string }, SchedulePlanResult>(IpcChannels.PlansReschedule, (req) => {
    const plan = repos.plans.getById(req.id)
    if (!plan) throw new AppError('NOT_FOUND', '计划不存在')
    const outcome = repos.plans.reschedule(req.id, req.fromDate)
    return {
      planId: req.id,
      scheduled: outcome.tasks.length,
      lastDate: outcome.lastDate,
      overflow: outcome.overflow
    }
  })
}
