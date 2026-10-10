import type { Contest, ContestResult } from '@shared/types'
import type { Repos } from './index'
import type { ProblemsRepo } from '../db/repositories/problems'
import { AppError } from '../db/errors'

/**
 * 虚拟比赛服务（docs/03-详细设计 §6）。
 * 纯函数可单测：computePenaltySeconds / computeContestBreakdown / generateProblemSelection。
 */

export interface GenerateSelectionReq {
  count: 3 | 5 | 7 | 10
  ratingMin?: number | null
  ratingMax?: number | null
  tags?: string[]
  excludeIds?: string[]
}

/**
 * 组卷（docs/03-详细设计 §6.1）：按 rating 分桶均匀抽取。
 */
export function generateProblemSelection(
  repo: ProblemsRepo,
  req: GenerateSelectionReq
): string[] {
  const { count, ratingMin, ratingMax, tags, excludeIds } = req
  const candidates = repo
    .list({
      page: 1,
      pageSize: 100000,
      ratingMin: ratingMin ?? null,
      ratingMax: ratingMax ?? null,
      tags: tags ?? [],
      sortBy: 'rating',
      sortDir: 'asc'
    })
    .items.filter((p) => p.rating != null && !(excludeIds ?? []).includes(p.id))

  if (candidates.length < count) {
    throw new AppError('VALIDATION', '符合条件的题目不足，请放宽难度或标签条件')
  }

  // 按 rating 分桶，每桶抽 1 题，保证难度覆盖均匀
  const buckets: typeof candidates[] = Array.from({ length: count }, () => [])
  candidates.forEach((p, i) => {
    buckets[i % count].push(p)
  })
  const picked = buckets.map((bucket, i) => {
    const idx = Math.min(bucket.length - 1, Math.floor((i * 7) % Math.max(1, bucket.length)))
    return bucket[idx]
  })
  return picked.sort((a, b) => (a.rating ?? 0) - (b.rating ?? 0)).map((p) => p.id)
}

export interface PenaltyResult {
  acSeconds: number | null
  wrongCount: number
  penaltySeconds: number | null
}

/**
 * ACM 罚时：penalty = AC耗时(秒) + 错误提交数 × 20 × 60。
 * 未 AC 的题 penalty 为 null（不计入总罚时）。
 */
export function computePenaltySeconds(
  acSeconds: number | null,
  wrongCount: number
): number | null {
  if (acSeconds == null) return null
  return acSeconds + wrongCount * 20 * 60
}

/**
 * 计算每题结果：首个 AC 的时间与 AC 前的错误次数。
 * submissions 已按提交先后排序。
 */
export function computeContestBreakdown(contest: Contest): ContestResult['breakdown'] {
  return contest.problems.map((cp) => {
    const subs = contest.submissions.filter((s) => s.problemId === cp.problem.id)
    const firstAc = subs.find((s) => s.status === 'AC')
    const wrongCount = firstAc
      ? subs.filter((s) => s.id < firstAc.id && s.status !== 'AC').length
      : subs.filter((s) => s.status !== 'AC').length
    const acSeconds = firstAc ? firstAc.secondsElapsed : null
    return {
      position: cp.position,
      problemId: cp.problem.id,
      status: firstAc ? 'AC' : subs.length > 0 ? subs[subs.length - 1].status : null,
      acSeconds,
      wrongCount,
      penaltySeconds: computePenaltySeconds(acSeconds, wrongCount)
    }
  })
}

/** 用完整题目信息填充比赛（service 层负责拼接） */
export function enrichContest(repos: Repos, contest: Contest): Contest {
  const ids = contest.problems.map((p) => p.problem.id)
  const byId = new Map(repos.problems.byIds(ids).map((p) => [p.id, p]))
  return {
    ...contest,
    problems: contest.problems.map((p) => ({
      position: p.position,
      problem: byId.get(p.problem.id) ?? p.problem
    }))
  }
}

/**
 * 结束比赛并计算结果（docs/03-详细设计 §6.2）。
 * 注：rating_history 写入由水平评估模块（A11）统一处理。
 */
export function finishContest(repos: Repos, id: number): ContestResult {
  const raw = repos.contests.finish(id)
  return buildContestResult(repos, raw.id)
}

/** 对已结束比赛计算结果（不改状态，用于历史回看） */
export function buildContestResult(repos: Repos, id: number): ContestResult {
  const raw = repos.contests.getById(id)
  if (!raw) throw new AppError('NOT_FOUND', '比赛不存在')
  const contest = enrichContest(repos, raw)
  const breakdown = computeContestBreakdown(contest)
  const solvedCount = breakdown.filter((b) => b.acSeconds != null).length
  const totalPenaltySeconds = breakdown.reduce((s, b) => s + (b.penaltySeconds ?? 0), 0)
  return { contest, solvedCount, totalPenaltySeconds, breakdown }
}
