import type {
  FreshOrder,
  PracticedOrder,
  PracticeRecord,
  PracticeState,
  ProblemRow,
  ProblemSource,
  RecommendInput,
  RecommendReason,
  RecommendResult,
  RecommendedProblem,
  SkillNodeReport,
  TagUsage
} from '@shared/types'
import { addDays, localDate } from './review'

/**
 * 首页「推荐习题」（v1.14 FR-31~FR-33）。
 *
 * 分两部分：
 * - 已练习（有练习记录的题）：默认按**遗忘曲线**排序（记忆强度越低越靠前）；
 *   支持按知识点标签筛选；同时把「恰好忘了」的题排在最前（低于临界强度即优先）；
 * - 未练习（题库中从未练习的题）：默认优先「练习中」知识点（tier = learning）内的题目，
 *   组内按**AC 数升序**（AC 数少 = 更有区分度/更该练），可在设置中改成其他方式。
 *
 * 全部为纯函数 + 一个只读仓储聚合（buildRecommendInput），便于单测。
 */

const DAY_MS = 86400000

interface PracticeEntry {
  problemId: string
  status: string
  createdAt: string
}

/** 单题练习聚合（供遗忘曲线与正确率计算） */
export interface ProblemPractice {
  problemId: string
  attempts: number
  acCount: number
  acc: number
  lastAt: string
  /** 最近一次状态 */
  lastStatus: string
  /** 距上次练习天数 */
  daysSince: number
}

function tsOf(s: string): number {
  const t = new Date(s.replace(' ', 'T')).getTime()
  return Number.isFinite(t) ? t : 0
}

function daysBetween(from: string, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - tsOf(from)) / DAY_MS))
}

/** 按题目聚合练习记录 */
export function aggregatePractice(
  records: { problemId: string; status: string; createdAt: string }[],
  now: Date = new Date()
): Map<string, ProblemPractice> {
  const map = new Map<string, ProblemPractice>()
  for (const r of records) {
    const cur = map.get(r.problemId)
    const ts = tsOf(r.createdAt)
    if (!cur) {
      map.set(r.problemId, {
        problemId: r.problemId,
        attempts: 1,
        acCount: r.status === 'AC' ? 1 : 0,
        acc: r.status === 'AC' ? 1 : 0,
        lastAt: r.createdAt,
        lastStatus: r.status,
        daysSince: daysBetween(r.createdAt, now)
      })
      continue
    }
    cur.attempts += 1
    if (r.status === 'AC') cur.acCount += 1
    cur.acc = cur.acCount / cur.attempts
    if (ts >= tsOf(cur.lastAt)) {
      cur.lastAt = r.createdAt
      cur.lastStatus = r.status
      cur.daysSince = daysBetween(r.createdAt, now)
    }
  }
  return map
}

/** 题目练习状态 */
export function practiceState(p: ProblemPractice | undefined): PracticeState {
  if (!p) return 'undone'
  return p.acCount > 0 ? 'done' : 'trying'
}

/**
 * 遗忘曲线记忆强度（0..1，越大记得越牢）。
 *
 * 采用简化的 Ebbinghaus 指数衰减：强度 = 1 / (1 + 期望复习间隔 / 2)，
 * 其中「期望复习间隔」= 1 + 2 × (AC 次数 − 1)，即 AC 越多、间隔拉得越长：
 * - 1 次 AC → 间隔 1 天 → 1 天后强度约 0.67
 * - 2 次 AC → 间隔 3 天
 * - 4 次 AC → 间隔 7 天 …（近似 1/3/7/14 的复习阶梯）
 * 未 AC 的题按 0.5 天的间隔计（更容易「忘」，优先回到列表）。
 */
export function memoryStrength(p: ProblemPractice): number {
  const interval = p.acCount > 0 ? 1 + 2 * (p.acCount - 1) : 0.5
  const half = interval / 2
  return 1 / (1 + p.daysSince / half)
}

/**
 * 遗忘曲线紧急度 = 1 − 强度（越大越该复习）。
 * > 0.5 视为「已遗忘到临界点以下」，会在推荐里置顶并给出「该复习了」的理由。
 */
export function forgettingUrgency(p: ProblemPractice): number {
  return Math.round((1 - memoryStrength(p)) * 1000) / 1000
}

const STALE_DAYS = 21

