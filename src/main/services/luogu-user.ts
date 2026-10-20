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

/** 洛谷用户页 JSON 结构（v1.2 旧版 tanuki 形态） */
interface LuoguUserJson {
  currentData?: {
    user?: {
      uid?: number
      name?: string
      passedProblemCount?: number | null
      submittedProblemCount?: number | null
      passedProblems?: PassedProblemItem[] | null
    } | null
  }
}

/** 洛谷前端改版后的内嵌数据形态（v1.11）：<script id="lentille-context" type="application/json"> */
interface LuoguLentilleJson {
  template?: string
  data?: {
    user?: {
      uid?: number
      name?: string
      passedProblemCount?: number | null
      submittedProblemCount?: number | null
      passedProblems?: PassedProblemItem[] | null
    } | null
  }
}

/** 登录提示错误码 */
export const LUOGU_LOGIN_REQUIRED = 'LUOGU_LOGIN_REQUIRED'

/** 洛谷改版后不再下发做题记录的错误码（引导用户改用文本导入） */
export const LUOGU_PRACTICE_UNAVAILABLE = 'LUOGU_PRACTICE_UNAVAILABLE'

/**
 * 判定是否登录墙/验证页。
 * v1.11 起：洛谷对**匿名者**也会返回含 `Spilopelia` 的“Soft Wall”页面（标题仍显示用户信息），
 * 因此不能只看标题标记；真正的验证页只认「Welcome - Luogu」标题或明确的验证/拦截标记。
 */
export function isLuoguChallengePage(html: string): boolean {
  if (html.includes('Welcome - Luogu')) return true
  // 明确的人机验证/拦截标记（登录后仍被拦截的场景）
  return /captcha|verify-human|人机验证|访问过于频繁|请求过于频繁/i.test(html)
}

