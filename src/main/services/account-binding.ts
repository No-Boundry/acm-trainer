import type { SettingsRepo } from '../db/repositories/settings'
import { AppError } from '../db/errors'

/**
 * 在线账号绑定（v1.12 FR-30）。
 * 三个题库各自绑定一个账号，绑定信息存在 settings 表中（纯文本，不含密码/token）：
 *   cfHandle          —— Codeforces handle（公开 API，无需登录）
 *   luoguUid          —— 洛谷 UID（需应用内登录态，见 web-window 分区）
 *   leetcodeUsername  —— 力扣用户名 slug（公开资料接口）
 * lastSyncAt / lastSyncResult 记录每个平台的一次自动抓取结果。
 */

export type AccountPlatform = 'cf' | 'luogu' | 'leetcode'

export const ACCOUNT_PLATFORMS: readonly AccountPlatform[] = ['cf', 'luogu', 'leetcode']

/** 各平台绑定信息在 settings 中的键 */
const BINDING_KEYS: Record<AccountPlatform, string> = {
  cf: 'cfHandle',
  luogu: 'luoguUid',
  leetcode: 'leetcodeUsername'
}

const LAST_SYNC_KEY = 'accountLastSync'

export interface AccountBinding {
  platform: AccountPlatform
  /** 绑定的账号标识（CF handle / 洛谷 UID / 力扣 slug），未绑定为 null */
  account: string | null
  /** 展示名（上次成功抓取到的昵称/用户名） */
  displayName: string | null
  /** 该账号的总通过数（上次抓取） */
  totalPassed: number | null
  lastSyncAt: string | null
  /** 上次抓取写入/更新的记录数 */
  lastImported: number | null
  lastError: string | null
  /** 该平台是否支持逐题记录同步（力扣目前只给计数） */
  supportsRecords: boolean
}

interface LastSyncEntry {
  at?: string
  displayName?: string
  totalPassed?: number
  imported?: number
  error?: string
}

/** 平台能力：是否可同步「逐题 AC 记录」 */
export const PLATFORM_SUPPORTS_RECORDS: Record<AccountPlatform, boolean> = {
  cf: true,
  luogu: true,
  leetcode: false
}

function parseLastSync(raw: string | null): Record<string, LastSyncEntry> {
  if (!raw) return {}
  try {
    const v = JSON.parse(raw) as unknown
    return v && typeof v === 'object' ? (v as Record<string, LastSyncEntry>) : {}
  } catch {
    return {}
  }
}

/** 本地时间字符串（与 settings 其余时间字段一致，避免 UTC/本地混用造成时区偏差） */
export function localNow(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** 校验账号标识格式（防误填 URL/空格） */
export function validateAccount(platform: AccountPlatform, account: string): string {
  const v = account.trim()
  if (!v) throw new AppError('VALIDATION', '账号不能为空')
  if (platform === 'luogu' && !/^\d{1,9}$/.test(v)) {
    throw new AppError('VALIDATION', '洛谷账号应填 UID（纯数字，见个人主页 URL /user/<UID>）')
  }
  if (platform === 'cf' && !/^[A-Za-z0-9_.-]{3,24}$/.test(v)) {
    throw new AppError('VALIDATION', 'Codeforces handle 应为 3~24 位字母/数字/_ . -')
  }
  if (platform === 'leetcode' && !/^[A-Za-z0-9_-]{2,40}$/.test(v)) {
    throw new AppError('VALIDATION', '力扣用户名应为 2~40 位字母/数字/_ -（见 leetcode.cn/u/<用户名>）')
  }
  return v
}

export class AccountBindingService {
  constructor(private settings: SettingsRepo) {}

  get(platform: AccountPlatform): AccountBinding {
    const last = parseLastSync(this.settings.get(LAST_SYNC_KEY))[platform] ?? {}
    return {
      platform,
      account: this.settings.get(BINDING_KEYS[platform]) || null,
      displayName: last.displayName ?? null,
      totalPassed: typeof last.totalPassed === 'number' ? last.totalPassed : null,
      lastSyncAt: last.at ?? null,
      lastImported: typeof last.imported === 'number' ? last.imported : null,
      lastError: last.error ?? null,
      supportsRecords: PLATFORM_SUPPORTS_RECORDS[platform]
    }
  }

  list(): AccountBinding[] {
    return ACCOUNT_PLATFORMS.map((p) => this.get(p))
  }

  /** 绑定（幂等覆盖）；传 null/空串表示解绑 */
  bind(platform: AccountPlatform, account: string | null): AccountBinding {
    if (account === null || account.trim() === '') {
      this.settings.set(BINDING_KEYS[platform], '')
      this.recordResult(platform, { error: undefined })
      return this.get(platform)
    }
    const v = validateAccount(platform, account)
    this.settings.set(BINDING_KEYS[platform], v)
    return this.get(platform)
  }

  /** 记录一次抓取结果（供自动同步与界面展示） */
  recordResult(
    platform: AccountPlatform,
    r: { displayName?: string; totalPassed?: number; imported?: number; error?: string }
  ): void {
    const all = parseLastSync(this.settings.get(LAST_SYNC_KEY))
    const prev = all[platform] ?? {}
    all[platform] = {
      ...prev,
      // 统一用「本地时间 YYYY-MM-DD HH:mm:ss」：与 isAutoSyncDue 的解析方式一致，避免时区偏差
      at: r.error ? prev.at : localNow(),
      displayName: r.displayName ?? prev.displayName,
      totalPassed: typeof r.totalPassed === 'number' ? r.totalPassed : prev.totalPassed,
      imported: typeof r.imported === 'number' ? r.imported : r.error ? 0 : prev.imported,
      error: r.error
    }
    this.settings.set(LAST_SYNC_KEY, JSON.stringify(all))
  }

  /** 所有已绑定账号（供定时自动同步） */
  boundAccounts(): { platform: AccountPlatform; account: string }[] {
    const out: { platform: AccountPlatform; account: string }[] = []
    for (const p of ACCOUNT_PLATFORMS) {
      const a = this.settings.get(BINDING_KEYS[p])
      if (a && a.trim()) out.push({ platform: p, account: a.trim() })
    }
    return out
  }
}
