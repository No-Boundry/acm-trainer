import { describe, it, expect, beforeEach } from 'vitest'
import { initDb, closeDb } from '../../src/main/db/index'
import { SCHEMA_SQL } from '../../src/main/db/schema'
import { ProblemsRepo } from '../../src/main/db/repositories/problems'
import { RecordsRepo } from '../../src/main/db/repositories/records'
import { NotesRepo } from '../../src/main/db/repositories/notes'
import { TemplatesRepo } from '../../src/main/db/repositories/templates'
import { ContestsRepo } from '../../src/main/db/repositories/contests'
import { RatingRepo } from '../../src/main/db/repositories/rating'
import { SettingsRepo } from '../../src/main/db/repositories/settings'
import { AppError } from '../../src/main/db/errors'
import type { Database } from 'better-sqlite3'

// 每个用例独立内存库
let db: Database.Database
beforeEach(() => {
  closeDb()
  db = initDb(':memory:')
})

const sampleProblems = [
  {
    contestId: 1741,
    index: 'A',
    name: 'Compare T-Shirt Sizes',
    rating: 800,
    solvedCount: 1000,
    tags: ['implementation']
  },
  {
    contestId: 1741,
    index: 'B',
    name: 'Funny Permutation',
    rating: 1200,
    solvedCount: 500,
    tags: ['constructive', 'math']
  },
  {
    contestId: 1800,
    index: 'C',
    name: 'Deepest Ocean',
    rating: 1600,
    solvedCount: 200,
    tags: ['dp']
  }
]

describe('schema', () => {
  it('建表幂等：重复执行 schema 不报错', () => {
    db.exec('DROP TABLE IF EXISTS settings')
    db.exec(SCHEMA_SQL)
    expect(true).toBe(true)
  })
})

describe('ProblemsRepo', () => {
  it('upsert 新增/更新计数正确且不重复', () => {
    const repo = new ProblemsRepo(db)
    const r1 = repo.upsertMany(sampleProblems, '2026-01-01 00:00:00')
    expect(r1).toEqual({ added: 3, updated: 0 })
    expect(repo.count()).toBe(3)

    const r2 = repo.upsertMany(
      [{ ...sampleProblems[0], rating: 900, tags: ['implementation', 'brute force'] }],
      '2026-01-02 00:00:00'
    )
    expect(r2).toEqual({ added: 0, updated: 1 })
    expect(repo.count()).toBe(3)
  })

  it('组合筛选（难度+标签+关键字+已练习）', () => {
    const repo = new ProblemsRepo(db)
    repo.upsertMany(sampleProblems, '2026-01-01 00:00:00')
    const recRepo = new RecordsRepo(db)
    recRepo.create({ problemId: '1741:A', status: 'AC' })

    const res = repo.list({
      page: 1,
      pageSize: 10,
      ratingMin: 800,
      ratingMax: 1300,
      tags: ['implementation'],
      practiced: 'done'
    })
    expect(res.total).toBe(1)
    expect(res.items[0].id).toBe('1741:A')
    expect(res.items[0].practiced).toBe(true)
    expect(res.items[0].lastStatus).toBe('AC')
    expect(res.items[0].tags).toContain('模拟')
  })

  it('排序：rating 降序，无 rating 排最后', () => {
    const repo = new ProblemsRepo(db)
    repo.upsertMany(
      [...sampleProblems, { contestId: 999, index: 'Z', name: 'NoRating', rating: null, solvedCount: 1, tags: [] }],
      '2026-01-01 00:00:00'
    )
    const res = repo.list({ page: 1, pageSize: 10, sortBy: 'rating', sortDir: 'desc' })
    expect(res.items[0].id).toBe('1800:C')
    expect(res.items[res.items.length - 1].rating).toBeNull()
  })

  it('byIds 保持传入顺序', () => {
    const repo = new ProblemsRepo(db)
    repo.upsertMany(sampleProblems, '2026-01-01 00:00:00')
    const items = repo.byIds(['1800:C', '1741:A'])
    expect(items.map((i) => i.id)).toEqual(['1800:C', '1741:A'])
  })

  it('list 缺省分页参数时使用默认值（防御）', () => {
    const repo = new ProblemsRepo(db)
    repo.upsertMany(sampleProblems, '2026-01-01 00:00:00')
    const res = repo.list({ page: 1, pageSize: 10 } as never)
    expect(res.total).toBe(3)
    expect(res.items.length).toBe(3)
  })

  it('allTags 去重排序（v1.18：写入即物化为中文 canonical）', () => {
    const repo = new ProblemsRepo(db)
    repo.upsertMany(sampleProblems, '2026-01-01 00:00:00')
    // 'dp'→动态规划、'implementation'→模拟、'math'→数学；'constructive' 不在映射表内保持原样
    expect(repo.allTags()).toEqual(['constructive', '动态规划', '数学', '模拟'])
  })
})

