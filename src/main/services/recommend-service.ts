import type { Repos } from './index'
import type {
  FreshOrder,
  PracticedOrder,
  ProblemRow,
  RecommendInput,
  RecommendResult,
  SkillNodeReport,
  TagUsage
} from '@shared/types'
import { FRESH_ORDER_LABELS, PRACTICED_ORDER_LABELS } from '@shared/types'
import { buildRecommendation, dueReviewSet, knowledgeFilterTags } from './recommend'
import { localDate } from './review'
import { buildSkillReport } from './skill'

/**
 * 首页推荐习题 / 已练习标签的服务层（v1.14 FR-31~FR-33）。
 *
 * 职责：把数据库取数（题库全量、练习记录、技能报告、题单归属、复习状态）喂给纯函数
 * services/recommend.ts。排序与理由文案全部在纯函数里，便于单测。
 */

/** 单次取页上限（与 ProblemsRepo.list 的 200 钳制一致） */
const PAGE = 200
/** 全库取数上限（当前三源合计约 3.2 万，留足余量；超出时推荐范围截断而非报错） */
const FULL_SCAN_LIMIT = 60000
/** 全库精简题的缓存时长（题库同步会改变 count / lastSync，自动失效） */
const LEAN_TTL_MS = 5 * 60_000

let leanCache: { key: string; rows: ProblemRow[]; at: number } | null = null

/** 题库版本号：数量 + 各源最近同步时间，任一变化即视为数据更新 */
function libraryKey(repos: Repos): string {
  const s = repos.problems.lastSync()
  return `${repos.problems.count()}|${s.cf ?? ''}|${s.luogu ?? ''}|${s.leetcode ?? ''}`
}

/**
 * 全库题目（精简列 + 5 分钟缓存）。
 *
 * v1.14.1 性能修复：原先用 `repos.problems.list()` 每页 200 翻 160 页，实测 **9.0 秒**，
 * 而 better-sqlite3 是同步 API → 主进程被占死，表现为「启动明显变慢」「首页跳题库卡顿」。
 * 改为单条精简 SQL（约 83 ms）并加缓存：反复进出首页 / 换一批基本 0 开销。
 */
export function allProblems(repos: Repos): ProblemRow[] {
  const key = libraryKey(repos)
  const now = Date.now()
  if (leanCache && leanCache.key === key && now - leanCache.at < LEAN_TTL_MS) return leanCache.rows
  const total = repos.problems.count()
  // 数据量超出扫描上限时退回分页取（极端情况兜底，正常不会走到）
  const rows =
    total <= FULL_SCAN_LIMIT
      ? repos.problems.leanAll()
      : (() => {
          const out: ProblemRow[] = []
          const pages = Math.ceil(FULL_SCAN_LIMIT / PAGE)
          for (let page = 1; page <= pages; page++) {
            const r = repos.problems.list({ page, pageSize: PAGE, source: 'all' })
            out.push(...r.items)
            if (r.items.length === 0) break
          }
          return out
        })()
  leanCache = { key, rows, at: now }
  return rows
}

/** 技能报告节点（复用 services/skill 的聚合，避免重复实现掌握度判定） */
function reportNodes(repos: Repos): SkillNodeReport[] {
  return buildSkillReport(repos).nodes
}

/**
 * v1.14 FR-33.3/33.5/33.9：把设置项合并进请求。
 * 请求里显式给出的字段优先（例如「换一批」可临时改条数），否则用设置值，最后回落到默认值。
 * 非法值（历史脏数据/手改 DB）一律丢弃回落默认，避免界面显示一个不存在的排序口径。
 */
export function mergeRecommendSettings(
  settings: Record<string, string>,
  input: RecommendInput = {}
): RecommendInput {
  const practicedOrder = (input.practicedOrder ??
    (settings.recommendOrderPracticed as PracticedOrder | undefined)) as string | undefined
  const freshOrder = (input.freshOrder ?? (settings.recommendOrderFresh as FreshOrder | undefined)) as
    | string
    | undefined
  const pickOrder = <T extends string>(v: string | undefined, allowed: Record<string, string>): T | undefined =>
    v && Object.prototype.hasOwnProperty.call(allowed, v) ? (v as T) : undefined
  const clampLimit = (raw: unknown): number | undefined => {
    const n = Math.round(Number(raw))
    if (!Number.isFinite(n) || n <= 0) return undefined
    return Math.max(1, Math.min(30, n))
  }
  return {
    ...input,
    practicedOrder: pickOrder<PracticedOrder>(practicedOrder, PRACTICED_ORDER_LABELS),
    freshOrder: pickOrder<FreshOrder>(freshOrder, FRESH_ORDER_LABELS),
    practicedLimit: clampLimit(input.practicedLimit) ?? clampLimit(settings.recommendPracticedLimit),
    freshLimit: clampLimit(input.freshLimit) ?? clampLimit(settings.recommendFreshLimit)
  }
}

