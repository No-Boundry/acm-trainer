import { net, type IpcMainInvokeEvent } from 'electron'
import { IpcChannels } from '@shared/channels'
import type { SyncProgress } from '@shared/types'
import type { Repos } from '../services'
import { AppError } from '../db/errors'
import {
  extractLuoguListJson,
  parseLuoguTags,
  syncLuoguProblemset,
  type LuoguFetchers,
  type LuoguListData
} from '../services/luogu'
import {
  isLuoguChallengePage,
  isLentillePage,
  pageHasUserData,
  parseLuoguUserPractice,
  parseLuoguRecordsPage,
  parseLuoguUserSummary,
  buildPracticeFromText,
  importLuoguPractice,
  LUOGU_LOGIN_REQUIRED,
  LUOGU_PRACTICE_UNAVAILABLE,
  type ImportPracticeResult,
  type LuoguUserPractice
} from '../services/luogu-user'
import {
  fetchInLoginWindow,
  isLoginWindowOpen,
  loginWindowHostIs,
  navigateLoginWindowAndWait
} from '../services/web-window'
import { handle, pushEvent } from './helpers'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const LIST_URL = (page: number): string =>
  `https://www.luogu.com.cn/problem/list?page=${page}&type=P`
const TAGS_URL = 'https://www.luogu.com.cn/_lfe/tags/zh-CN'
const USER_URL = (uid: number | string): string =>
  `https://www.luogu.com.cn/user/${uid}?_contentOnly=1`
/** v1.11：用户页不再提供 passedProblems，改用提交记录（只取 AC）重建做题记录 */
const RECORD_URL = (uid: number | string, page: number): string =>
  `https://www.luogu.com.cn/record/list?page=${page}&uid=${encodeURIComponent(String(uid))}&status=12`
const MAX_RECORD_PAGES = 60 // 防御：60 页 × 20 条 = 1200 条 AC 上限

/**
 * 洛谷列表/标签抓取：Electron net（Chromium 网络栈，无需登录态）。
 */
