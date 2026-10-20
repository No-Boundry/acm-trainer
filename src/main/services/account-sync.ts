import { net } from 'electron'
import { AppError } from '../db/errors'
import type { ProblemsRepo } from '../db/repositories/problems'
import type { RecordsRepo } from '../db/repositories/records'
import { problemIdentity } from '../db/repositories/problems'
import { parseLuoguRecordsPage, parseLuoguUserSummary, pageHasUserData, isLuoguChallengePage, type LuoguUserPractice } from './luogu-user'
import { fetchInLoginWindow, isLoginWindowOpen, loginWindowHostIs, navigateLoginWindowAndWait } from './web-window'
import type { AccountPlatform } from './account-binding'

/**
 * 账号自动抓取（v1.12 FR-30）：把各平台的「通过的题目」拉回本地并写入练习记录。
 * - Codeforces：公开 API `user.status`（无需登录），按 problem 去重、verdict=OK
 * - 洛谷：需应用内登录态，`record/list?uid=&status=12` 分页（用户页 passedProblems 已被移除）
 * - 力扣：官方只提供公开资料计数（逐题 AC 列表接口已下线），故仅同步概况
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

export interface SyncResult {
  platform: AccountPlatform
  /** 展示名 */
  displayName: string
  /** 平台侧总通过数（可得时） */
  totalPassed: number | null
  /** 解析到的通过题目数（去重后） */
  matched: number
  /** 新增写入的练习记录数 */
  imported: number
  /** 已导入过而跳过 */
  skipped: number
  /** 本地题库未收录 */
  unmatched: number
  /** 力扣等仅概况同步时的提示 */
  note?: string
}

async function fetchJson(url: string): Promise<unknown> {
  let lastErr: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await net.fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
      if (!resp.ok) throw new AppError('HTTP', `HTTP ${resp.status}`)
      return (await resp.json()) as unknown
    } catch (e) {
      lastErr = e
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)))
    }
  }
  throw new AppError('ACCOUNT_FETCH_FAILED', lastErr instanceof Error ? lastErr.message : String(lastErr))
}

// ---------------- Codeforces ----------------

interface CfStatusItem {
  verdict?: string
  problem?: {
    contestId?: number
    index?: string
    name?: string
    rating?: number
    tags?: string[]
  }
}

export interface CfFetchResult {
  handle: string
  rating: number | null
  /** 通过的题目 id（形如 1741:A），去重保序 */
  passedIds: string[]
  /** 通过的题目元信息（用于题库未收录时补录） */
  problems: { id: string; name: string; rating: number | null; tags: string[]; solvedCount: number }[]
}

/** 抓取 Codeforces 账号的 AC 提交（分页，最多 maxPages 页 × 200 条） */
export async function fetchCfPassed(handle: string, maxPages = 25): Promise<CfFetchResult> {
  const info = (await fetchJson(
    `https://codeforces.com/api/user.info?handles=${encodeURIComponent(handle)}`
  )) as { status?: string; result?: { handle?: string; rating?: number }[]; comment?: string }
  if (info.status !== 'OK' || !info.result?.[0]) {
    throw new AppError(
      'ACCOUNT_NOT_FOUND',
      `Codeforces 账号不存在或接口拒绝：${info.comment ?? '未知原因'}`
    )
  }
  const passed = new Map<string, CfFetchResult['problems'][number]>()
  const seen = new Set<string>()
  for (let page = 0; page < maxPages; page++) {
    const from = page * 200 + 1
    const res = (await fetchJson(
      `https://codeforces.com/api/user.status?handle=${encodeURIComponent(handle)}&from=${from}&count=200`
    )) as { status?: string; result?: CfStatusItem[] }
    if (res.status !== 'OK' || !Array.isArray(res.result)) break
    if (res.result.length === 0) break
    for (const it of res.result) {
      if (it.verdict !== 'OK') continue
      const p = it.problem
      if (!p || typeof p.contestId !== 'number' || typeof p.index !== 'string') continue
      const id = `${p.contestId}:${p.index}`
      if (seen.has(id)) continue
      seen.add(id)
      passed.set(id, {
        id,
        name: p.name ?? id,
        rating: typeof p.rating === 'number' ? p.rating : null,
        tags: Array.isArray(p.tags) ? p.tags : [],
        solvedCount: 0
      })
    }
    if (res.result.length < 200) break
  }
  if (seen.size === 0) {
    // 账号存在但没有任何 AC：返回空结果（由调用方提示）
    return { handle, rating: info.result[0].rating ?? null, passedIds: [], problems: [] }
  }
  return {
    handle,
    rating: info.result[0].rating ?? null,
    passedIds: [...passed.keys()],
    problems: [...passed.values()]
  }
}

