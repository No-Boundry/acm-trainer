import { LEETCODE_DIFFICULTY_RATING } from '@shared/types'
import type {
  LeetcodeRatingInfo,
  LuoguRatingInfo,
  RatingBreakdown,
  RatingSnapshot,
  ResultStatus
} from '@shared/types'
import type { Repos } from './index'
import { computeContestBreakdown, enrichContest } from './contest'

/**
 * 水平评估算法（docs/03-详细设计 §5 + §10.3 洛谷扩展）。
 * 纯函数可单测；orchestrator 读取练习记录与比赛记录组装输入。
 * v1.3 FR-6.6：洛谷练习分独立计算与展示，不并入 CF 综合（用户决策：不作合并）。
 */

export const RATING_FLOOR = 800
export const RATING_CEIL = 3500
export const DAY_MS = 24 * 60 * 60 * 1000
const PRACTICE_DAYS = 90
const MAX_CONTESTS = 3

/**
 * 洛谷难度（1-7）→ 近似 CF 分值（用户确认映射表，docs/03 §10.3）：
 * 1入门→900, 2普及-→1100, 3普及/提高-→1300, 4普及+/提高→1500,
 * 5提高+/省选-→1750, 6省选/NOI-→2050, 7NOI+→2300。
 * 难度 0（暂无评定）不参与。
 */
export const LUOGU_DIFFICULTY_RATING: Readonly<Record<number, number>> = {
  1: 900,
  2: 1100,
  3: 1300,
  4: 1500,
  5: 1750,
  6: 2050,
  7: 2300
}

export function luoguMappedRating(
  difficulty: number | null | undefined,
  map: Readonly<Record<number, number>> = LUOGU_DIFFICULTY_RATING
): number | null {
  if (difficulty == null) return null
  return map[difficulty] ?? null
}

/** 综合分默认权值（设置可覆盖，v1.4；初始 0.7/0.3 维持现状） */
export interface RatingWeights {
  practice: number
  contest: number
}

export const DEFAULT_RATING_WEIGHTS: RatingWeights = { practice: 0.7, contest: 0.3 }

/** 权值归一化（和为 1；非法输入回退默认） */
export function normalizeWeights(w: RatingWeights | null | undefined): RatingWeights {
  const p = typeof w?.practice === 'number' && Number.isFinite(w.practice) && w.practice >= 0 ? w.practice : 0
  const c = typeof w?.contest === 'number' && Number.isFinite(w.contest) && w.contest >= 0 ? w.contest : 0
  const sum = p + c
  if (sum <= 0) return DEFAULT_RATING_WEIGHTS
  return { practice: p / sum, contest: c / sum }
}

/** 解析设置中的权值 JSON；非法回退默认 */
export function parseRatingWeights(raw: string | null | undefined): RatingWeights {
  if (!raw) return DEFAULT_RATING_WEIGHTS
  try {
    const j = JSON.parse(raw) as { practice?: unknown; contest?: unknown }
    return normalizeWeights({
      practice: typeof j.practice === 'number' ? j.practice : NaN,
      contest: typeof j.contest === 'number' ? j.contest : NaN
    })
  } catch {
    return DEFAULT_RATING_WEIGHTS
  }
}

/** 解析设置中的洛谷难度映射 JSON（键 1..7，值 800..3500）；非法项丢弃，全非法回退 null */
export function parseLuoguDiffMap(raw: string | null | undefined): Record<number, number> | null {
  if (!raw) return null
  try {
    const j = JSON.parse(raw) as Record<string, unknown>
    const out: Record<number, number> = {}
    for (const k of Object.keys(j)) {
      const d = Number(k)
      const v = j[k]
      if (!Number.isInteger(d) || d < 1 || d > 7) continue
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 800 || v > 3500) continue
      out[d] = Math.round(v)
    }
    return Object.keys(out).length > 0 ? out : null
  } catch {
    return null
  }
}

export interface RatingTitle {
  title: string
  color: string
}

