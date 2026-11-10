import { IpcChannels } from '@shared/channels'
import type { ProblemView } from '@shared/types'
import type { Repos } from '../services'
import { handle } from './helpers'

/**
 * 刷题记录（v1.19 FR-40）。
 *
 * 写入时机在主进程的 `statement:open`（打开题面即记一条），渲染层只读：
 * - `views:recent` 取最近打开过的题（按题目聚合，最近打开时间倒序）；
 * - `views:clear` 清空记录（首页「清空」按钮）。
 */
export function registerViewsIpc(repos: Repos): void {
  handle<{ limit?: number } | undefined, ProblemView[]>(IpcChannels.ViewsRecent, (req) =>
    repos.views.recent(req?.limit ?? 12)
  )

  handle<undefined, { ok: boolean }>(IpcChannels.ViewsClear, () => {
    repos.views.clear()
    return { ok: true }
  })
}