describe('RecordsRepo', () => {
  it('create/list/update/delete 全流程', () => {
    const repo = new ProblemsRepo(db)
    repo.upsertMany(sampleProblems, '2026-01-01 00:00:00')
    const rec = new RecordsRepo(db)
    const r = rec.create({ problemId: '1741:A', status: 'WA', durationSeconds: 600, note: '边界没考虑', isMistake: true })
    expect(r.id).toBeGreaterThan(0)
    expect(r.isMistake).toBe(true)

    const updated = rec.update(r.id, { status: 'AC' })
    expect(updated.status).toBe('AC')

    const list = rec.list({})
    expect(list.total).toBe(1)
    expect(list.items[0].status).toBe('AC')

    rec.delete(r.id)
    expect(rec.list({}).total).toBe(0)
  })

  it('非法状态被拒绝', () => {
    const rec = new RecordsRepo(db)
    expect(() => rec.create({ problemId: 'x', status: 'XX' as never })).toThrow(AppError)
  })

  it('stats 聚合正确', () => {
    const repo = new ProblemsRepo(db)
    repo.upsertMany(sampleProblems, '2026-01-01 00:00:00')
    const rec = new RecordsRepo(db)
    rec.create({ problemId: '1741:A', status: 'AC', durationSeconds: 120 })
    rec.create({ problemId: '1741:A', status: 'WA', durationSeconds: 60 })
    rec.create({ problemId: '1741:B', status: 'AC' })
    const s = rec.stats(30)
    expect(s.totalAttempts).toBe(3)
    expect(s.acCount).toBe(2)
    expect(s.accuracy).toBeCloseTo(66.7, 0)
    expect(s.distinctProblems).toBe(2)
    expect(s.practiceSeconds).toBe(180)
    expect(s.daily.length).toBeGreaterThanOrEqual(1)
    expect(s.tagStats.find((t) => t.tag === '模拟')?.count).toBe(2)
  })
})

describe('NotesRepo', () => {
  it('create/search/byProblem/update/delete', () => {
    const prepo = new ProblemsRepo(db)
    prepo.upsertMany([sampleProblems[0]], '2026-01-01 00:00:00')
    const repo = new NotesRepo(db)
    const n = repo.create({ title: '1741A 题解', content: '# 思路\n用模拟解决', problemId: '1741:A', tags: ['模拟'] })
    expect(n.id).toBeGreaterThan(0)

    const found = repo.list({ keyword: '模拟' })
    expect(found.length).toBe(1)

    const byProblem = repo.list({ problemId: '1741:A' })
    expect(byProblem.length).toBe(1)

    const updated = repo.update(n.id, { content: '# 新思路' })
    expect(updated.content).toContain('新思路')

    repo.delete(n.id)
    expect(repo.list({}).length).toBe(0)
  })
})