// ---------------- 洛谷 ----------------

const MAX_RECORD_PAGES = 60

/** 抓取洛谷账号的 AC 题目（登录窗口上下文内请求，自动携带 cookie） */
export async function fetchLuoguPassed(uid: string): Promise<{ practice: LuoguUserPractice; displayName: string; totalPassed: number | null }> {
  if (!isLoginWindowOpen()) {
    throw new AppError(
      'LUOGU_LOGIN_REQUIRED',
      '洛谷需要登录态：请先在设置页点「登录洛谷」完成登录（在应用内窗口，不要在系统浏览器），再同步'
    )
  }
  if (!loginWindowHostIs('luogu.com.cn')) {
    await navigateLoginWindowAndWait('https://www.luogu.com.cn/')
  }
  const userText = await fetchInLoginWindow(`https://www.luogu.com.cn/user/${uid}?_contentOnly=1`).catch(
    (e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e)
      // 401/403：登录态缺失或过期（洛谷对未登录的接口请求返回 401）
      if (/HTTP 40[13]/.test(msg)) {
        throw new AppError(
          'LUOGU_LOGIN_REQUIRED',
          '洛谷登录态已失效（HTTP 401）：请到设置页点「登录洛谷」重新登录（应用内窗口，登录后右上角出现你的头像）后再同步'
        )
      }
      throw e instanceof AppError ? e : new AppError('ACCOUNT_FETCH_FAILED', msg)
    }
  )
  if (userText === null) {
    throw new AppError('LOGIN_WINDOW_NOT_READY', '登录窗口不可用：请到设置页点「登录洛谷」后重试')
  }
  if (!pageHasUserData(userText) && isLuoguChallengePage(userText)) {
    throw new AppError(
      'LUOGU_LOGIN_REQUIRED',
      '洛谷登录态已失效：请在设置页点「登录洛谷」重新登录（应用内窗口）后再同步'
    )
  }
  const summary = parseLuoguUserSummary(userText)
  if (summary && summary.submittedProblemCount === null && summary.passedProblemCount === null) {
    throw new AppError(
      'LUOGU_LOGIN_REQUIRED',
      '洛谷未返回该账号数据（可能登录态已过期，或该用户隐藏了练习情况）：请点「登录洛谷」重新登录后重试'
    )
  }

  const pids: string[] = []
  const seen = new Set<string>()
  let firstPageSize = 0
  let serverTotal = 0
  for (let page = 1; page <= MAX_RECORD_PAGES; page++) {
    const text = await fetchInLoginWindow(
      `https://www.luogu.com.cn/record/list?page=${page}&uid=${encodeURIComponent(uid)}&status=12`
    )
    if (text === null) break
    let parsed: ReturnType<typeof parseLuoguRecordsPage>
    try {
      parsed = parseLuoguRecordsPage(text)
    } catch {
      if (page === 1) throw new AppError('ACCOUNT_FETCH_FAILED', '洛谷提交记录页解析失败')
      break
    }
    if (page === 1) {
      serverTotal = parsed.total
      firstPageSize = parsed.records.length
      if (firstPageSize === 0) break
    }
    for (const pid of parsed.acPids) {
      if (!seen.has(pid)) {
        seen.add(pid)
        pids.push(pid)
      }
    }
    if (parsed.records.length < firstPageSize) break
    if (page * firstPageSize >= serverTotal) break
  }
  if (pids.length === 0) {
    throw new AppError(
      'ACCOUNT_FETCH_FAILED',
      '未能从洛谷提交记录中解析出通过的题目（可能该账号没有 AC，或提交记录未公开）'
    )
  }
  return {
    practice: {
      uid: summary?.uid ?? Number(uid),
      name: summary?.name,
      passedPids: pids,
      passedProblemCount: summary?.passedProblemCount ?? pids.length
    },
    displayName: summary?.name ?? `用户 ${uid}`,
    totalPassed: summary?.passedProblemCount ?? pids.length
  }
}

// ---------------- 力扣 ----------------

