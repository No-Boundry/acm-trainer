import { IpcChannels } from '@shared/channels'
import type { Repos } from '../services'
import {
  accountService,
  autoSyncOnStart,
  syncAccount,
  syncAllBound
} from '../services/account-bind-sync'
import type { AccountBinding, AccountPlatform } from '../services/account-binding'
import type { SyncResult } from '../services/account-sync'
import { handle } from './helpers'

/**
 * 账号绑定与自动同步（v1.12 FR-30）。
 * 绑定信息存 settings（不含密码/令牌）；抓取走公开 API 或应用内登录窗口的登录态。
 */
export function registerAccountIpc(repos: Repos): void {
  handle<unknown, AccountBinding[]>(IpcChannels.AccountList, () => accountService(repos).list())

  handle<{ platform: AccountPlatform; account: string | null }, AccountBinding>(
    IpcChannels.AccountBind,
    (req) => accountService(repos).bind(req.platform, req.account)
  )

  handle<{ platform: AccountPlatform; account?: string | null }, SyncResult>(
    IpcChannels.AccountSync,
    (req) => syncAccount(repos, req.platform, req.account ?? null)
  )

  handle<unknown, { results: SyncResult[]; errors: { platform: AccountPlatform; message: string }[] }>(
    IpcChannels.AccountSyncAll,
    () => syncAllBound(repos)
  )

  handle<unknown, { synced: SyncResult[]; errors: { platform: AccountPlatform; message: string }[] }>(
    IpcChannels.AccountAutoSync,
    () => autoSyncOnStart(repos)
  )
}