describe('TemplatesRepo', () => {
  it('CRUD + categories', () => {
    const repo = new TemplatesRepo(db)
    const t = repo.create({ category: '图论', title: 'Dijkstra', code: 'int main(){}' })
    const t2 = repo.create({ category: '数论', title: '快速幂', code: 'll qpow(ll a,ll b){...}' })
    expect(repo.categories()).toEqual(['图论', '数论'])
    expect(repo.list({ keyword: 'Dijkstra' }).length).toBe(1)
    repo.update(t.id, { title: 'Dijkstra(堆优化)' })
    expect(repo.getById(t.id)?.title).toBe('Dijkstra(堆优化)')
    repo.delete(t.id)
    expect(repo.list({}).length).toBe(1)
    expect(repo.getById(t2.id)?.title).toBe('快速幂')
  })
})

describe('ContestsRepo', () => {
  it('创建→开始→提交→结束 全流程 + 罚时数据', () => {
    const prepo = new ProblemsRepo(db)
    prepo.upsertMany(sampleProblems, '2026-01-01 00:00:00')
    const crepo = new ContestsRepo(db)

    const c = crepo.createContest({ name: '测试赛', durationMinutes: 30, problemIds: ['1741:A', '1741:B'] })
    expect(c.problems.length).toBe(2)
    expect(c.status).toBe('pending')

    // 未开始不能提交
    expect(() => crepo.submit(c.id, '1741:A', 'WA')).toThrow(AppError)

    const running = crepo.start(c.id)
    expect(running.status).toBe('running')
    expect(running.startedAt).not.toBeNull()

    // 第二场同时开始被拒
    const c2 = crepo.createContest({ name: '并行赛', durationMinutes: 30, problemIds: ['1800:C'] })
    expect(() => crepo.start(c2.id)).toThrow(AppError)

    const withSub = crepo.submit(c.id, '1741:A', 'AC')
    expect(withSub.submissions.length).toBe(1)
    expect(withSub.submissions[0].secondsElapsed).toBeGreaterThanOrEqual(0)

    const finished = crepo.finish(c.id)
    expect(finished.status).toBe('finished')
    expect(() => crepo.submit(c.id, '1741:A', 'WA')).toThrow(AppError)
  })

  it('提交校验：题目不属于比赛 / 超时提交被拒 / 删除级联', () => {
    const prepo = new ProblemsRepo(db)
    prepo.upsertMany(sampleProblems, '2026-01-01 00:00:00')
    const crepo = new ContestsRepo(db)
    const c = crepo.createContest({ name: '校验赛', durationMinutes: 30, problemIds: ['1741:A'] })
    crepo.start(c.id)

    // 不属于比赛的题目
    expect(() => crepo.submit(c.id, '1741:B', 'AC')).toThrow(AppError)

    // 正常提交
    crepo.submit(c.id, '1741:A', 'AC')

    // 模拟超时：把开始时间拨回 2 小时前
    db.prepare(
      `UPDATE contests SET started_at = datetime('now','localtime','-120 minutes') WHERE id = ?`
    ).run(c.id)
    expect(() => crepo.submit(c.id, '1741:A', 'WA')).toThrow(/CONTEST_TIME_UP|时间已到/)

    // 删除级联清理提交记录
    crepo.deleteContest(c.id)
    expect(crepo.getById(c.id)).toBeNull()
    const cnt = (
      db
        .prepare('SELECT COUNT(*) AS c FROM contest_submissions WHERE contest_id = ?')
        .get(c.id) as { c: number }
    ).c
    expect(cnt).toBe(0)
  })

  it('list 返回 solvedCount', () => {
    const prepo = new ProblemsRepo(db)
    prepo.upsertMany(sampleProblems, '2026-01-01 00:00:00')
    const crepo = new ContestsRepo(db)
    const c = crepo.createContest({ name: '测试赛', durationMinutes: 30, problemIds: ['1741:A'] })
    crepo.start(c.id)
    crepo.submit(c.id, '1741:A', 'AC')
    crepo.finish(c.id)
    const list = crepo.list()
    expect(list[0].solvedCount).toBe(1)
    expect(list[0].problemCount).toBe(1)
  })
})