/** 已练习部分的推荐理由 */
function practicedReason(p: ProblemPractice, urgency: number): RecommendReason {
  if (urgency >= 0.5) {
    return { kind: 'due-review', text: `遗忘曲线：已 ${p.daysSince} 天没碰，建议复习` }
  }
  if (p.daysSince >= STALE_DAYS) {
    return { kind: 'stale', text: `已 ${p.daysSince} 天未练习` }
  }
  if (p.acc < 0.5) {
    return { kind: 'weak', text: `正确率 ${Math.round(p.acc * 100)}%，建议重做` }
  }
  if (p.acCount === 0) {
    return { kind: 'resume', text: `提交 ${p.attempts} 次仍未 AC，建议继续` }
  }
  return { kind: 'stale', text: `${p.daysSince} 天前练过（巩固）` }
}

/**
 * 已练习部分的排序（默认遗忘曲线）。
 *
 * forgetting：紧急度降序 → 距上次练习天数降序 → 题目 id（稳定）
 * 其他方式见 PRACTICED_ORDER_LABELS。
 */
export function sortPracticed(
  entries: { problem: ProblemRow; practice: ProblemPractice }[],
  order: PracticedOrder
): { problem: ProblemRow; practice: ProblemPractice; urgency: number }[] {
  const withU = entries.map((e) => ({ ...e, urgency: forgettingUrgency(e.practice) }))
  const byId = (a: { problem: ProblemRow }, b: { problem: ProblemRow }): number =>
    a.problem.id.localeCompare(b.problem.id)
  /**
   * 「最近练过」的判据用练习时间戳而不是 daysSince：
   * 同一天练习的两道题 daysSince 都是 0（无法区分先后），必须比较 lastAt。
   * lastAt 为空的（只有练习标记、无提交记录）视为最久远。
   */
  const lastTs = (e: { practice: ProblemPractice }): number =>
    e.practice.lastAt ? tsOf(e.practice.lastAt) : Number.MIN_SAFE_INTEGER
  switch (order) {
    case 'recent':
      // 最近练过的优先：练习时间戳降序
      return withU.sort((a, b) => lastTs(b) - lastTs(a) || b.practice.daysSince - a.practice.daysSince || byId(a, b))
    case 'stale':
      return withU.sort((a, b) => lastTs(a) - lastTs(b) || b.practice.daysSince - a.practice.daysSince || byId(a, b))
    case 'weak':
      return withU.sort((a, b) => a.practice.acc - b.practice.acc || b.practice.attempts - a.practice.attempts || byId(a, b))
    case 'difficulty':
      return withU.sort(
        (a, b) => (a.problem.rating ?? Number.MAX_SAFE_INTEGER) - (b.problem.rating ?? Number.MAX_SAFE_INTEGER) || byId(a, b)
      )
    case 'forgetting':
    default:
      return withU.sort((a, b) => b.urgency - a.urgency || b.practice.daysSince - a.practice.daysSince || byId(a, b))
  }
}

/**
 * 「练习中」知识点标签（tier = learning）。
 * 若当前没有练习中的知识点，则退回到「初学」→「未开始」→「基本掌握」，保证未练习部分总有推荐。
 */
export function learningTags(nodes: SkillNodeReport[]): { tier: string; tags: string[] } {
  const order = ['learning', 'newbie', 'untouched', 'proficient', 'master']
  for (const tier of order) {
    const tags = [...new Set(nodes.filter((n) => n.tier === tier).flatMap((n) => n.tags))]
    if (tags.length > 0) return { tier, tags }
  }
  return { tier: 'none', tags: [] }
}

/** 未练习部分的推荐理由文案 */
function freshReason(
  order: FreshOrder,
  hitNodes: string[],
  tier: string,
  inLearning = false
): RecommendReason {
  if (order === 'learning-node') {
    if (!inLearning) return { kind: 'new', text: '新题（暂不属于练习中知识点）' }
    const label =
      tier === 'learning' ? '练习中' : tier === 'newbie' ? '初学' : tier === 'untouched' ? '未开始' : '已掌握'
    return { kind: 'learning-node', text: `属于「${label}」知识点` }
  }
  const map: Record<Exclude<FreshOrder, 'learning-node'>, RecommendReason> = {
    'weak-node': { kind: 'weak', text: '最薄弱的知识点' },
    easier: { kind: 'new', text: '难度较低的新题' },
    harder: { kind: 'new', text: '挑战难度较高的新题' },
    popular: { kind: 'new', text: '热门题目（AC 数多）' },
    random: { kind: 'new', text: '随机新题' }
  }
  return map[order] ?? { kind: 'new', text: '新题' }
}