/**
 * 推荐结果缓存（v1.14.1 性能）。
 *
 * `buildRecommendation` 要对题库全集（3.17 万题）做筛后排序，实测约 200 ms；即使全库数据已缓存，
 * 反复进出首页仍会重算。这里把「题库版本 + 记录数 + 设置 + 请求参数」作为 key 缓存结果，
 * 回到首页/切换页面基本 0 开销。数据一变（同步、新增记录、改设置）key 就变，自动失效。
 * 「随机换一批」每次都要新结果，故不缓存。
 */
const resultCache = new Map<string, { at: number; result: RecommendResult }>()

/** 参数稳定序列化（数组排序，避免 [a,b] 与 [b,a] 各算一遍） */
function stableInputKey(input: RecommendInput): string {
  const norm: Record<string, unknown> = { ...input }
  for (const k of ['filterTags', 'knowledgeIds']) {
    const v = norm[k]
    if (Array.isArray(v)) norm[k] = [...v].sort()
  }
  return JSON.stringify(norm)
}

/** 推荐（主入口） */
export function recommendProblems(repos: Repos, input: RecommendInput = {}): RecommendResult {
  const problems = allProblems(repos)
  // v1.14.1：records.all() 而非 list({pageSize:1e5})——后者被 200 钳制静默截断
  const records = repos.records.all()
  // v1.14：排序方式与条数来自设置（此前漏读，导致设置页改了首页不生效）
  const effective = mergeRecommendSettings(repos.settings.getAll(), input)

  const cacheable = effective.freshOrder !== 'random'
  const cacheKey = cacheable
    ? `${libraryKey(repos)}|${records.length}|${stableInputKey(effective)}`
    : ''
  if (cacheable) {
    const hit = resultCache.get(cacheKey)
    if (hit && Date.now() - hit.at < LEAN_TTL_MS) return hit.result
  }

  const nodes = reportNodes(repos)
  const namesOf = repos.lists.listNamesByProblem()
  const due = dueReviewSet(repos.lists.reviewEntries(), localDate())
  const result = buildRecommendation(
    {
      problems,
      records: records.map((r) => ({
        problemId: r.problemId,
        status: r.status,
        createdAt: r.createdAt
      })),
      nodes,
      listNamesOf: (pid) => namesOf.get(pid) ?? [],
      dueReviewIds: due
    },
    effective
  )
  if (cacheable) {
    if (resultCache.size > 30) resultCache.clear()
    resultCache.set(cacheKey, { at: Date.now(), result })
  }
  return result
}

/**
 * v1.14 FR-32：已练习标签统计。
 * @param knowledgeIds 只统计这些知识点的关联标签（空 = 全部知识点标签）
 *
 * v1.14.1：聚合 SQL 实测约 113 ms（574 标签 × 3.17 万题关联），按「题库版本 + 记录数 + 标签集」
 * 缓存 5 分钟，避免每次进首页/技能树都重算。
 */
const tagUsageCache = new Map<string, { at: number; rows: TagUsage[] }>()

export function practicedTags(repos: Repos, knowledgeIds: string[] = []): TagUsage[] {
  const nodes = reportNodes(repos)
  const wanted = new Set<string>()
  if (knowledgeIds.length > 0) {
    for (const t of knowledgeFilterTags(nodes, knowledgeIds)) wanted.add(t)
  } else {
    for (const n of nodes) for (const t of n.tags) wanted.add(t)
  }
  const tags = [...wanted]
  if (tags.length === 0) return []
  const key = `${libraryKey(repos)}|${repos.records.count()}|${tags.slice().sort().join(',')}`
  const now = Date.now()
  const hit = tagUsageCache.get(key)
  if (hit && now - hit.at < LEAN_TTL_MS) return hit.rows
  const rows = repos.problems
    .tagUsage(tags)
    .sort(
      (a, b) =>
        Number(b.acProblems > 0) - Number(a.acProblems > 0) ||
        b.acProblems - a.acProblems ||
        a.tag.localeCompare(b.tag)
    )
  // 只留最近 20 组，避免切换知识点时无限增长
  if (tagUsageCache.size > 20) tagUsageCache.clear()
  tagUsageCache.set(key, { at: now, rows })
  return rows
}