/** 称号映射（参考 CF 颜色区间，docs/03-详细设计 §5.4） */
export function titleForRating(rating: number): RatingTitle {
  if (rating < 1000) return { title: '新手 Newbie', color: '#808080' }
  if (rating < 1200) return { title: '入门 Pupil', color: '#008000' }
  if (rating < 1400) return { title: '进阶 Specialist', color: '#03a89e' }
  if (rating < 1600) return { title: '省赛候选 Expert', color: '#0000ff' }
  if (rating < 1900) return { title: '区域赛候选 Candidate Master', color: '#aa00aa' }
  if (rating < 2200) return { title: '区域赛选手 Master', color: '#ff8c00' }
  return { title: '顶尖选手 International Master+', color: '#ff0000' }
}

export function clampRating(r: number): number {
  return Math.max(RATING_FLOOR, Math.min(RATING_CEIL, Math.round(r)))
}

export interface RatingAttempt {
  rating: number
  isAc: boolean
  createdAt: string
}

/**
 * 练习分：近 90 天、有 CF rating 的练习记录。
 * 每题取最近一次练习结果；s_i = 1 若最近为 AC。
 * PracticeRating = clamp( avgR − (1 − acc) × 300 )
 */
export function computePracticeRating(attempts: RatingAttempt[]): number | null {
  if (attempts.length === 0) return null
  const avgR = attempts.reduce((s, a) => s + a.rating, 0) / attempts.length
  const acc = attempts.filter((a) => a.isAc).length / attempts.length
  return clampRating(avgR - (1 - acc) * 300)
}

export interface RatingContest {
  solvedAvg: number | null
  penaltyMinutes: number
}

/**
 * 比赛分：有效比赛（有 AC 且有 rating 的题）的
 * clamp( solvedAvg − penaltyMin × 2 ) 的均值。
 */
export function computeContestRating(contests: RatingContest[]): number | null {
  const valid = contests.filter((c) => c.solvedAvg != null)
  if (valid.length === 0) return null
  const vals = valid.map((c) => clampRating((c.solvedAvg as number) - c.penaltyMinutes * 2))
  return Math.round(vals.reduce((s, v) => s + v, 0) / vals.length)
}

/** 综合 Rating：wP×练习分 + wC×比赛分（权值可自定义，v1.4；默认 0.7/0.3 维持现状；任一无数据则用另一项） */
export function combineRating(
  practice: number | null,
  contest: number | null,
  weights: RatingWeights = DEFAULT_RATING_WEIGHTS
): number | null {
  if (practice == null && contest == null) return null
  if (contest == null) return practice
  if (practice == null) return contest
  const w = normalizeWeights(weights)
  return Math.round(w.practice * practice + w.contest * contest)
}

/** 力扣难度映射默认值（v1.9 FR-23：简单/中等/困难 → 同量级分值；与 shared 常量同源） */
export function leetcodeMappedRating(
  difficulty: number | null | undefined,
  map: Readonly<Record<number, number>> = LEETCODE_DIFFICULTY_RATING
): number | null {
  if (difficulty == null) return null
  return map[difficulty] ?? null
}

/** 解析设置中的力扣难度映射 JSON（键 1..3，值 800..3500）；非法项丢弃，全非法回退 null */
export function parseLeetcodeDiffMap(raw: string | null | undefined): Record<number, number> | null {
  if (!raw) return null
  try {
    const j = JSON.parse(raw) as Record<string, unknown>
    const out: Record<number, number> = {}
    for (const k of Object.keys(j)) {
      const d = Number(k)
      const v = j[k]
      if (!Number.isInteger(d) || d < 1 || d > 3) continue
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 800 || v > 3500) continue
      out[d] = Math.round(v)
    }
    return Object.keys(out).length > 0 ? out : null
  } catch {
    return null
  }
}

export interface LuoguAttempt {
  difficulty: number
  isAc: boolean
}

/**
 * 洛谷练习分（v1.3 FR-6.6，独立于 CF 综合）：
 * 近 90 天洛谷题练习记录（含 UID 导入的 AC 记录），每题取最近一次；
 * 难度映射分值代入同一公式：clamp( avgMapped − (1 − acc) × 300 )。
 * map 可自定义（v1.4 设置）。
 */
