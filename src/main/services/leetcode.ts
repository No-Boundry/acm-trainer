import type { ProblemUpsertInput, SyncProgress } from '@shared/types'
import type { ProblemsRepo } from '../db/repositories/problems'
import { AppError } from '../db/errors'
import { formatLocalSqlite } from './cf'

/**
 * 力扣数据源同步（docs/03 §18，v1.9 FR-21）。
 *
 * 数据来源（leetcode.cn，leetcode.com 在国内网络不可达）：
 * 1) `GET /api/problems/algorithms/`：一次拿到全部算法题（约 3900 道）的中文标题、
 *    难度（level 1/2/3）、AC 数 / 提交数（唯一的全量出口）；
 * 2) `POST /graphql/` `problemsetQuestionList`：分页（上限 100/页）取中文标签
 *    （topicTags.nameTranslated）。REST 接口不带标签，故两者按 titleSlug 合并。
 *
 * 纯函数 + 可注入抓取器：解析/映射/编排均可单测；实际 HTTP 走 Electron net（见 ipc/leetcode.ts）。
 */

export const LEETCODE_LIST_URL = 'https://leetcode.cn/api/problems/algorithms/'
export const LEETCODE_GRAPHQL_URL = 'https://leetcode.cn/graphql/'
export const LEETCODE_PAGE_SIZE = 100

export interface LeetcodeListItem {
  /** 题号（'1' / 'LCR 001' / '面试题 01.01'） */
  frontendId: string
  /** titleSlug，唯一，用于 URL 与入库 index */
  slug: string
  /** 中文标题 */
  title: string
  /** 难度 1=简单 2=中等 3=困难（异常值回落 null） */
  difficulty: number | null
  solvedCount: number
  totalSubmit: number
  paidOnly: boolean
}

interface RawStatItem {
  stat?: {
    question__title?: unknown
    question__title_slug?: unknown
    frontend_question_id?: unknown
    total_acs?: unknown
    total_submitted?: unknown
  }
  difficulty?: { level?: unknown } | null
  paid_only?: unknown
}

function toInt(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : fallback
}

/**
 * 解析 `/api/problems/algorithms/` 响应。
 * 结构：{ num_total, stat_status_pairs: [{ stat: {...}, difficulty: { level } }] }
 */
export function parseLeetcodeList(jsonText: string): LeetcodeListItem[] {
  let parsed: { stat_status_pairs?: unknown }
  try {
    parsed = JSON.parse(jsonText) as { stat_status_pairs?: unknown }
  } catch {
    throw new AppError('LEETCODE_PARSE_FAILED', '力扣题库列表解析失败（返回内容不是 JSON）')
  }
  const pairs = parsed.stat_status_pairs
  if (!Array.isArray(pairs)) {
    throw new AppError('LEETCODE_PARSE_FAILED', '力扣题库列表结构异常（缺少 stat_status_pairs）')
  }
  const out: LeetcodeListItem[] = []
  for (const raw of pairs as RawStatItem[]) {
    const stat = raw?.stat
    const slug = typeof stat?.question__title_slug === 'string' ? stat.question__title_slug.trim() : ''
    if (!slug) continue
    const title = typeof stat?.question__title === 'string' ? stat.question__title.trim() : ''
    const frontendRaw = stat?.frontend_question_id
    const frontendId =
      typeof frontendRaw === 'string' || typeof frontendRaw === 'number'
        ? String(frontendRaw).trim()
        : slug
    const level = toInt(raw?.difficulty?.level, 0)
    out.push({
      frontendId: frontendId || slug,
      slug,
      title: title || slug,
      difficulty: level >= 1 && level <= 3 ? level : null,
      solvedCount: toInt(stat?.total_acs),
      totalSubmit: toInt(stat?.total_submitted),
      paidOnly: raw?.paid_only === true
    })
  }
  if (out.length === 0) {
    throw new AppError('LEETCODE_PARSE_FAILED', '力扣题库列表为空（接口结构可能已变化）')
  }
  return out
}

/** 构造题库标签分页查询（GraphQL，limit 上限 100/页，靠 hasMore 结束）
 *  同时取 titleCn：leetcode.cn 的 REST 全量接口对部分题返回英文标题，中文标题只在 GraphQL 侧。 */
export function buildTagPageQuery(skip: number, limit: number = LEETCODE_PAGE_SIZE): string {
  return `query problemsetQuestionList($categorySlug: String, $limit: Int, $skip: Int, $filters: QuestionListFilterInput) {
  problemsetQuestionList(categorySlug: $categorySlug, limit: $limit, skip: $skip, filters: $filters) {
    hasMore
    total
    questions {
      titleSlug
      title
      titleCn
      topicTags { slug name nameTranslated }
    }
  }
}`
}

export interface LeetcodeTagPage {
  /** slug → 中文标签（去重、去空） */
  tags: Map<string, string[]>
  /** slug → 中文标题（titleCn，缺失时回落到英文 title） */
  titles: Map<string, string>
  total: number | null
  hasMore: boolean
}