/** 页面内嵌数据里是否带登录态用户信息（currentData.user 或 lentille data.user） */
export function pageHasUserData(html: string): boolean {
  return /"user"\s*:\s*\{[^}]*"uid"\s*:\s*\d+/.test(html) || /"_user"\s*:\s*\{/.test(html)
}

/** 是否为新版 lentille 内嵌数据页（无论是否带做题记录） */
export function isLentillePage(text: string): boolean {
  return /<script[^>]+id=["']lentille-context["']/.test(text)
}

/** 从页面中取出 lentille-context 的 JSON 对象（取不到返回 null） */
function readLentilleContext(text: string): Record<string, unknown> | null {
  const m = text.match(/<script[^>]*id=["']lentille-context["'][^>]*>([\s\S]*?)<\/script>/i)
  if (!m) return null
  try {
    const obj = JSON.parse(m[1].trim()) as Record<string, unknown>
    return obj && typeof obj === 'object' ? obj : null
  } catch {
    return null
  }
}

/** 洛谷提交记录条目（record.list 接口） */
interface LuoguRecordItem {
  status?: number
  problem?: { pid?: string; type?: string; name?: string } | null
}

/** 洛谷「通过」状态码 */
export const LUOGU_STATUS_AC = 12

/**
 * 解析洛谷提交记录页（v1.11 起 UID 在线导入的**替代数据源**）。
 * 用户页已移除 passedProblems，但提交记录页仍可用：
 * `GET /record/list?page=N&uid=<uid>&status=12` → lentille `data.records = { count, perPage, result }`
 * @returns 本页状态与 AC 题号（去重保序）
 */
export function parseLuoguRecordsPage(text: string): {
  total: number
  records: LuoguRecordItem[]
  acPids: string[]
  hasMore: boolean
} {
  const ctx = readLentilleContext(text)
  const data = (ctx?.data ?? {}) as { records?: { count?: number; result?: LuoguRecordItem[] } }
  const records = Array.isArray(data.records?.result) ? data.records!.result! : []
  if (records.length === 0 && !data.records) {
    throw new AppError('LUOGU_PARSE_FAILED', '洛谷提交记录页解析失败（页面结构可能已变化）')
  }
  const seen = new Set<string>()
  const acPids: string[] = []
  for (const r of records) {
    // 只认 AC 且为 P 题（服务端已按 status=12 过滤，这里再兜一层）
    if (typeof r.status === 'number' && r.status !== LUOGU_STATUS_AC) continue
    const pid = r.problem?.pid
    if (typeof pid === 'string' && pid.startsWith('P') && !seen.has(pid)) {
      seen.add(pid)
      acPids.push(pid)
    }
  }
  const total = typeof data.records?.count === 'number' ? data.records.count : records.length
  return { total, records, acPids, hasMore: records.length > 0 }
}

/** 用户页摘要（v1.11：只有计数，没有题目列表） */
export function parseLuoguUserSummary(text: string): {
  uid: number
  name: string
  passedProblemCount: number | null
  submittedProblemCount: number | null
} | null {
  const ctx = readLentilleContext(text)
  const user = (ctx?.data as { user?: Record<string, unknown> } | undefined)?.user
  if (!user || typeof user.uid !== 'number') return null
  return {
    uid: user.uid,
    name: typeof user.name === 'string' ? user.name : `用户 ${user.uid}`,
    passedProblemCount: typeof user.passedProblemCount === 'number' ? user.passedProblemCount : null,
    submittedProblemCount: typeof user.submittedProblemCount === 'number' ? user.submittedProblemCount : null
  }
}

/** 把新版 lentille 结构归一成旧版 currentData 形态，便于后续统一处理 */
function normalizeLentille(raw: LuoguLentilleJson): LuoguUserJson {
  return { currentData: { user: raw?.data?.user ?? null } }
}

/**
 * 解析洛谷用户练习数据（四种输入形态）：
 * 1. `?_contentOnly=1` 裸 JSON（旧版）：{ currentData: { user: { uid, name, passedProblemCount, passedProblems } } }
 * 2. 用户页 HTML（旧版）：内嵌 `window._feIni = JSON.parse("...")`
 * 3. 用户页 HTML（v1.11 改版）：`<script id="lentille-context" type="application/json">{"data":{"user":{...}}}`
 * 4. 直接粘贴的完整 JSON（任意上述形态）
 * 登录墙/数据缺失 → LUOGU_LOGIN_REQUIRED；改版后无做题记录 → LUOGU_PRACTICE_UNAVAILABLE（引导文本导入）
 */
export function parseLuoguUserPractice(text: string): LuoguUserPractice {
  const raw = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const trimmed = raw.trim()

  let parsed: LuoguUserJson

  // 形态 1/4：直接 JSON
  if (trimmed.startsWith('{')) {
    parsed = normalizeAnyJson(trimmed) ?? {}
  } else {
    // 形态 2/3：HTML → 找内嵌 JSON script 块（旧版 _feIni 优先，其次新版 lentille-context）
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

  // 匿名字段（挑战页/未登录）：passedProblems / passedProblemCount / submittedProblemCount 全空
  // → 解析器只能报「未获取到做题记录」，具体是「要登录」还是「洛谷改版」由调用方按页面特征区分
  if (user.passedProblemCount == null && user.submittedProblemCount == null && !Array.isArray(user.passedProblems)) {
    throw new AppError(
      LUOGU_LOGIN_REQUIRED,
      '未获取到做题记录：可能是未登录（请在应用内「登录洛谷」窗口完成登录）或该用户未公开练习情况。若确认已登录仍报此错，说明洛谷改版已移除该字段，请改用「粘贴文本」导入'
    )
  }

  const passedProblems = Array.isArray(user.passedProblems) ? user.passedProblems : null
  if (passedProblems === null) {
    // v1.11：洛谷改版后用户页不再内嵌 passedProblems（登录态下同样为 null，但计数字段有值）
    throw new AppError(
      LUOGU_PRACTICE_UNAVAILABLE,
      '洛谷已改版：用户页不再直接提供做题记录（passedProblems 字段已被移除），在线导入暂不可用。' +
        '请在洛谷个人主页「练习情况」复制题号列表，或用浏览器的「查看网页源代码」把源码粘贴到「粘贴文本」导入（两者的识别结果完全相同）'
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

/** 兼容两种 JSON：旧版 currentData / 新版 lentille（data.user） */
function normalizeAnyJson(text: string): LuoguUserJson | null {
  let obj: unknown
  try {
    obj = JSON.parse(text)
  } catch {
    const decoded = unescapeHtmlEntities(text)
    try {
      obj = JSON.parse(decoded)
    } catch {
      return null
    }
  }
  if (!obj || typeof obj !== 'object') return null
  const rec = obj as Record<string, unknown>
  if (rec.currentData || rec.user) return obj as LuoguUserJson
  if (rec.data) return normalizeLentille(obj as LuoguLentilleJson)
  return null
}

function tryParseJson(text: string): LuoguUserJson | null {
  const parsed = normalizeAnyJson(text)
  return parsed && 'currentData' in parsed ? parsed : null
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
  // v1.11：新版内嵌数据块 <script id="lentille-context" type="application/json">…</script>
  const lentille = html.match(
    /<script[^>]*id=["']lentille-context["'][^>]*>([\s\S]*?)<\/script>/i
  )
  if (lentille) {
    const parsed = tryParseJson(lentille[1].trim())
    if (parsed) return parsed
  }

  const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/g
  let m: RegExpExecArray | null
  while ((m = scriptRe.exec(html)) !== null) {
    const body = m[1].trim()
    // 形态 A：script 内直接是 JSON（可能被 HTML 实体转义）
    if (body.startsWith('{')) {
      const parsed = tryParseJson(body)
      if (parsed) return parsed
    }
    // 形态 B：window._feIni = JSON.parse("...")（v1.2 旧版）
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
