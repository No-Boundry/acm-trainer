import type { ProblemsRepo } from '../db/repositories/problems'
import type { RecordsRepo } from '../db/repositories/records'
import { AppError } from '../db/errors'

/**
 * 洛谷用户做题记录导入（v1.2 FR-8.9）。
 * 纯函数（解析/映射/编排）可单测；HTTP 层注入（登录态抓取走 Electron session，见 ipc）。
 */

export interface LuoguUserPractice {
  /** UID（在线解析可得；纯文本扫描时未知） */
  uid?: number
  name?: string
  /** 通过题目 pid（去重、保序） */
  passedPids: string[]
  /** 通过题目计数（解析可得时） */
  passedProblemCount: number | null
}

/** 洛谷 P 题号扫描正则：P + 4~6 位数字，前后不为字母数字（避免误匹配其他文本） */
const PID_RE = /(?<![A-Za-z0-9])P\d{4,6}(?![A-Za-z0-9])/g

/**
 * 从任意输入文本直接扫描洛谷 P 题号（v1.2.1 用户需求调整）：
 * 支持洛谷个人主页文字、题号列表、HTML 源码、JSON 等任意含 P 题号的文本。
 * 去重保序返回。
 */
export function scanPidsFromText(text: string): string[] {
  if (!text) return []
  const raw = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const out: string[] = []
  const seen = new Set<string>()
  let m: RegExpExecArray | null
  PID_RE.lastIndex = 0
  while ((m = PID_RE.exec(raw)) !== null) {
    const pid = m[0]
    if (!seen.has(pid)) {
      seen.add(pid)
      out.push(pid)
    }
  }
  return out
}

/** 从文本构建导入输入（UID 不可知时为 undefined） */
export function buildPracticeFromText(text: string): LuoguUserPractice {
  const pids = scanPidsFromText(text)
  if (pids.length === 0) {
    throw new AppError('VALIDATION', '未在输入文本中识别到洛谷 P 题号（如 P1000）。请粘贴包含题号的内容：洛谷个人主页文字、题号列表、或网页源码均可')
  }
  return { passedPids: pids, passedProblemCount: pids.length }
}

/** 用户页/数据中的 passedProblems 条目形态 */
interface PassedProblemItem {
  pid?: string
  difficulty?: unknown
  type?: string
}

/** 洛谷用户页 JSON 结构（解析目标形态） */
interface LuoguUserJson {
  currentData?: {
    user?: {
      uid?: number
      name?: string
      passedProblemCount?: number | null
      passedProblems?: PassedProblemItem[] | null
    } | null
  }
}

/** 登录提示错误码 */
export const LUOGU_LOGIN_REQUIRED = 'LUOGU_LOGIN_REQUIRED'

/** 判定是否登录墙/验证页（洛谷匿名挑战页标题特征） */
export function isLuoguChallengePage(html: string): boolean {
  return html.includes('Welcome - Luogu') || html.includes('Spilopelia')
}

/**
 * 解析洛谷用户练习数据（三种输入形态）：
 * 1. `?_contentOnly=1` 裸 JSON：{ currentData: { user: { uid, name, passedProblemCount, passedProblems } } }
 * 2. 用户页 HTML（内嵌 script JSON，与列表页同构提取）
 * 3. 直接粘贴的完整 JSON（同形态 1）
 * 登录墙/数据缺失 → AppError(LUOGU_LOGIN_REQUIRED)
 */
export function parseLuoguUserPractice(text: string): LuoguUserPractice {
  const raw = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const trimmed = raw.trim()

  let parsed: LuoguUserJson

  // 形态 1/3：直接 JSON
  if (trimmed.startsWith('{')) {
    try {
      parsed = JSON.parse(trimmed) as LuoguUserJson
    } catch {
      parsed = {}
    }
  } else {
    // 形态 2：HTML → 找内嵌 JSON script 块
    parsed = extractFromHtml(raw)
  }

  const user = parsed?.currentData?.user
  if (!user) {
    throw new AppError(LUOGU_LOGIN_REQUIRED, '未获取到用户数据：请先在应用内登录洛谷，或确认目标用户公开了练习数据')
  }
  const uid = user.uid
  if (typeof uid !== 'number') {
    throw new AppError('LUOGU_PARSE_FAILED', '洛谷用户数据缺少 uid（解析失败）')
  }

  const passedProblems = Array.isArray(user.passedProblems) ? user.passedProblems : null
  if (passedProblems === null) {
    // 登录但未公开/无数据：uid=1 匿名场景返回 null 字段
    throw new AppError(
      LUOGU_LOGIN_REQUIRED,
      '目标用户未公开做题记录（passedProblems 不可见），请确认其在洛谷「个人设置-隐私」中公开了练习情况'
    )
  }
  const pids: string[] = []
  const seen = new Set<string>()
  for (const item of passedProblems) {
    const pid = item?.pid
    if (typeof pid === 'string' && pid.startsWith('P') && !seen.has(pid)) {
      seen.add(pid)
      pids.push(pid)
    }
  }
  return {
    uid,
    name: typeof user.name === 'string' ? user.name : `用户 ${uid}`,
    passedPids: pids,
    passedProblemCount: typeof user.passedProblemCount === 'number' ? user.passedProblemCount : pids.length
  }
}