export function computeLuoguPracticeRating(
  attempts: LuoguAttempt[],
  map: Readonly<Record<number, number>> = LUOGU_DIFFICULTY_RATING
): number | null {
  if (attempts.length === 0) return null
  const mapped = attempts.map((a) => ({ rating: luoguMappedRating(a.difficulty, map), isAc: a.isAc }))
  const valid = mapped.filter((m): m is { rating: number; isAc: boolean } => m.rating != null)
  if (valid.length === 0) return null
  const avgR = valid.reduce((s, m) => s + m.rating, 0) / valid.length
  const acc = valid.filter((m) => m.isAc).length / valid.length
  return clampRating(avgR - (1 - acc) * 300)
}

/**
 * 力扣练习分（v1.9 FR-23，与洛谷同构、独立于 CF 综合）：
 * 近 90 天力扣题练习记录，每题取最近一次；难度 1/2/3 折算分值后代入同一公式。
 */
export function computeLeetcodePracticeRating(
  attempts: LuoguAttempt[],
  map: Readonly<Record<number, number>> = LEETCODE_DIFFICULTY_RATING
): number | null {
  if (attempts.length === 0) return null
  const mapped = attempts.map((a) => ({ rating: leetcodeMappedRating(a.difficulty, map), isAc: a.isAc }))
  const valid = mapped.filter((m): m is { rating: number; isAc: boolean } => m.rating != null)
  if (valid.length === 0) return null
  const avgR = valid.reduce((s, m) => s + m.rating, 0) / valid.length
  const acc = valid.filter((m) => m.isAc).length / valid.length
  return clampRating(avgR - (1 - acc) * 300)
}

