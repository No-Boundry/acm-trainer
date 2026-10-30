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

/** 题库全量（带 practiced / lastStatus 派生字段） */
export function allProblems(repos: Repos): ProblemRow[] {
  const total = Math.min(repos.problems.count(), FULL_SCAN_LIMIT)
  const pages = Math.max(1, Math.ceil(total / PAGE))
  const out: ProblemRow[] = []
  for (let page = 1; page <= pages; page++) {
    const r = repos.problems.list({ page, pageSize: PAGE, source: 'all' })
    out.push(...r.items)
    if (r.items.length === 0) break
  }
  return out
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

/** 推荐（主入口） */
export function recommendProblems(repos: Repos, input: RecommendInput = {}): RecommendResult {
  const problems = allProblems(repos)
  const records = repos.records.list({ page: 1, pageSize: 100000 }).items
  const nodes = reportNodes(repos)
  const namesOf = repos.lists.listNamesByProblem()
  const due = dueReviewSet(repos.lists.reviewEntries(), localDate())
  // v1.14：排序方式与条数来自设置（此前漏读，导致设置页改了首页不生效）
  const effective = mergeRecommendSettings(repos.settings.getAll(), input)
  return buildRecommendation(
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
}

/**
 * v1.14 FR-32：已练习标签统计。
 * @param knowledgeIds 只统计这些知识点的关联标签（空 = 全部知识点标签）
 */
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
  return repos.problems
    .tagUsage(tags)
    .sort(
      (a, b) =>
        Number(b.acProblems > 0) - Number(a.acProblems > 0) ||
        b.acProblems - a.acProblems ||
        a.tag.localeCompare(b.tag)
    )
}