function tryParseJson(text: string): LuoguUserJson | null {
  try {
    const p = JSON.parse(text) as LuoguUserJson
    if (p && typeof p === 'object' && 'currentData' in p) return p
  } catch {
    // 尝试实体反转义后再解析
    try {
      const decoded = unescapeHtmlEntities(text)
      const p2 = JSON.parse(decoded) as LuoguUserJson
      if (p2 && typeof p2 === 'object' && 'currentData' in p2) return p2
    } catch {
      // 均失败
    }
  }
  return null
}

/** HTML 实体与 JS 转义反转义（洛谷页面 script 内 JSON 可能被转义） */
function unescapeHtmlEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\\\//g, '/')
}

function extractFromHtml(html: string): LuoguUserJson {
  const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/g
  let m: RegExpExecArray | null
  while ((m = scriptRe.exec(html)) !== null) {
    const body = m[1].trim()
    // 形态 A：script 内直接是 JSON（可能被 HTML 实体转义）
    if (body.startsWith('{')) {
      const parsed = tryParseJson(body)
      if (parsed) return parsed
    }
    // 形态 B：window._feIni = JSON.parse("...")
    const pm = body.match(/window\._feIni\s*=\s*JSON\.parse\("([\s\S]*?)"\)/)
    if (pm) {
      const unescaped = pm[1]
        .replace(/\\"/g, '"')
        .replace(/\\\//g, '/')
        .replace(/\\\\/g, '\\')
      const parsed = tryParseJson(unescaped)
      if (parsed) return parsed
    }
  }
  return {}
}

export interface ImportPracticeResult {
  /** 用户信息（文本扫描时 uid=0/name='文本导入'） */
  user: { uid: number; name: string; totalPassed: number }
  /** 与本地洛谷题库匹配上的题数 */
  matched: number
  /** 新增写入记录数 */
  imported: number
  /** 已导入过而跳过数 */
  skipped: number
  /** 未在本地题库中（未同步或非 P 题） */
  unmatched: number
}

/**
 * 执行导入：pid 列表 ∩ 本地洛谷题库 → 未导入者写入 AC 记录。
 * 幂等依据 practice_records.import_source = 'luogu-import'（FR-8.9.3）。
 */
export function importLuoguPractice(
  problemsRepo: ProblemsRepo,
  recordsRepo: RecordsRepo,
  practice: LuoguUserPractice
): ImportPracticeResult {
  const result: ImportPracticeResult = {
    user: {
      uid: practice.uid ?? 0,
      name: practice.name ?? '文本导入',
      totalPassed: practice.passedProblemCount ?? practice.passedPids.length
    },
    matched: 0,
    imported: 0,
    skipped: 0,
    unmatched: practice.passedPids.length
  }

  const marker = 'luogu-import'
  const noteUid = practice.uid != null && practice.uid > 0 ? `洛谷导入 UID:${practice.uid}` : '洛谷导入'
  for (const pid of practice.passedPids) {
    const problem = problemsRepo.getById(pid)
    if (!problem || problem.source !== 'luogu') {
      continue // 未在本地题库
    }
    result.unmatched -= 1
    result.matched += 1
    if (recordsRepo.hasImport(pid, marker)) {
      result.skipped += 1
      continue
    }
    recordsRepo.create({
      problemId: pid,
      status: 'AC',
      note: noteUid,
      isMistake: false,
      importSource: marker
    })
    result.imported += 1
  }
  return result
}
