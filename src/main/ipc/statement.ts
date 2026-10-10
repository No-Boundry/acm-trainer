import { IpcChannels } from '@shared/channels'
import type { Repos } from '../services'
import { AppError } from '../db/errors'
import { handle } from './helpers'
import { openExternalUrl, openInEdge } from '../services/external-browser'
import { openLoginWindow } from '../services/web-window'

/**
 * 题面域（v1.8）：题面统一用 Edge 浏览器打开（缺失时回退系统默认浏览器）；
 * 另提供洛谷登录窗口入口（仅用于 UID 在线导入的登录态）。
 */
export function registerStatementIpc(repos: Repos): void {
  handle<{ problemId: string }, { ok: boolean; via: string }>(
    IpcChannels.StatementOpen,
    ({ problemId }) => {
      const p = repos.problems.getById(problemId)
      if (!p) throw new AppError('NOT_FOUND', '题目不存在')
      const r = openInEdge(p.cfUrl)
      return { ok: true, via: r.via }
    }
  )

  handle<{ url?: string }, { ok: boolean }>(IpcChannels.LuoguOpenLogin, ({ url }) => {
    openLoginWindow(url)
    return { ok: true }
  })

  // v1.8.2：打开外部参考链接（仅允许 https）
  handle<{ url: string }, { ok: boolean }>(IpcChannels.AppOpenExternal, ({ url }) => {
    if (!/^https:\/\//.test(url)) {
      throw new AppError('VALIDATION', '仅支持打开 https 链接')
    }
    openExternalUrl(url)
    return { ok: true }
  })
}