describe('SettingsRepo', () => {
  it('get/set/getAll', () => {
    const repo = new SettingsRepo(db)
    expect(repo.get('syncReminderEnabled')).toBeNull()
    repo.set('syncReminderEnabled', 'false')
    expect(repo.get('syncReminderEnabled')).toBe('false')
    repo.set('syncReminderEnabled', 'true')
    expect(repo.getAll()).toEqual({ syncReminderEnabled: 'true' })
  })
})

// v1.8.4：snake_case 列未取别名 → 返回对象里字段恒为 undefined（水平评估页空白根因）。
// 这里对全部仓库做一次「返回值不得含 undefined」的系统性检查，防止同类缺陷再次出现。
describe('仓库返回值字段映射（不得出现 undefined）', () => {
  const undefinedKeys = (o: object): string[] =>
    Object.entries(o)
      .filter(([, v]) => v === undefined)
      .map(([k]) => k)

  it('create/insert 返回值所有字段均有值', () => {
    new ProblemsRepo(db).upsertMany(sampleProblems, '2026-01-01 00:00:00')
    const records = new RecordsRepo(db)
    const notes = new NotesRepo(db)
    const templates = new TemplatesRepo(db)
    const contests = new ContestsRepo(db)
    const rating = new RatingRepo(db)

    const samples: [string, object][] = [
      ['problems.list', new ProblemsRepo(db).list({ limit: 1, offset: 0 }).items[0]],
      ['records.create', records.create({ problemId: '1741:A', status: 'AC' })],
      ['notes.create', notes.create({ title: 'T', content: 'C' })],
      ['templates.create', templates.create({ category: '图论', title: 'Dijkstra', code: 'x' })],
      [
        'contests.createContest',
        contests.createContest({ name: 'C', durationMinutes: 30, problemIds: ['1741:A'] })
      ],
      ['rating.insert', rating.insert(1500, 'manual')]
    ]

    for (const [label, obj] of samples) {
      expect(undefinedKeys(obj), `${label} 存在 undefined 字段: ${undefinedKeys(obj).join(',')}`).toEqual([])
    }
  })

  it('templates 时间字段有值（createdAt/updatedAt 需由 created_at/updated_at 别名映射）', () => {
    const repo = new TemplatesRepo(db)
    const t = repo.create({ category: 'DP', title: 'LIS', code: 'int lis();' })
    expect(typeof t.createdAt).toBe('string')
    expect(t.createdAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    expect(typeof t.updatedAt).toBe('string')
    expect(repo.getById(t.id)?.createdAt).toBe(t.createdAt)
    expect(repo.list({}).every((x) => typeof x.createdAt === 'string' && typeof x.updatedAt === 'string')).toBe(true)
  })
})

/**
 * v1.14.1 回归：`RecordsRepo.list()` 的 pageSize 上限是 200，
 * 而掌握度 / 水平评估 / 首页推荐 / 组卷都曾用 `list({ pageSize: 100000 })` 想取全量，
 * 结果被静默截断成 200 条（组卷甚至只在前 200 道题里抽）。
 * 下面三个用例守住「全量读取路径确实能越过 200」。
 */
describe('全量读取不得被 200 钳制（v1.14.1）', () => {
  const makeProblems = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      contestId: 2000 + Math.floor(i / 5),
      index: String.fromCharCode(65 + (i % 5)),
      name: `P${i}`,
      rating: 800 + (i % 20) * 100,
      solvedCount: i,
      tags: ['implementation']
    }))

  it('records.all() 返回全部记录，而 list 单页最多 200 条', () => {
    const problems = new ProblemsRepo(db)
    problems.upsertMany(makeProblems(260), '2026-01-01 00:00:00')
    const repo = new RecordsRepo(db)
    const ids = problems.leanAll().map((p) => p.id)
    for (const id of ids.slice(0, 260)) repo.create({ problemId: id, status: 'AC' })

    expect(repo.count()).toBe(260)
    expect(repo.all()).toHaveLength(260)
    // 旧写法（想取全量却传大 pageSize）会被钳到 200
    expect(repo.list({ page: 1, pageSize: 100000 }).items).toHaveLength(200)
    // all() 按时间倒序，count() 与长度一致
    expect(repo.all()[0].createdAt >= repo.all().at(-1)!.createdAt).toBe(true)
  })

  it('problems.leanAll() 覆盖全库且按 tags 解析、不计 practiced/lastStatus', () => {
    const repo = new ProblemsRepo(db)
    repo.upsertMany(makeProblems(260), '2026-01-01 00:00:00')
    const lean = repo.leanAll()
    expect(lean).toHaveLength(260)
    expect(lean.every((p) => Array.isArray(p.tags) && p.tags.length > 0)).toBe(true)
    expect(lean.every((p) => !p.practiced && p.lastStatus === null)).toBe(true)
  })

  it('problems.candidates() 可越过 200 取全量候选（组卷用）', () => {
    const repo = new ProblemsRepo(db)
    repo.upsertMany(makeProblems(260), '2026-01-01 00:00:00')
    // 旧实现 list 被钳到 200 → 组卷永远只能在题库前 200 题里抽
    expect(repo.list({ page: 1, pageSize: 100000, source: 'all' }).items).toHaveLength(200)
    const all = repo.candidates({ source: 'all' }, 5000)
    expect(all.length).toBe(260)
    expect(all[all.length - 1].id).not.toBe(all[0].id)
  })
})