function localDateMinusDays(days: number): string {
  const d = new Date(Date.now() - days * DAY_MS)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/**
 * 计算完整评估（不写历史；recalc 时由调用方写入）。
 */
export function computeRatingBreakdown(repos: Repos): RatingBreakdown {
  const cutoff = localDateMinusDays(PRACTICE_DAYS)

  // 用户自定义（v1.4）：权值与洛谷映射；非法/缺省回退内置默认
  const weights = parseRatingWeights(repos.settings.get('ratingWeights'))
  const diffMap = parseLuoguDiffMap(repos.settings.get('luoguDiffRatings')) ?? LUOGU_DIFFICULTY_RATING
  const lcDiffMap =
    parseLeetcodeDiffMap(repos.settings.get('leetcodeDiffRatings')) ?? LEETCODE_DIFFICULTY_RATING

  // 练习数据：近 90 天记录，按题取最近一次
  const { items: records } = repos.records.list({ page: 1, pageSize: 100000 })
  const byProblem = new Map<string, { createdAt: string; status: ResultStatus }>()
  for (const r of records) {
    if (r.createdAt < cutoff) continue
    const cur = byProblem.get(r.problemId)
    if (!cur || r.createdAt > cur.createdAt) {
      byProblem.set(r.problemId, { createdAt: r.createdAt, status: r.status })
    }
  }
  const attempts: RatingAttempt[] = []
  const luoguByProblem = new Map<string, { status: ResultStatus; difficulty: number | null }>()
  const lcByProblem = new Map<string, { status: ResultStatus; difficulty: number | null }>()
  for (const [pid, rec] of byProblem) {
    const p = repos.problems.getById(pid)
    if (!p) continue
    if (p.source === 'cf' && p.rating != null) {
      attempts.push({ rating: p.rating, isAc: rec.status === 'AC', createdAt: rec.createdAt })
    } else if (p.source === 'luogu') {
      luoguByProblem.set(pid, { status: rec.status, difficulty: p.difficulty })
    } else if (p.source === 'leetcode') {
      lcByProblem.set(pid, { status: rec.status, difficulty: p.difficulty })
    }
  }

  // 洛谷练习分（独立；难度 1-7 折算，0/无难度不参与）
  const luoguAttempts: LuoguAttempt[] = []
  const distMap = new Map<number, { total: number; ac: number }>()
  for (const { status, difficulty } of luoguByProblem.values()) {
    if (difficulty == null || luoguMappedRating(difficulty, diffMap) == null) continue
    const isAc = status === 'AC'
    luoguAttempts.push({ difficulty, isAc })
    const d = distMap.get(difficulty) ?? { total: 0, ac: 0 }
    d.total += 1
    if (isAc) d.ac += 1
    distMap.set(difficulty, d)
  }
  const luoguRating = computeLuoguPracticeRating(luoguAttempts, diffMap)
  const luoguInfo: LuoguRatingInfo = {
    rating: luoguRating,
    attemptCount: luoguAttempts.length,
    acCount: luoguAttempts.filter((a) => a.isAc).length,
    accuracy:
      luoguAttempts.length > 0
        ? Number(
            ((luoguAttempts.filter((a) => a.isAc).length / luoguAttempts.length) * 100).toFixed(1)
          )
        : null,
    difficultyDist: [...distMap.entries()]
      .map(([difficulty, v]) => ({ difficulty, total: v.total, ac: v.ac }))
      .sort((a, b) => a.difficulty - b.difficulty)
  }

  // 力扣练习分（v1.9 FR-23，独立；难度 1-3 折算）
  const lcAttempts: LuoguAttempt[] = []
  const lcDistMap = new Map<number, { total: number; ac: number }>()
  for (const { status, difficulty } of lcByProblem.values()) {
    if (difficulty == null || leetcodeMappedRating(difficulty, lcDiffMap) == null) continue
    const isAc = status === 'AC'
    lcAttempts.push({ difficulty, isAc })
    const d = lcDistMap.get(difficulty) ?? { total: 0, ac: 0 }
    d.total += 1
    if (isAc) d.ac += 1
    lcDistMap.set(difficulty, d)
  }
  const lcInfo: LeetcodeRatingInfo = {
    rating: computeLeetcodePracticeRating(lcAttempts, lcDiffMap),
    attemptCount: lcAttempts.length,
    acCount: lcAttempts.filter((a) => a.isAc).length,
    accuracy:
      lcAttempts.length > 0
        ? Number(((lcAttempts.filter((a) => a.isAc).length / lcAttempts.length) * 100).toFixed(1))
        : null,
    difficultyDist: [...lcDistMap.entries()]
      .map(([difficulty, v]) => ({ difficulty, total: v.total, ac: v.ac }))
      .sort((a, b) => a.difficulty - b.difficulty)
  }

  // 比赛数据：近 90 天已结束，最近 3 场
  const finished = repos.contests
    .list()
    .filter((c) => c.status === 'finished' && c.finishedAt != null && c.finishedAt >= cutoff)
    .slice(0, MAX_CONTESTS)
  const contestInputs: RatingContest[] = []
  for (const item of finished) {
    const contest = repos.contests.getById(item.id)
    if (!contest) continue
    const enriched = enrichContest(repos, contest)
    const breakdown = computeContestBreakdown(enriched)
    const solved = breakdown
      .map((b) => ({ acSeconds: b.acSeconds, problem: enriched.problems.find((p) => p.position === b.position)?.problem }))
      .filter((s) => s.acSeconds != null && s.problem && s.problem.rating != null)
    const solvedAvg =
      solved.length > 0
        ? solved.reduce((s, x) => s + (x.problem!.rating as number), 0) / solved.length
        : null
    const penaltyMinutes = breakdown.reduce((s, b) => s + (b.penaltySeconds ?? 0), 0) / 60
    contestInputs.push({ solvedAvg, penaltyMinutes })
  }

  const practiceRating = computePracticeRating(attempts)
  const contestRating = computeContestRating(contestInputs)
  const finalRating = combineRating(practiceRating, contestRating, weights)

  return {
    practiceRating,
    contestRating,
    finalRating,
    title: finalRating != null ? titleForRating(finalRating).title : null,
    color: finalRating != null ? titleForRating(finalRating).color : null,
    acCount: attempts.filter((a) => a.isAc).length,
    attemptCount: attempts.length,
    accuracy: attempts.length > 0 ? Number(((attempts.filter((a) => a.isAc).length / attempts.length) * 100).toFixed(1)) : null,
    luogu: luoguInfo,
    leetcode: lcInfo
  }
}

/**
 * 重算并写入历史（rating:recalc）。
 */
export function recalcRating(repos: Repos, source: 'manual' | 'auto' = 'auto'): {
  breakdown: RatingBreakdown
  history: RatingSnapshot[]
} {
  const breakdown = computeRatingBreakdown(repos)
  if (breakdown.finalRating != null) {
    repos.rating.insert(breakdown.finalRating, source === 'manual' ? 'manual' : 'practice')
  }
  return { breakdown, history: repos.rating.history() }
}