interface FreshDeps {
  /** 题库中未练习的候选（已按数据源/难度/标签粗筛） */
  candidates: ProblemRow[]
  /** 各节点的正确率（无练习记作 1，即「不薄弱」），用于 weak-node */
  nodeAcc: (nodeId: string) => number
  nodes: SkillNodeReport[]
  learning: { tier: string; tags: string[] }
  order: FreshOrder
  random?: () => number
}

/** 未练习部分排序 */
export function sortFresh(deps: FreshDeps): RecommendedProblem[] {
  const { candidates, order, nodes, learning } = deps
  const learningSet = new Set(learning.tags)
  const nodeOf = (p: ProblemRow): SkillNodeReport[] => {
    const set = new Set(p.tags)
    return nodes.filter((n) => n.tags.some((t) => set.has(t)))
  }
  const ratingOf = (p: ProblemRow): number => p.rating ?? Number.MAX_SAFE_INTEGER
  const rand = deps.random ?? Math.random
  const scored = candidates.map((p) => {
    const hit = nodeOf(p)
    const inLearning = p.tags.some((t) => learningSet.has(t))
    return { p, hit, inLearning }
  })
  /**
   * AC 数排序：`solved_count = 0` 是**数据未采集**（CF 实验场/gym 题、洛谷部分题），
   * 不代表「没人做对」。若直接按 0 排升序，这些题会集体抢到最前面，
   * 而同一场比赛里常有同名题（如 CF 1639 的 11 道 Treasure Hunt），
   * 首页「未练习」栏就会被同一道题填满。所以把 0 当成未知值排到最后。
   */
  const acOf = (p: ProblemRow): number => (p.solvedCount > 0 ? p.solvedCount : Number.MAX_SAFE_INTEGER)
  const byAc = (a: { p: ProblemRow }, b: { p: ProblemRow }): number =>
    acOf(a.p) - acOf(b.p) || ratingOf(a.p) - ratingOf(b.p) || a.p.id.localeCompare(b.p.id)

  switch (order) {
    case 'weak-node':
      scored.sort((a, b) => {
        const wa = Math.min(1, ...a.hit.map((n) => deps.nodeAcc(n.id)))
        const wb = Math.min(1, ...b.hit.map((n) => deps.nodeAcc(n.id)))
        return wa - wb || byAc(a, b)
      })
      break
    case 'easier':
      scored.sort((a, b) => ratingOf(a.p) - ratingOf(b.p) || byAc(a, b))
      break
    case 'harder':
      scored.sort((a, b) => ratingOf(b.p) - ratingOf(a.p) || byAc(a, b))
      break
    case 'popular':
      scored.sort((a, b) => b.p.solvedCount - a.p.solvedCount || byAc(a, b))
      break
    case 'random':
      scored.sort(() => rand() - 0.5)
      break
    case 'learning-node':
    default:
      // 「练习中」知识点的题优先，组内按 AC 数升序
      scored.sort((a, b) => Number(b.inLearning) - Number(a.inLearning) || byAc(a, b))
      break
  }

  return scored.map(({ p, hit, inLearning }) => {
    const knowledgeIds = hit.map((n) => n.id)
    // 「练习中知识点优先」模式下，若该题不属于练习中知识点，退化为普通新题理由
    const reason = freshReason(order, knowledgeIds, learning.tier, inLearning)
    return {
      problem: p,
      state: 'undone' as PracticeState,
      reason,
      urgency: 0,
      daysSince: null,
      knowledgeIds,
      listNames: [],
      dueReview: false
    }
  })
}

/**
 * 推荐位多样性截断（v1.15）：同一场比赛 / 同名题不占满推荐位。
 *
 * 为什么需要：题库里同一场比赛可能有多道同名题（CF 1639 有 11 道 "Treasure Hunt"），
 * 排序规则一旦让它们相邻，`slice(0, 8)` 出的 8 条就全是同一个题名，
 * 看起来像「同一道题填满了一栏」。这里按「来源+比赛」限 perContest 条、
 * 按「来源+题名」限 1 条；超额的按原顺序排到后面（**不丢弃**），
 * 既保留用户所选排序的语义，又保证首页有足够多样性。
 */
