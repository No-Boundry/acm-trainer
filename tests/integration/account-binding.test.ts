import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * 账号绑定与自动同步（v1.12 FR-30）。
 * 说明：account-sync 依赖 electron 的 net/隐藏窗口，这里 mock 掉抓取层，
 * 只验证「绑定校验 → 抓取编排 → 写记录 → 回写状态 → 自动同步节流」这条业务链路。
 */

const fetchCfPassed = vi.fn()
const fetchLuoguPassed = vi.fn()
const fetchLeetcodeProfile = vi.fn()

vi.mock('../../src/main/services/account-sync', async () => {
  const actual = await vi.importActual<typeof import('../../src/main/services/account-sync')>(
    '../../src/main/services/account-sync'
  )
  return {
    ...actual,
    fetchCfPassed: (...a: unknown[]) => fetchCfPassed(...a),
    fetchLuoguPassed: (...a: unknown[]) => fetchLuoguPassed(...a),
    fetchLeetcodeProfile: (...a: unknown[]) => fetchLeetcodeProfile(...a)
  }
})

const importLuoguPractice = vi.fn()
vi.mock('../../src/main/services/luogu-user', async () => {
  const actual = await vi.importActual<typeof import('../../src/main/services/luogu-user')>(
    '../../src/main/services/luogu-user'
  )
  return {
    ...actual,
    importLuoguPractice: (...a: unknown[]) => importLuoguPractice(...a)
  }
})

const { initDb, closeDb } = await import('../../src/main/db/index')
const { ProblemsRepo } = await import('../../src/main/db/repositories/problems')
const { RecordsRepo } = await import('../../src/main/db/repositories/records')
const { SettingsRepo } = await import('../../src/main/db/repositories/settings')
const { AccountBindingService, validateAccount } = await import(
  '../../src/main/services/account-binding'
)
const { syncAccount, syncAllBound, autoSyncOnStart, isAutoSyncDue, AUTO_SYNC_INTERVAL_MS } =
  await import('../../src/main/services/account-bind-sync')

type Db = ReturnType<typeof initDb>
let db: Db
let repos: { problems: InstanceType<typeof ProblemsRepo>; records: InstanceType<typeof RecordsRepo>; settings: InstanceType<typeof SettingsRepo> }

beforeEach(() => {
  closeDb()
  db = initDb(':memory:')
  repos = {
    problems: new ProblemsRepo(db),
    records: new RecordsRepo(db),
    settings: new SettingsRepo(db)
  }
  // 题库预置：CF 两道、洛谷两道
  repos.problems.upsertMany(
    [
      { contestId: 1, index: 'A', name: 'CF1A', rating: 800, solvedCount: 0, tags: ['greedy'] },
      { contestId: 2, index: 'B', name: 'CF2B', rating: 1200, solvedCount: 0, tags: ['dp'] }
    ],
    '2026-10-01 00:00:00'
  )
  repos.problems.upsertMany(
    [
      { contestId: 0, index: 'P1000', name: 'A+B', rating: null, difficulty: 1, solvedCount: 0, source: 'luogu', tags: [] },
      { contestId: 0, index: 'P1001', name: 'A-B', rating: null, difficulty: 1, solvedCount: 0, source: 'luogu', tags: [] }
    ],
    '2026-10-01 00:00:00'
  )
  fetchCfPassed.mockReset()
  fetchLuoguPassed.mockReset()
  fetchLeetcodeProfile.mockReset()
  importLuoguPractice.mockReset()
})
afterEach(() => closeDb())

describe('账号校验与绑定', () => {
  it('各平台账号格式校验', () => {
    expect(validateAccount('luogu', '1935012')).toBe('1935012')
    expect(() => validateAccount('luogu', 'abc')).toThrow(/UID/)
    expect(validateAccount('cf', 'tourist')).toBe('tourist')
    expect(() => validateAccount('cf', 'a')).toThrow(/handle/)
    expect(validateAccount('leetcode', 'vue')).toBe('vue')
    expect(() => validateAccount('leetcode', 'x')).toThrow(/用户名/)
    expect(() => validateAccount('cf', '   ')).toThrow(/不能为空/)
  })

  it('绑定 / 解绑 / 列表', () => {
    const svc = new AccountBindingService(repos.settings)
    expect(svc.get('cf').account).toBeNull()
    svc.bind('cf', ' tourist ')
    expect(svc.get('cf').account).toBe('tourist')
    svc.bind('luogu', '1935012')
    expect(svc.list().map((b) => b.account)).toEqual(['tourist', '1935012', null])
    expect(svc.boundAccounts()).toHaveLength(2)
    svc.bind('cf', null)
    expect(svc.get('cf').account).toBeNull()
    expect(svc.boundAccounts()).toHaveLength(1)
  })

  it('平台能力标记：只有力扣不支持逐题记录', () => {
    const svc = new AccountBindingService(repos.settings)
    expect(svc.list().map((b) => [b.platform, b.supportsRecords])).toEqual([
      ['cf', true],
      ['luogu', true],
      ['leetcode', false]
    ])
  })
})

