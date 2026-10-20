import type { ProblemsRepo } from '../db/repositories/problems'
import type { RecordsRepo } from '../db/repositories/records'
import type { SettingsRepo } from '../db/repositories/settings'
import { AppError } from '../db/errors'
import {
  AccountBindingService,
  type AccountPlatform,
  type AccountBinding
} from './account-binding'
import {
  fetchCfPassed,
  fetchLuoguPassed,
  fetchLeetcodeProfile,
  writePassedAsRecords,
  type SyncResult
} from './account-sync'
import { importLuoguPractice } from './luogu-user'

/**
 * 账号同步编排（v1.12 FR-30）：绑定 → 抓取 → 写记录 → 回写同步状态。
 * IPC `account:sync` 与启动时的自动同步共用此函数。
 */

export interface ReposLike {
  problems: ProblemsRepo
  records: RecordsRepo
  settings: SettingsRepo
}

/** 每个平台两次自动同步的最小间隔（毫秒） */
export const AUTO_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000

export function accountService(repos: ReposLike): AccountBindingService {
  return new AccountBindingService(repos.settings)
}

export async function syncAccount(
  repos: ReposLike,
  platform: AccountPlatform,
  accountOverride?: string | null
): Promise<SyncResult> {
  const svc = accountService(repos)
  const binding = svc.bind(platform, (accountOverride ?? svc.get(platform).account ?? '').trim())
  const account = binding.account
  if (!account) {
    throw new AppError('VALIDATION', '请先绑定该平台的账号')
  }

  try {
    let result: SyncResult
    if (platform === 'cf') {
      const r = await fetchCfPassed(account)
      const outcome = writePassedAsRecords(repos.problems, repos.records, 'cf', account, r.passedIds, r.problems)
      result = {
        platform,
        displayName: r.handle,
        totalPassed: r.passedIds.length,
        ...outcome
      }
    } else if (platform === 'luogu') {
      const r = await fetchLuoguPassed(account)
      const outcome = importLuoguPractice(repos.problems, repos.records, r.practice)
      result = {
        platform,
        displayName: r.displayName,
        totalPassed: r.totalPassed,
        matched: outcome.matched,
        imported: outcome.imported,
        skipped: outcome.skipped,
        unmatched: outcome.unmatched
      }
    } else {
      // 力扣：官方仅公开计数，无法逐题同步
      const p = await fetchLeetcodeProfile(account)
      result = {
        platform,
        displayName: p.displayName,
        totalPassed: p.acTotal,
        matched: 0,
        imported: 0,
        skipped: 0,
        unmatched: 0,
        note:
          `力扣官方接口只提供通过数（${p.acTotal ?? '—'}/${p.questionTotal ?? '—'}），` +
          '逐题 AC 列表接口已下线；可在题库页用「粘贴题号/内容」导入具体题目'
      }
    }
    svc.recordResult(platform, {
      displayName: result.displayName,
      totalPassed: result.totalPassed ?? undefined,
      imported: result.imported
    })
    return result
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    svc.recordResult(platform, { error: msg })
    throw e
  }
}

/** 同步全部已绑定账号（单个失败不影响其它） */
export async function syncAllBound(
  repos: ReposLike
): Promise<{ results: SyncResult[]; errors: { platform: AccountPlatform; message: string }[] }> {
  const results: SyncResult[] = []
  const errors: { platform: AccountPlatform; message: string }[] = []
  for (const { platform, account } of accountService(repos).boundAccounts()) {
    try {
      results.push(await syncAccount(repos, platform, account))
    } catch (e) {
      errors.push({ platform, message: e instanceof Error ? e.message : String(e) })
    }
  }
  return { results, errors }
}

/** 该平台是否到了自动同步时间（未绑定的跳过） */
export function isAutoSyncDue(binding: AccountBinding, now = Date.now()): boolean {
  if (!binding.account) return false
  if (!binding.lastSyncAt) return true
  // lastSyncAt 统一存「本地时间 YYYY-MM-DD HH:mm:ss」（见 account-binding.localNow）
  const t = new Date(binding.lastSyncAt.replace(' ', 'T')).getTime()
  if (Number.isNaN(t)) return true
  return now - t >= AUTO_SYNC_INTERVAL_MS
}

/** 启动时自动同步：仅对已绑定且到期（>6h）的账号执行 */
export async function autoSyncOnStart(repos: ReposLike): Promise<{
  synced: SyncResult[]
  errors: { platform: AccountPlatform; message: string }[]
}> {
  const svc = accountService(repos)
  // 用户可在设置页关闭自动同步（默认开启）
  if (repos.settings.get('autoSyncEnabled') === 'false') {
    return { synced: [], errors: [] }
  }
  const due = svc.boundAccounts().filter(({ platform }) => isAutoSyncDue(svc.get(platform)))
  const synced: SyncResult[] = []
  const errors: { platform: AccountPlatform; message: string }[] = []
  for (const { platform, account } of due) {
    try {
      synced.push(await syncAccount(repos, platform, account))
    } catch (e) {
      errors.push({ platform, message: e instanceof Error ? e.message : String(e) })
    }
  }
  return { synced, errors }
}