export function diversify(
  items: RecommendedProblem[],
  limit: number,
  perContest = 2
): RecommendedProblem[] {
  const contestCount = new Map<string, number>()
  const nameSeen = new Set<string>()
  const picked: RecommendedProblem[] = []
  const overflow: RecommendedProblem[] = []
  for (const it of items) {
    const p = it.problem
    const contestKey = p.contestId == null ? `${p.source}:${p.id}` : `${p.source}:c${p.contestId}`
    const nameKey = `${p.source}:${p.name}`
    const used = contestCount.get(contestKey) ?? 0
    if (used < perContest && !nameSeen.has(nameKey)) {
      contestCount.set(contestKey, used + 1)
      nameSeen.add(nameKey)
      picked.push(it)
    } else {
      overflow.push(it)
    }
  }
  return [...picked, ...overflow].slice(0, Math.max(1, limit))
}

/** 知识点筛选：把节点 id 解析成标签并集（无节点 → 空 = 不过滤） */
export function knowledgeFilterTags(nodes: SkillNodeReport[], knowledgeIds: string[]): string[] {
  if (knowledgeIds.length === 0) return []
  const set = new Set<string>()
  for (const n of nodes) if (knowledgeIds.includes(n.id)) for (const t of n.tags) set.add(t)
  return [...set]
}

/**
 * v1.14 FR-32：把「知识点 id」与「手动选取的标签」合并成最终标签过滤集。
 * 语义：节点标签并集 ∪ 手动标签；两者都为空 → 空数组 = 不过滤。
 */
export function resolveFilterTags(
  nodes: SkillNodeReport[],
  knowledgeIds: string[] = [],
  extraTags: string[] = []
): string[] {
  // filterTags 的生产者（技能树节点标签 / 题库标签列表）都已是 canonical 写法，
  // 这里原样保留即可；canonical 化在写库与查询处完成（v1.18 FR-38）。
  const set = new Set<string>(extraTags)
  for (const t of knowledgeFilterTags(nodes, knowledgeIds)) set.add(t)
  return [...set]
}

/**
 * v1.14 FR-32：某个知识点可手动选取的候选标签。
 * 返回该节点的「默认标签」与「题库中确有题目的其它标签」的合并视图，
 * 用于技能树详情面板里勾选标签再跳题库（避免点了没有任何结果）。
 */
export function nodeTagOptions(
  node: SkillNodeReport,
  usage: TagUsage[]
): { tag: string; isDefault: boolean; totalProblems: number; acProblems: number }[] {
  const byTag = new Map(usage.map((u) => [u.tag, u]))
  const out = new Map<string, { tag: string; isDefault: boolean; totalProblems: number; acProblems: number }>()
  for (const t of node.tags) {
    const u = byTag.get(t)
    out.set(t, { tag: t, isDefault: true, totalProblems: u?.totalProblems ?? 0, acProblems: u?.acProblems ?? 0 })
  }
  for (const u of usage) {
    if (out.has(u.tag)) {
      const hit = out.get(u.tag)!
      hit.totalProblems = u.totalProblems
      hit.acProblems = u.acProblems
    }
  }
  return [...out.values()].sort(
    (a, b) => Number(b.isDefault) - Number(a.isDefault) || b.totalProblems - a.totalProblems || a.tag.localeCompare(b.tag)
  )
}

/** 过滤候选：数据源 / 难度上限 / 知识点标签 */
export function passesFilters(
  p: ProblemRow,
  opts: { source?: 'all' | ProblemSource; ratingMax?: number | null; filterTags: string[] }
): boolean {
  if (opts.source && opts.source !== 'all' && p.source !== opts.source) return false
  if (opts.ratingMax != null && (p.rating ?? Number.MAX_SAFE_INTEGER) > opts.ratingMax) return false
  if (opts.filterTags.length > 0 && !p.tags.some((t) => opts.filterTags.includes(t))) return false
  return true
}

export interface BuildRecommendDeps {
  /** 全部题目（含练习状态标记，由 ProblemsRepo.list 全量取出） */
  problems: ProblemRow[]
  /** 练习记录（全量，按时间倒序或任意顺序均可） */
  records: { problemId: string; status: string; createdAt: string }[]
  /** 已练习的题目 id（practice_records.practiced 为 1：做过但可能没有单次提交记录） */
  practicedIds?: Iterable<string>
  nodes: SkillNodeReport[]
  /** 题单归属（problemId → 题单名列表） */
  listNamesOf?: (problemId: string) => string[]
  /** 到期复习的题目 id（题单间隔复习档位到期） */
  dueReviewIds?: Set<string>
  now?: Date
}

