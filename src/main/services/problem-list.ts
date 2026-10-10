import type { ProblemSource } from '@shared/types'
import type { ProblemsRepo } from '../db/repositories/problems'

/**
 * 题单：粘贴题号文本识别 + 按知识点/难度生成（v1.10 FR-27）。
 * 解析与生成逻辑均为纯函数/薄编排，便于单测。
 */

/** 识别出的原始候选（来源 + 归一化题号） */
export interface RawCandidate {
  source: ProblemSource
  /** cf: '1741:A'；luogu: 'P1000'；leetcode: 'LC1'（与题库 id 同形） */
  id: string
}

const CF_ID_RE = /\b(?:CF[-\s]?)?(\d{1,4})\s*[:：/\\-]?\s*([A-Za-z]\d?)\b/g
const CF_URL_RE = /codeforces\.com\/(?:problemset\/problem|contest)\/(\d+)\/(?:problem\/)?([A-Za-z]\d?)/gi
const LUOGU_ID_RE = /\b(P\d{3,5})\b/gi
const LUOGU_CJK_RE = /(?:洛谷|luogu)[^\n]{0,12}?(P\d{3,5})/gi
const LUOGU_URL_RE = /luogu\.com\.cn\/problem\/(P\d{3,5})/gi
const LC_URL_RE = /leetcode\.(?:cn|com)\/problems\/([a-z0-9-]+)/gi
const LC_ID_RE = /\bLC[-\s]?([0-9]{1,4}|LCR\s?\d{1,4}|面试题\s?\d{1,2}\.\d{1,2})\b/gi

function push(list: RawCandidate[], seen: Set<string>, source: ProblemSource, id: string): void {
  const key = `${source}:${id}`
  if (seen.has(key)) return
  seen.add(key)
  list.push({ source, id })
}

/**
 * 从任意文本里识别三类题号/链接：
 * - Codeforces：`1741A` / `1741:A` / `CF 1741 A` / 题面链接
 * - 洛谷：`P1000` / 洛谷 P1000 / 题面链接
 * - 力扣：`LC1` / `LC 146` / 题面链接（按 slug 反查）
 *
 * 只做「格式识别」，是否存在于题库由调用方用 ProblemsRepo 校验。
 */
export function parseCandidatesFromText(text: string): RawCandidate[] {
  const out: RawCandidate[] = []
  const seen = new Set<string>()
  if (!text) return out

  // 链接优先（避免链接里的数字被题号规则误判）
  for (const m of text.matchAll(CF_URL_RE)) {
    push(out, seen, 'cf', `${m[1]}:${m[2].toUpperCase()}`)
  }
  for (const m of text.matchAll(LUOGU_URL_RE)) {
    push(out, seen, 'luogu', m[1].toUpperCase())
  }
  for (const m of text.matchAll(LC_URL_RE)) {
    push(out, seen, 'leetcode', `slug:${m[1].toLowerCase()}`)
  }

  for (const m of text.matchAll(LUOGU_CJK_RE)) {
    push(out, seen, 'luogu', m[1].toUpperCase())
  }
  for (const m of text.matchAll(LUOGU_ID_RE)) {
    push(out, seen, 'luogu', m[1].toUpperCase())
  }
  for (const m of text.matchAll(LC_ID_RE)) {
    const raw = m[1].replace(/\s+/g, '').toUpperCase()
    push(out, seen, 'leetcode', `LC${raw}`)
  }
  // CF 题号：要求「行内没有 P 前缀」（避免把 P1000 里的 1000 当成 CF）
  for (const m of text.matchAll(CF_ID_RE)) {
    const before = text.slice(Math.max(0, (m.index ?? 0) - 1), m.index ?? 0)
    if (before === 'P' || before === 'L') continue
    const contest = Number(m[1])
    if (contest <= 0) continue
    push(out, seen, 'cf', `${contest}:${m[2].toUpperCase()}`)
  }
  return out
}

export interface ParseIdsOutcome {
  matchedIds: string[]
  missing: string[]
}

/**
 * 把候选解析为题库中真实存在的题目 id（并按题库顺序去重）。
 * 力扣的 slug 候选需要按 index（titleSlug）反查。
 */
export function resolveCandidates(repo: ProblemsRepo, candidates: RawCandidate[]): ParseIdsOutcome {
  const matched: string[] = []
  const missing: string[] = []
  for (const c of candidates) {
    if (c.source === 'leetcode' && c.id.startsWith('slug:')) {
      const slug = c.id.slice(5)
      const found = repo.findBySlug(slug)
      if (found) matched.push(found.id)
      else missing.push(`leetcode/${slug}`)
      continue
    }
    const row = repo.getById(c.id)
    if (row) matched.push(row.id)
    else missing.push(c.id)
  }
  return { matchedIds: [...new Set(matched)], missing: [...new Set(missing)].slice(0, 50) }
}

export interface GenerateOptions {
  knowledgeTags: string[]
  count: number
  source?: 'all' | ProblemSource
  ratingMin?: number | null
  ratingMax?: number | null
  difficultyMin?: number | null
  difficultyMax?: number | null
  excludePracticed?: boolean
}

/**
 * 按知识点标签并集 + 难度区间抽题：
 * 先取候选（按难度升序，保证覆盖面），再「按难度分层轮转」抽取，
 * 避免整份题单挤在同一难度。
 */
export function pickProblemsForList(
  repo: ProblemsRepo,
  opts: GenerateOptions
): { ids: string[]; candidates: number } {
  const res = repo.list({
    page: 1,
    pageSize: 500,
    source: opts.source ?? 'all',
    tagsAny: opts.knowledgeTags,
    ratingMin: opts.ratingMin ?? null,
    ratingMax: opts.ratingMax ?? null,
    practiced: opts.excludePracticed ? 'undone' : 'all',
    sortBy: 'rating',
    sortDir: 'asc'
  })
  // 难度区间（洛谷/力扣）：在内存里再过滤一次，避免与 rating 条件互相干扰
  let items = res.items
  if (opts.difficultyMin != null || opts.difficultyMax != null) {
    items = items.filter((p) => {
      if (p.source === 'cf') return true // CF 行用 rating 过滤，不受难度区间影响
      if (p.difficulty == null) return false
      if (opts.difficultyMin != null && p.difficulty < opts.difficultyMin) return false
      if (opts.difficultyMax != null && p.difficulty > opts.difficultyMax) return false
      return true
    })
  }
  const candidates = items.length
  if (candidates === 0) return { ids: [], candidates: 0 }

  // 分层轮转：把候选按「难度键」分成若干桶，逐轮各取一道
  const bucketOf = (p: (typeof items)[number]): string => {
    if (p.source === 'cf' && p.rating != null) return `cf:${Math.floor(p.rating / 200) * 200}`
    if (p.difficulty != null) return `${p.source}:d${p.difficulty}`
    return `${p.source}:na`
  }
  const buckets = new Map<string, typeof items>()
  for (const p of items) {
    const k = bucketOf(p)
    const arr = buckets.get(k)
    if (arr) arr.push(p)
    else buckets.set(k, [p])
  }
  const keys = [...buckets.keys()].sort()
  const picked: string[] = []
  let round = 0
  while (picked.length < opts.count && round < 1000) {
    let progressed = false
    for (const k of keys) {
      const arr = buckets.get(k)!
      const item = arr[round]
      if (!item) continue
      progressed = true
      picked.push(item.id)
      if (picked.length >= opts.count) break
    }
    if (!progressed) break
    round += 1
  }
  return { ids: picked, candidates }
}