/** 解析标签分页响应；结构异常时抛错（调用方可重试） */
export function parseTagPage(jsonText: string): LeetcodeTagPage {
  let parsed: {
    data?: {
      problemsetQuestionList?: {
        hasMore?: unknown
        total?: unknown
        questions?: unknown
      }
    }
    errors?: { message?: string }[]
  }
  try {
    parsed = JSON.parse(jsonText) as typeof parsed
  } catch {
    throw new AppError('LEETCODE_PARSE_FAILED', '力扣标签数据解析失败（返回内容不是 JSON）')
  }
  if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
    const msg = parsed.errors.map((e) => e?.message ?? '').filter(Boolean).join('; ')
    throw new AppError('LEETCODE_PARSE_FAILED', `力扣标签接口报错: ${msg || '未知错误'}`)
  }
  const node = parsed.data?.problemsetQuestionList
  if (!node || !Array.isArray(node.questions)) {
    throw new AppError('LEETCODE_PARSE_FAILED', '力扣标签数据结构异常（缺少 questions）')
  }
  const tags = new Map<string, string[]>()
  const titles = new Map<string, string>()
  for (const q of node.questions as {
    titleSlug?: unknown
    title?: unknown
    titleCn?: unknown
    topicTags?: { name?: unknown; nameTranslated?: unknown }[] | null
  }[]) {
    const slug = typeof q?.titleSlug === 'string' ? q.titleSlug.trim() : ''
    if (!slug) continue
    const names: string[] = []
    for (const t of q?.topicTags ?? []) {
      const zh = typeof t?.nameTranslated === 'string' ? t.nameTranslated.trim() : ''
      const en = typeof t?.name === 'string' ? t.name.trim() : ''
      const name = zh || en
      if (name && !names.includes(name)) names.push(name)
    }
    tags.set(slug, names)
    const cn = typeof q?.titleCn === 'string' ? q.titleCn.trim() : ''
    const en = typeof q?.title === 'string' ? q.title.trim() : ''
    const title = cn || en
    if (title) titles.set(slug, title)
  }
  return {
    tags,
    titles,
    total: typeof node.total === 'number' ? node.total : null,
    hasMore: node.hasMore === true
  }
}

/**
 * 列表 + 标签 + 中文标题 → 入库输入。
 * leetcode 行：contestId=0、index=titleSlug、difficulty=1-3、rating=null；
 * 名称优先用 GraphQL 的 titleCn（中文），缺失时用 REST 标题。
 */
export function mapLeetcodeToUpsert(
  list: LeetcodeListItem[],
  tagMap: Map<string, string[]>,
  titleMap: Map<string, string> = new Map()
): ProblemUpsertInput[] {
  return list.map((p) => ({
    contestId: 0,
    index: p.slug,
    name: titleMap.get(p.slug) ?? p.title,
    rating: null,
    difficulty: p.difficulty,
    solvedCount: p.solvedCount,
    totalSubmit: p.totalSubmit,
    source: 'leetcode',
    frontendId: p.frontendId,
    tags: tagMap.get(p.slug) ?? []
  }))
}

export interface LeetcodeFetchers {
  fetchList: () => Promise<string>
  fetchTagPage: (skip: number, limit: number) => Promise<string>
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * 全量同步力扣算法题：列表（1 次）→ 标签分页（约 40 次）→ 事务 upsert。
 * @param delayMs 页间限速（礼貌抓取）
 */
export async function syncLeetcodeProblemset(
  repo: ProblemsRepo,
  onProgress: (p: SyncProgress) => void,
  fetchers: LeetcodeFetchers,
  delayMs = 200
): Promise<{
  added: number
  updated: number
  fetchedAt: string
  totalPages: number
  total: number
  paidCount: number
}> {
  onProgress({ stage: 'fetching', percent: 0, message: '正在拉取力扣题库列表（算法题）…' })
  const list = parseLeetcodeList(await fetchers.fetchList())
  const paidCount = list.filter((p) => p.paidOnly).length
  onProgress({
    stage: 'fetching',
    percent: 5,
    message: `列表就绪（${list.length} 道，含会员题 ${paidCount} 道），开始拉取标签…`
  })

  const tagMap = new Map<string, string[]>()
  const titleMap = new Map<string, string>()
  const totalPages = Math.max(1, Math.ceil(list.length / LEETCODE_PAGE_SIZE))
  for (let page = 0; page < totalPages; page++) {
    const skip = page * LEETCODE_PAGE_SIZE
    onProgress({
      stage: 'fetching',
      percent: 5 + Math.round((page / totalPages) * 85),
      message: `正在拉取标签第 ${page + 1}/${totalPages} 页…`
    })
    const parsed = parseTagPage(await fetchers.fetchTagPage(skip, LEETCODE_PAGE_SIZE))
    for (const [slug, names] of parsed.tags) tagMap.set(slug, names)
    for (const [slug, title] of parsed.titles) titleMap.set(slug, title)
    if (!parsed.hasMore) break
    await sleep(delayMs)
  }

  const inputs = mapLeetcodeToUpsert(list, tagMap, titleMap)
  const withTags = inputs.filter((p) => p.tags.length > 0).length
  const withCnTitle = inputs.filter((p) => /[\u4e00-\u9fff]/.test(p.name)).length
  onProgress({
    stage: 'writing',
    percent: 92,
    message: `标签就绪（覆盖 ${withTags}/${inputs.length} 道，中文标题 ${withCnTitle} 道），正在写入本地库…`
  })
  const fetchedAt = formatLocalSqlite(new Date())
  const { added, updated } = repo.upsertMany(inputs, fetchedAt)
  onProgress({ stage: 'writing', percent: 100, message: '力扣同步完成' })
  return { added, updated, fetchedAt, totalPages, total: list.length, paidCount }
}