/**
 * 力扣：官方 GraphQL 仅公开「提交总数 / 通过数 / 题目总数」，
 * 逐题 AC 列表接口（recentAcSubmissionList 等）已下线，因此只能同步概况。
 */
export async function fetchLeetcodeProfile(username: string): Promise<{
  displayName: string
  totalSubmissions: number | null
  acTotal: number | null
  questionTotal: number | null
}> {
  const query =
    'query($s:String!){ userProfilePublicProfile(userSlug:$s){ profile{ realName userAvatar } submissionProgress{ totalSubmissions acTotal questionTotal } } }'
  // GraphQL 需要 POST：用页面上下文（力扣对请求头/cookie 有校验）
  const resp = await fetchGraphQL(query, { s: username })
  const data = (resp as { data?: { userProfilePublicProfile?: unknown } }).data?.userProfilePublicProfile as
    | {
        profile?: { realName?: string }
        submissionProgress?: { totalSubmissions?: number; acTotal?: number; questionTotal?: number }
      }
    | undefined
  if (!data) {
    throw new AppError('ACCOUNT_NOT_FOUND', '力扣账号不存在或未公开资料（请检查用户名）')
  }
  const prog = data.submissionProgress ?? {}
  return {
    displayName: data.profile?.realName || username,
    totalSubmissions: prog.totalSubmissions ?? null,
    acTotal: prog.acTotal ?? null,
    questionTotal: prog.questionTotal ?? null
  }
}

/** 在隐藏窗口的力扣页面上下文内发 GraphQL 请求（带登录 cookie 与正确的 UA/Referer） */
async function fetchGraphQL(query: string, variables: Record<string, unknown>): Promise<unknown> {
  const { BrowserWindow } = require('electron') as typeof import('electron')
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, partition: 'persist:statement' }
  })
  try {
    await win.loadURL('https://leetcode.cn/')
    const js = `(async () => {
      const r = await fetch('https://leetcode.cn/graphql/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ query: ${JSON.stringify(query)}, variables: ${JSON.stringify(variables)} })
      });
      return await r.text();
    })()`
    const text = (await win.webContents.executeJavaScript(js, true)) as string
    try {
      return JSON.parse(text)
    } catch {
      throw new AppError('ACCOUNT_FETCH_FAILED', '力扣返回内容无法解析')
    }
  } finally {
    win.destroy()
  }
}

// ---------------- 写入本地练习记录 ----------------

export interface WriteOutcome {
  matched: number
  imported: number
  skipped: number
  unmatched: number
}

/** 把「通过的题目 id」写成 AC 练习记录（幂等：按导入来源标记去重） */
export function writePassedAsRecords(
  problems: ProblemsRepo,
  records: RecordsRepo,
  platform: AccountPlatform,
  account: string,
  passedIds: string[],
  /** 题库未收录的题目补录信息（CF 可用） */
  upserts?: CfFetchResult['problems']
): WriteOutcome {
  const marker = `${platform}-auto:${account}`
  if (upserts && upserts.length > 0) {
    // CF：用提交里自带的题名/难度/标签补录题库，保证「本题已通过」能落到记录上
    const inputs = upserts.map((p) => {
      const contestId = Number(p.id.split(':')[0])
      const index = p.id.split(':')[1] ?? ''
      return {
        contestId,
        index,
        name: p.name,
        rating: p.rating,
        solvedCount: p.solvedCount,
        tags: p.tags,
        source: 'cf' as const
      }
    })
    try {
      problems.upsertMany(inputs, new Date().toISOString().slice(0, 19).replace('T', ' '))
    } catch {
      // 补录失败不影响已有题目导入
    }
  }
  let imported = 0
  let skipped = 0
  let unmatched = 0
  let matched = 0
  for (const id of passedIds) {
    const exists = problems.getById(id)
    if (!exists) {
      unmatched++
      continue
    }
    matched++
    if (records.hasImport(id, marker)) {
      skipped++
      continue
    }
    records.create({
      problemId: id,
      status: 'AC',
      durationSeconds: null,
      note: `账号同步 · ${platform.toUpperCase()}:${account}`,
      importSource: marker
    })
    imported++
  }
  return { matched, imported, skipped, unmatched }
}

/** CF problemIdentity 复用导出（便于测试直接断言 id 形态） */
export const cfProblemIdentity = problemIdentity