/**
 * v1.16：首页推荐的题源筛选要与题库页共用同一个题源，
 * 标签统计（已练习 / 已 AC / 题库题数）也必须按题源收窄，
 * 否则「切到洛谷」后仍会看到 CF 的计数。
 */
describe('标签统计按题源收窄（v1.16）', () => {
  it('tagUsage 传 source 时只统计该平台题目', () => {
    const problems = new ProblemsRepo(db)
    problems.upsertMany(
      [
        { contestId: 1, index: 'A', name: 'CF A', rating: 1500, solvedCount: 10, tags: ['dp'] },
        { contestId: 2, index: 'B', name: 'CF B', rating: 1600, solvedCount: 20, tags: ['dp'] },
        {
          contestId: 0,
          index: 'P1001',
          name: 'LG 1',
          rating: null,
          difficulty: 2,
          solvedCount: 30,
          source: 'luogu',
          tags: ['dp']
        }
      ],
      '2026-01-01 00:00:00'
    )
    const records = new RecordsRepo(db)
    // CF 题 id 形如 `contestId:index`（1:A），洛谷题 id 就是 pid
    records.create({ problemId: '1:A', status: 'AC' })
    records.create({ problemId: 'P1001', status: 'AC' })

    expect(problems.tagUsage(['dp']).find((t) => t.tag === '动态规划')?.totalProblems).toBe(3)

    const dpCf = problems.tagUsage(['dp'], 'cf').find((t) => t.tag === '动态规划')!
    expect(dpCf.totalProblems).toBe(2)
    expect(dpCf.acProblems).toBe(1)

    const dpLg = problems.tagUsage(['dp'], 'luogu').find((t) => t.tag === '动态规划')!
    expect(dpLg.totalProblems).toBe(1)
    expect(dpLg.acProblems).toBe(1)
    expect(dpLg.progress).toBe(1)
  })

  it('题源与标签条件同时生效（AND 而不是 OR）', () => {
    const problems = new ProblemsRepo(db)
    problems.upsertMany(
      [
        { contestId: 1, index: 'A', name: 'CF dp', rating: 1500, solvedCount: 1, tags: ['dp'] },
        { contestId: 1, index: 'B', name: 'CF greedy', rating: 1500, solvedCount: 1, tags: ['greedy'] },
        {
          contestId: 0,
          index: 'P1',
          name: 'LG dp',
          rating: null,
          difficulty: 3,
          solvedCount: 1,
          source: 'luogu',
          tags: ['dp']
        }
      ],
      '2026-01-01 00:00:00'
    )
    const rows = problems.tagUsage(['dp'], 'cf')
    expect(rows.map((r) => r.tag)).toEqual(['动态规划'])
    expect(rows[0].totalProblems).toBe(1)
  })
})