async function fetchText(url: string): Promise<string> {
  let lastErr: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await net.fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json,text/html,*/*' }
      })
      if (!resp.ok) throw new AppError('LUOGU_FETCH_FAILED', `洛谷请求失败 HTTP ${resp.status}`)
      return await resp.text()
    } catch (e) {
      lastErr = e
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1000))
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr)
  throw new AppError('LUOGU_FETCH_FAILED', `拉取洛谷数据失败: ${msg}`)
}

/**
 * 用户练习数据抓取（FR-8.9 登录态）：在登录窗口页面上下文内 fetch，
 * 自动携带用户登录后的 cookie（v2.0：登录窗口仅用于登录与抓取，不再用于看题面）。
 */
async function fetchUserPageText(uid: number | string): Promise<string> {
  if (!isLoginWindowOpen()) {
    throw new AppError(
      LUOGU_LOGIN_REQUIRED,
      '请先在设置页点「登录洛谷」打开登录窗口并完成登录（仅用于抓取登录态），然后再导入'
    )
  }
  try {
    // 页面内 fetch 需与洛谷同源：登录窗口若不是洛谷域则先导航到洛谷首页（保留登录 cookie）
    if (!loginWindowHostIs('luogu.com.cn')) {
      await navigateLoginWindowAndWait('https://www.luogu.com.cn/')
    }
  } catch (e) {
    throw new AppError('LUOGU_FETCH_FAILED', e instanceof Error ? e.message : String(e))
  }
  let text: string | null
  try {
    // 预检：抓取洛谷首页判断是否携带登录态。
    // 注意（v1.11）：洛谷对匿名请求也可能返回带 Spilopelia 的 Soft Wall 页面，
    // 所以以「页面是否带登录用户信息」为准，而不是只看标题标记。
    const probe = await fetchInLoginWindow('https://www.luogu.com.cn/')
    if (probe !== null && !pageHasUserData(probe) && isLuoguChallengePage(probe)) {
      throw new AppError(
        LUOGU_LOGIN_REQUIRED,
        '未检测到洛谷登录态：请在【应用内「登录洛谷」窗口】里完成登录（窗口右上角出现你的头像/用户名），而不是在系统浏览器里登录；两处登录态不互通。登录后再点「在线导入」，或直接改用「粘贴文本」导入（推荐，无需登录）'
      )
    }
    text = await fetchInLoginWindow(USER_URL(uid))
  } catch (e) {
    if (e instanceof AppError) throw e
    throw new AppError('LUOGU_FETCH_FAILED', e instanceof Error ? e.message : String(e))
  }
  if (text === null) {
    throw new AppError('LOGIN_WINDOW_NOT_READY', '登录窗口不可用：请到设置页点「登录洛谷」后重试')
  }
  if (isLuoguChallengePage(text)) {
    throw new AppError(
      LUOGU_LOGIN_REQUIRED,
      '抓取未携带登录态（返回了洛谷验证页）：请在「登录洛谷」窗口完成登录（账号密码/扫码）后重试；若已登录仍如此，说明洛谷对自动请求做了拦截，请改用「粘贴文本」导入'
    )
  }
  return text
}

function buildFetchers(): LuoguFetchers {
  return {
    fetchPage: async (page: number): Promise<LuoguListData> =>
      extractLuoguListJson(await fetchText(LIST_URL(page))),
    fetchTags: async (): Promise<Map<number, string>> => parseLuoguTags(await fetchText(TAGS_URL))
  }
}

export function registerLuoguIpc(repos: Repos): void {
  handle<unknown, { added: number; updated: number; fetchedAt: string; totalPages: number }>(
    IpcChannels.LuoguSync,
    async (_req, event: IpcMainInvokeEvent) => {
      return syncLuoguProblemset(repos.problems, (p: SyncProgress) => {
        pushEvent(event, IpcChannels.ProblemsSyncProgress, p)
      }, buildFetchers())
    }
  )

  // FR-8.9 UID 做题记录导入（在线抓取 / 粘贴文本双通道）
  handle<
    { mode: 'fetch' | 'paste'; uid?: number | string; jsonText?: string },
    ImportPracticeResult
  >(IpcChannels.LuoguImportPractice, async (req) => {
    if (req.mode === 'paste') {
      if (!req.jsonText || !req.jsonText.trim()) {
        throw new AppError('VALIDATION', '请先粘贴包含洛谷 P 题号的内容（个人主页文字 / 题号列表 / 网页源码均可）')
      }
      // v1.2.1：直接从文本识别 P 题号，不再依赖洛谷页面结构
      const practice = buildPracticeFromText(req.jsonText)
      return importLuoguPractice(repos.problems, repos.records, practice)
    }
    // fetch 模式：登录态在线抓取
    const uid = req.uid
    if (uid === undefined || uid === null || String(uid).trim() === '') {
      throw new AppError('VALIDATION', '请输入洛谷 UID')
    }
    if (!/^\d+$/.test(String(uid).trim())) {
      throw new AppError('VALIDATION', '洛谷 UID 应为纯数字（可在洛谷个人主页 URL 中查看）')
    }
    const text = await fetchUserPageText(uid)
    if (isLuoguChallengePage(text)) {
      throw new AppError(
        LUOGU_LOGIN_REQUIRED,
        '洛谷要求登录：请先在设置页打开「登录洛谷」窗口完成登录，然后重试导入'
      )
    }
    // v1.11：用户页仍带 passedProblems（旧版/将来恢复）→ 直接用它，最省请求
    if (text.includes('passedProblems') && !isLentillePage(text)) {
      return importLuoguPractice(repos.problems, repos.records, parseLuoguUserPractice(text))
    }
    // v1.11：改版后用户页只有计数 → 用「提交记录（只取 AC）」重建做题记录
    const summary = isLentillePage(text) ? parseLuoguUserSummary(text) : null
    const practice = await fetchPracticeFromRecords(uid, summary)
    return importLuoguPractice(repos.problems, repos.records, practice)
  })
}

/**
 * 通过提交记录重建用户做题记录（v1.11 洛谷改版后的替代数据源）。
 * `/record/list?uid=&status=12` 分页拉取，收集去重后的 P 题号；
 * 任一页返回验证页 → 视为登录态失效。
 */
async function fetchPracticeFromRecords(
  uid: number | string,
  summary: { uid: number; name: string; passedProblemCount: number | null } | null
): Promise<LuoguUserPractice> {
  const pids: string[] = []
  const seen = new Set<string>()
  let firstPageSize = 0
  let serverTotal = 0
  for (let page = 1; page <= MAX_RECORD_PAGES; page++) {
    const pageText = await fetchInLoginWindow(RECORD_URL(uid, page))
    if (pageText === null) {
      throw new AppError('LOGIN_WINDOW_NOT_READY', '登录窗口不可用：请到设置页点「登录洛谷」后重试')
    }
    if (isLuoguChallengePage(pageText)) {
      throw new AppError(
        LUOGU_LOGIN_REQUIRED,
        '抓取提交记录时未携带登录态（洛谷返回验证页）：请在「登录洛谷」窗口完成登录后重试，或改用「粘贴文本」导入'
      )
    }
    let parsed: ReturnType<typeof parseLuoguRecordsPage>
    try {
      parsed = parseLuoguRecordsPage(pageText)
    } catch (e) {
      // 第一页就解析失败说明确实异常；后续页失败则按已收集结果收尾（避免前功尽弃）
      if (page === 1) throw e
      break
    }
    if (page === 1) {
      if (parsed.total === 0 || parsed.records.length === 0) {
        throw new AppError(
          LUOGU_PRACTICE_UNAVAILABLE,
          '该 UID 在洛谷没有任何「通过」记录（或提交记录未公开）；请确认 UID 是否正确，或改用「粘贴文本」导入'
        )
      }
      serverTotal = parsed.total
      firstPageSize = parsed.records.length
    }
    for (const pid of parsed.acPids) {
      if (!seen.has(pid)) {
        seen.add(pid)
        pids.push(pid)
      }
    }
    // 本页不足首页条数（说明已到最后一页），或已达服务端总数 → 结束
    if (parsed.records.length < firstPageSize) break
    if (page * firstPageSize >= serverTotal) break
  }
  if (pids.length === 0) {
    throw new AppError(
      LUOGU_PRACTICE_UNAVAILABLE,
      '未能从洛谷提交记录中解析出通过的题目；请改用「粘贴文本」导入'
    )
  }
  return {
    uid: summary?.uid ?? (Number(uid) || undefined),
    name: summary?.name,
    passedPids: pids,
    passedProblemCount: summary?.passedProblemCount ?? pids.length
  }
}
