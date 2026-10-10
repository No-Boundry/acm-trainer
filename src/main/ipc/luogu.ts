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
  parseLuoguUserPractice,
  buildPracticeFromText,
  importLuoguPractice,
  LUOGU_LOGIN_REQUIRED,
  type ImportPracticeResult
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
    // 预检：抓取洛谷首页探测登录态，把「未登录」与「登录了但抓取异常」区分开
    const probe = await fetchInLoginWindow('https://www.luogu.com.cn/')
    if (probe !== null && isLuoguChallengePage(probe)) {
      throw new AppError(
        LUOGU_LOGIN_REQUIRED,
        '未检测到洛谷登录态：请确认你是在【应用内「登录洛谷」窗口】里完成登录（窗口右上角出现你的头像/用户名），而不是在系统浏览器里登录；两处登录态不互通。登录后再点「在线导入」，或直接改用「粘贴文本」导入（推荐，无需登录）'
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
      '抓取未携带登录态（返回了洛谷验证页）：请确认已在「登录洛谷」窗口完成登录（账号密码/扫码，不要用通行证），然后重试；或改用「粘贴文本」方式导入'
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
    const practice = parseLuoguUserPractice(text)
    return importLuoguPractice(repos.problems, repos.records, practice)
  })
}
