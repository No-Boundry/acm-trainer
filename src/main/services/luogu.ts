import type { ProblemUpsertInput, SyncProgress } from '@shared/types'
import type { ProblemsRepo } from '../db/repositories/problems'
import { AppError } from '../db/errors'
import { formatLocalSqlite } from './cf'

/**
 * 洛谷数据源同步（docs/03 §9，FR-8）。
 * 纯函数 + 可注入抓取器：解析/映射/编排均可单测；
 * 实际 HTTP 走 Electron session（Chromium 网络栈，见 ipc/luogu.ts）。
 */

export interface LuoguPageProblem {
  pid: string
  type: string
  name: string
  difficulty: number | null
  tags: number[]
  totalSubmit?: number
  totalAccepted?: number
}

export interface LuoguListData {
  count: number
  perPage: number
  result: LuoguPageProblem[]
}

export interface LuoguTagItem {
  id: number
  name: string
  type?: number
}

export interface LuoguFetchers {
  fetchPage: (page: number) => Promise<LuoguListData>
  fetchTags: () => Promise<Map<number, string>>
}

/** 去除 UTF-8 BOM（防御从文件/非标准响应读取的内容） */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/**
 * 从洛谷题库列表页 HTML 提取内嵌 JSON（"instance":"main" 数据块）。
 * 兼容两种形态：<script>{...}</script> 直接 JSON，或 window._feIni = JSON.parse("...")。
 */
export function extractLuoguListJson(rawHtml: string): LuoguListData {
  const html = stripBom(rawHtml)
  const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/g
  let m: RegExpExecArray | null
  while ((m = scriptRe.exec(html)) !== null) {
    const body = m[1].trim()
    // 形态 A：直接 JSON 文本
    if (body.startsWith('{')) {
      const data = tryParseProblems(body)
      if (data) return data
    }
    // 形态 B：window._feIni = JSON.parse("...")
    const pm = body.match(/window\._feIni\s*=\s*JSON\.parse\("([\s\S]*?)"\)/)
    if (pm) {
      const unescaped = pm[1]
        .replace(/\\"/g, '"')
        .replace(/\\\//g, '/')
        .replace(/\\\\/g, '\\')
      const data = tryParseProblems(unescaped)
      if (data) return data
    }
  }
  throw new AppError('LUOGU_PARSE_FAILED', '洛谷列表页解析失败（页面结构可能已变化）')
}

function tryParseProblems(text: string): LuoguListData | null {
  try {
    const parsed = JSON.parse(text) as {
      data?: { problems?: LuoguListData }
    }
    const problems = parsed?.data?.problems
    if (problems && Array.isArray(problems.result) && typeof problems.count === 'number') {
      return problems
    }
  } catch {
    // 尝试下一个 script 块
  }
  return null
}

/** 洛谷 tag 字典（/_lfe/tags/zh-CN）→ id→中文名 */
export function parseLuoguTags(rawText: string): Map<number, string> {
  const text = stripBom(rawText)
  let parsed: { tags?: unknown }
  try {
    parsed = JSON.parse(text) as { tags?: unknown }
  } catch {
    throw new AppError('LUOGU_PARSE_FAILED', '洛谷标签数据解析失败')
  }
  if (!Array.isArray(parsed.tags)) {
    throw new AppError('LUOGU_PARSE_FAILED', '洛谷标签数据格式异常')
  }
  const map = new Map<number, string>()
  for (const t of parsed.tags as LuoguTagItem[]) {
    if (t && typeof t.id === 'number' && typeof t.name === 'string') {
      map.set(t.id, t.name)
    }
  }
  return map
}

/** 列表页数据 → 入库输入（洛谷行：contestId=0，index=pid，id='Pxxxx'） */
export function mapLuoguToUpsert(
  data: LuoguListData,
  tagMap: Map<number, string>
): ProblemUpsertInput[] {
  return data.result.map((p) => ({
    contestId: 0,
    index: p.pid,
    name: p.name,
    rating: null,
    difficulty: p.difficulty ?? null,
    solvedCount: p.totalAccepted ?? 0,
    totalSubmit: p.totalSubmit ?? 0,
    source: 'luogu',
    tags: (p.tags ?? [])
      .map((id) => tagMap.get(id))
      .filter((x): x is string => x !== undefined)
  }))
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * 全量同步洛谷 P 题：标签 → 首页（取总数）→ 逐页拉取 → 事务 upsert。
 * @param delayMs 页间限速（礼貌抓取）
 */
export async function syncLuoguProblemset(
  repo: ProblemsRepo,
  onProgress: (p: SyncProgress) => void,
  fetchers: LuoguFetchers,
  delayMs = 250
): Promise<{ added: number; updated: number; fetchedAt: string; totalPages: number }> {
  onProgress({ stage: 'fetching', percent: 0, message: '正在拉取洛谷题库（分页抓取，约 3–5 分钟）…' })
  const tagMap = await fetchers.fetchTags()
  onProgress({ stage: 'fetching', percent: 4, message: `标签映射就绪（${tagMap.size} 个），开始拉取…` })

  const first = await fetchers.fetchPage(1)
  const totalPages = Math.max(1, Math.ceil(first.count / Math.max(1, first.perPage || 50)))
  const inputs: ProblemUpsertInput[] = mapLuoguToUpsert(first, tagMap)

  for (let page = 2; page <= totalPages; page++) {
    onProgress({
      stage: 'fetching',
      percent: 4 + Math.round(((page - 1) / totalPages) * 86),
      message: `正在拉取第 ${page}/${totalPages} 页…`
    })
    const data = await fetchers.fetchPage(page)
    inputs.push(...mapLuoguToUpsert(data, tagMap))
    await sleep(delayMs)
  }

  onProgress({
    stage: 'writing',
    percent: 92,
    message: `拉取完成（共 ${inputs.length} 道 P 题），正在写入本地库…`
  })
  const fetchedAt = formatLocalSqlite(new Date())
  const { added, updated } = repo.upsertMany(inputs, fetchedAt)
  onProgress({ stage: 'writing', percent: 100, message: '洛谷同步完成' })
  return { added, updated, fetchedAt, totalPages }
}