describe('syncAccount：Codeforces', () => {
  it('写入 AC 记录并回写同步状态；重复同步幂等', async () => {
    fetchCfPassed.mockResolvedValue({
      handle: 'tourist',
      rating: 3380,
      passedIds: ['1:A', '2:B', '9:Z'],
      problems: [{ id: '9:Z', name: 'CF9Z', rating: 1500, tags: ['graphs'], solvedCount: 0 }]
    })
    const r1 = await syncAccount(repos, 'cf', 'tourist')
    expect(r1.platform).toBe('cf')
    expect(r1.displayName).toBe('tourist')
    expect(r1.totalPassed).toBe(3)
    expect(r1.imported).toBe(3) // 题库题库未收录的 9:Z 通过补录后也计入
    // 9:Z 不在题库 → 自动补录后也计入
    expect(r1.matched + r1.unmatched).toBe(3)
    expect(repos.problems.getById('9:Z')).toBeTruthy()

    const due = await syncAccount(repos, 'cf')
    expect(due.imported).toBe(0) // 幂等：已导入的跳过
    expect(due.skipped).toBeGreaterThan(0)

    const b = new AccountBindingService(repos.settings).get('cf')
    expect(b.account).toBe('tourist')
    expect(b.totalPassed).toBe(3)
    expect(b.lastSyncAt).toBeTruthy()
    expect(b.lastError).toBeNull()
    // 记录数 = 3 题 × 1 次（3 条 AC 记录）
    const n = (db.prepare("SELECT COUNT(*) AS c FROM practice_records WHERE status='AC'").get() as { c: number }).c
    expect(n).toBe(3)
  })

  it('抓取失败 → 记录 lastError，且不写脏数据', async () => {
    fetchCfPassed.mockRejectedValue(new Error('Codeforces 账号不存在'))
    await expect(syncAccount(repos, 'cf', 'nobody')).rejects.toThrow(/不存在/)
    const b = new AccountBindingService(repos.settings).get('cf')
    expect(b.lastError).toContain('不存在')
    expect(b.lastSyncAt).toBeNull()
  })

  it('未绑定直接同步 → VALIDATION', async () => {
    await expect(syncAccount(repos, 'cf')).rejects.toThrow(/请先绑定/)
  })
})

describe('syncAccount：洛谷与力扣', () => {
  it('洛谷走提交记录重建结果（importLuoguPractice 编排）', async () => {
    fetchLuoguPassed.mockResolvedValue({
      practice: { uid: 1935012, name: 'B_I_G', passedPids: ['P1000', 'P1001'], passedProblemCount: 50 },
      displayName: 'B_I_G',
      totalPassed: 50
    })
    importLuoguPractice.mockReturnValue({ matched: 2, imported: 2, skipped: 0, unmatched: 0, user: {} })
    const r = await syncAccount(repos, 'luogu', '1935012')
    expect(r).toMatchObject({ platform: 'luogu', displayName: 'B_I_G', totalPassed: 50, imported: 2 })
    expect(importLuoguPractice).toHaveBeenCalledOnce()
  })

  it('力扣：只同步概况并给出说明，不写逐题记录', async () => {
    fetchLeetcodeProfile.mockResolvedValue({
      displayName: 'LeetCode',
      totalSubmissions: 785,
      acTotal: 650,
      questionTotal: 3800
    })
    const r = await syncAccount(repos, 'leetcode', 'leetcode')
    expect(r.imported).toBe(0)
    expect(r.totalPassed).toBe(650)
    expect(r.note).toMatch(/只提供通过数/)
    expect((db.prepare('SELECT COUNT(*) AS c FROM practice_records').get() as { c: number }).c).toBe(0)
  })
})

describe('批量与自动同步', () => {
  it('syncAllBound：单个平台失败不影响其它', async () => {
    new AccountBindingService(repos.settings).bind('cf', 'tourist')
    new AccountBindingService(repos.settings).bind('luogu', '1935012')
    fetchCfPassed.mockResolvedValue({ handle: 'tourist', rating: 3380, passedIds: ['1:A'], problems: [] })
    fetchLuoguPassed.mockRejectedValue(new Error('洛谷需要登录态'))
    const r = await syncAllBound(repos)
    expect(r.results).toHaveLength(1)
    expect(r.errors[0].platform).toBe('luogu')
  })

  it('isAutoSyncDue：6 小时节流', () => {
    const base = new Date('2026-10-20T00:00:00Z').getTime()
    // lastSyncAt 统一是「本地时间」字符串（与 recordResult 写入一致）→ 这里用本地时间构造
    const local = (ms: number): string => {
      const d = new Date(ms)
      const p = (n: number): string => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
    }
    const mk = (lastSyncAt: string | null, account: string | null = 'x') =>
      ({ platform: 'cf', account, lastSyncAt, displayName: null, totalPassed: null, lastImported: null, lastError: null, supportsRecords: true }) as const
    expect(AUTO_SYNC_INTERVAL_MS).toBe(6 * 60 * 60 * 1000)
    expect(isAutoSyncDue(mk(null) as never, base)).toBe(true) // 从未同步
    expect(isAutoSyncDue(mk(null, null) as never, base)).toBe(false) // 未绑定
    expect(isAutoSyncDue(mk(local(base - 60 * 60 * 1000)) as never, base)).toBe(false) // 1 小时前
    expect(isAutoSyncDue(mk(local(base - 7 * 60 * 60 * 1000)) as never, base)).toBe(true) // 7 小时前
  })

  it('autoSyncOnStart：只同步到期的绑定账号，并遵守开关', async () => {
    const svc = new AccountBindingService(repos.settings)
    svc.bind('cf', 'tourist')
    fetchCfPassed.mockResolvedValue({ handle: 'tourist', rating: 3380, passedIds: ['1:A'], problems: [] })
    const r1 = await autoSyncOnStart(repos)
    expect(r1.synced.map((s) => s.platform)).toEqual(['cf'])

    // 刚同步过 → 不再重复
    const r2 = await autoSyncOnStart(repos)
    expect(r2.synced).toHaveLength(0)

    // 关闭自动同步 → 即使到期也不同步
    repos.settings.set('autoSyncEnabled', 'false')
    repos.settings.set('accountLastSync', '{}')
    const r3 = await autoSyncOnStart(repos)
    expect(r3.synced).toHaveLength(0)
  })
})