/**
 * 组装推荐结果（纯函数）。
 * 注意：problems 需包含题库全集（list 一次取全量，见 RecommendService）。
 */
export function buildRecommendation(deps: BuildRecommendDeps, input: RecommendInput): RecommendResult {
  const now = deps.now ?? new Date()
  const practicedOrder: PracticedOrder = input.practicedOrder ?? 'forgetting'
  const freshOrder: FreshOrder = input.freshOrder ?? 'learning-node'
  const filterTags = resolveFilterTags(deps.nodes, input.knowledgeIds ?? [], input.filterTags ?? [])
  const practice = aggregatePractice(deps.records, now)
  // 无逐题提交记录、但被标记为「已练习」的题（例如账号同步只写汇总）也要归入已练习部分，
  // 否则它们会永远出现在「未练习」里。这里补一条「仅标记」的聚合，天数为 null 语义 → 用较大值。
  const extraPracticed = new Set<string>()
  for (const id of deps.practicedIds ?? []) {
    if (practice.has(id)) continue
    extraPracticed.add(id)
    practice.set(id, {
      problemId: id,
      attempts: 0,
      acCount: 0,
      acc: 0,
      lastAt: '',
      lastStatus: '',
      daysSince: 999
    })
  }
  const nodeById = new Map(deps.nodes.map((n) => [n.id, n]))

  const practicedCandidates: { problem: ProblemRow; practice: ProblemPractice }[] = []
  const freshCandidates: ProblemRow[] = []
  for (const p of deps.problems) {
    if (!passesFilters(p, { source: input.source, ratingMax: input.ratingMax ?? null, filterTags })) continue
    const pr = practice.get(p.id)
    if (pr) practicedCandidates.push({ problem: p, practice: pr })
    else freshCandidates.push(p)
  }

  const practicedSorted = sortPracticed(practicedCandidates, practicedOrder)
  const practiced: RecommendedProblem[] = practicedSorted
    .slice(0, Math.max(1, Math.min(50, input.practicedLimit ?? 8)))
    .map((e) => {
      const hit = e.problem.tags
      const knowledgeIds = deps.nodes.filter((n) => n.tags.some((t) => hit.includes(t))).map((n) => n.id)
      const due = deps.dueReviewIds?.has(e.problem.id) ?? false
      const reason = due
        ? { kind: 'due-review' as const, text: '题单复习已到期' }
        : extraPracticed.has(e.problem.id)
          ? { kind: 'stale' as const, text: '已标记为练习过，暂无提交细节' }
          : practicedReason(e.practice, e.urgency)
      return {
        problem: e.problem,
        state: practiceState(e.practice),
        reason,
        urgency: due ? 1 : e.urgency,
        daysSince: e.practice.daysSince,
        knowledgeIds,
        listNames: deps.listNamesOf?.(e.problem.id) ?? [],
        dueReview: due
      }
    })
    // 只做「到期复习置顶」的稳定分区，不能整体重排 —— 否则会覆盖用户在设置里选的排序方式
    const dueFirst = practiced.filter((x) => x.dueReview)
    const restFirst = practiced.filter((x) => !x.dueReview)
    const practicedFinal = [...dueFirst, ...restFirst]

  const learning = learningTags(deps.nodes)
  const freshSorted = sortFresh({
    candidates: freshCandidates,
    nodes: deps.nodes,
    learning,
    order: freshOrder,
    nodeAcc: (nodeId) => {
      const n = nodeById.get(nodeId)
      if (!n || n.stats.attempted === 0) return 1
      return n.stats.acc ?? 1
    }
  })
  const freshLimit = Math.max(1, Math.min(50, input.freshLimit ?? 8))
  const fresh = diversify(freshSorted, freshLimit).map((r) => ({
    ...r,
    listNames: deps.listNamesOf?.(r.problem.id) ?? []
  }))

  return {
    practiced: practicedFinal,
    fresh,
    practicedOrder,
    freshOrder,
    totals: { practiced: practicedCandidates.length, fresh: freshCandidates.length },
    filterTags
  }
}

/**
 * 复习过期判定所需的最小信息（供 dueReviewIds 组装）
 */
export function dueReviewSet(
  items: { problemId: string; reviewStage: number; reviewDue: string | null }[],
  today: string = localDate()
): Set<string> {
  const out = new Set<string>()
  for (const it of items) {
    if (it.reviewStage > 0 && it.reviewDue && it.reviewDue <= today) out.add(it.problemId)
  }
  return out
}

export type { PracticeRecord }

