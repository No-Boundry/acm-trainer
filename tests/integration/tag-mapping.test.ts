import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { initDb, closeDb, migrateProblemTagsToCanonical } from '../../src/main/db/index'
import { SCHEMA_SQL } from '../../src/main/db/schema'
import { ProblemsRepo } from '../../src/main/db/repositories/problems'
import { RecordsRepo } from '../../src/main/db/repositories/records'
import { createRepos } from '../../src/main/services/index'
import { buildSkillReport } from '../../src/main/services/skill'

/**
 * v1.18 FR-38：标签映射的落地效果。
 *
 * 三条契约：
 * 1. 写库物化：CF 题带 'greedy' 入库后，库里只有中文 canonical「贪心」。
 * 2. 查询容错：筛选传英文别名 'greedy' 与传中文「贪心」结果一致。
 * 3. 迁移幂等：旧库里的英文标签行被合并到 canonical，重复执行无变化。
 */

describe('写库物化（upsertMany）', () => {
  let db: Database.Database
  let repo: ProblemsRepo

  beforeEach(() => {
    closeDb()
    db = initDb(':memory:')
    repo = new ProblemsRepo(db)
  })

  it('英文标签写入后库里只有中文 canonical', () => {
    repo.upsertMany(
      [
        { contestId: 1, index: 'A', name: 'CF A', rating: 800, solvedCount: 10, tags: ['greedy', 'sortings'] },
        { contestId: 1, index: 'B', name: 'CF B', rating: 1500, solvedCount: 5, tags: ['dp'] }
      ],
      '2026-09-01 00:00:00'
    )
    expect(repo.getById('1:A')?.tags.sort()).toEqual(['排序', '贪心'])
    expect(repo.getById('1:B')?.tags).toEqual(['动态规划'])
    expect(repo.allTags()).toEqual(['动态规划', '排序', '贪心'].sort())
  })

  it('同一题带中英文两种写法时只留一份（不会算成命中 2 个标签）', () => {
    repo.upsertMany(
      [{ contestId: 1, index: 'A', name: 'Both', rating: 800, solvedCount: 1, tags: ['greedy', '贪心', 'dp', '动态规划 DP'] }],
      '2026-09-01 00:00:00'
    )
    expect(repo.getById('1:A')?.tags.sort()).toEqual(['动态规划', '贪心'])
  })

  it('来源/赛事类标签原样保留', () => {
    repo.upsertMany(
      [{ contestId: 1, index: 'A', name: 'SP', rating: 800, solvedCount: 1, tags: ['Special Judge', 'greedy', 'ICPC'] }],
      '2026-09-01 00:00:00'
    )
    expect(repo.getById('1:A')?.tags.sort()).toEqual(['ICPC', 'Special Judge', '贪心'].sort())
  })
})

describe('跨语言筛选对齐', () => {
  let db: Database.Database
  let repo: ProblemsRepo

  beforeEach(() => {
    closeDb()
    db = initDb(':memory:')
    repo = new ProblemsRepo(db)
    repo.upsertMany(
      [
        // CF 题：英文标签
        { contestId: 1, index: 'A', name: 'CF Greedy', rating: 800, solvedCount: 100, tags: ['greedy'] },
        { contestId: 1, index: 'B', name: 'CF DSU', rating: 1600, solvedCount: 20, tags: ['dsu'] },
        // 洛谷题：中文标签
        { index: 'P1001', name: '洛谷 贪心', difficulty: 2, solvedCount: 500, tags: ['贪心'], source: 'luogu' } as never,
        { index: 'P2001', name: '洛谷 并查集', difficulty: 4, solvedCount: 90, tags: ['并查集'], source: 'luogu' } as never
      ],
      '2026-09-01 00:00:00'
    )
  })

  it('选「贪心」同时命中 CF 与洛谷题', () => {
    const r = repo.list({ page: 1, pageSize: 20, tags: ['贪心'] })
    expect(r.total).toBe(2)
    expect(r.items.map((p) => p.id).sort()).toEqual(['1:A', 'P1001'].sort())
  })

  it('传英文别名 greedy 与传中文「贪心」结果一致', () => {
    const zh = repo.list({ page: 1, pageSize: 20, tags: ['贪心'] })
    const en = repo.list({ page: 1, pageSize: 20, tags: ['greedy'] })
    expect(en.total).toBe(zh.total)
    expect(en.items.map((p) => p.id).sort()).toEqual(zh.items.map((p) => p.id).sort())
  })

  it('中英文写法混着传不会重复计数（命中数排序口径正确）', () => {
    const r = repo.list({ page: 1, pageSize: 20, tags: ['greedy', '贪心'] })
    expect(r.total).toBe(2)
  })

  it('tagsAny（题单抽题）同样支持别名', () => {
    expect(repo.idsForKnowledge(['dsu']).sort()).toEqual(['1:B', 'P2001'].sort())
    expect(repo.idsForKnowledge(['并查集']).sort()).toEqual(['1:B', 'P2001'].sort())
  })

  it('tagUsage 用别名查询，返回的 tag 是 canonical', () => {
    const rows = repo.tagUsage(['greedy'])
    expect(rows.map((r) => r.tag)).toEqual(['贪心'])
    expect(rows[0].totalProblems).toBe(2)
  })
})

describe('技能报告：节点标签与题目标签对齐', () => {
  let db: Database.Database
  let repos: ReturnType<typeof createRepos>

  beforeEach(() => {
    closeDb()
    db = initDb(':memory:')
    repos = createRepos(db)
  })

  it('节点 tags 下发为 canonical，练习记录能计入节点统计', () => {
    repos.problems.upsertMany(
      [
        { contestId: 1, index: 'A', name: 'CF DSU', rating: 1600, solvedCount: 20, tags: ['dsu'] },
        { contestId: 1, index: 'B', name: 'CF Greedy', rating: 800, solvedCount: 100, tags: ['greedy'] }
      ],
      '2026-09-01 00:00:00'
    )
    const records = repos.records as RecordsRepo
    records.create({ problemId: '1:A', status: 'AC' })
    records.create({ problemId: '1:B', status: 'AC' })

    const report = buildSkillReport(repos)
    const dsu = report.nodes.find((n) => n.id === 'dsu')!
    const greedy = report.nodes.find((n) => n.id === 'greedy')!
    expect(dsu.tags).toEqual(['并查集'])
    expect(dsu.stats.attempted).toBe(1)
    expect(dsu.stats.acProblems).toBe(1)
    expect(greedy.tags).toEqual(['贪心'])
    expect(greedy.stats.acProblems).toBe(1)
  })
})

describe('旧库迁移 migrateProblemTagsToCanonical', () => {
  let db: Database.Database

  beforeEach(() => {
    // 直接建裸库：只有 schema，然后手工塞入「英文标签」模拟旧库
    db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    db.exec(SCHEMA_SQL)
    db.prepare(
      `INSERT INTO problems (id, contest_id, "index", name, rating, difficulty, solved_count,
                             total_submit, source, cf_url, fetched_at)
       VALUES ('1:A', 1, 'A', 'Old A', 800, NULL, 10, 0, 'cf', 'https://codeforces.com/1/A', '2026-01-01 00:00:00'),
              ('P1001', 0, 'P1001', 'Old P', NULL, 1, 20, 0, 'luogu', 'https://luogu.com/P1001', '2026-01-01 00:00:00')`
    ).run()
    const insertTag = db.prepare('INSERT INTO tags (name) VALUES (?)')
    const link = db.prepare('INSERT INTO problem_tags (problem_id, tag_id) VALUES (?, ?)')
    // 旧库形态：CF 题挂英文 'greedy'，洛谷题挂中文 '贪心'，另有 dsu / 并查集
    for (const [name, pid] of [
      ['greedy', '1:A'],
      ['贪心', 'P1001'],
      ['dsu', '1:A'],
      ['并查集', 'P1001'],
      ['Special Judge', '1:A']
    ] as [string, string][]) {
      const info = insertTag.run(name)
      link.run(pid, Number(info.lastInsertRowid))
    }
  })

  it('把英文标签行合并到中文 canonical，并保留该题的其他标签', () => {
    const merged = migrateProblemTagsToCanonical(db)
    expect(merged).toBe(2) // greedy、dsu
    const tagRows = db.prepare('SELECT name FROM tags ORDER BY name').all() as { name: string }[]
    expect(tagRows.map((r) => r.name).sort()).toEqual(['Special Judge', '并查集', '贪心'].sort())
    // 同一题同时有 greedy 与 dsu → 合并后是 贪心 + 并查集；Special Judge 属于来源/赛事类标签，原样保留
    const rows = db
      .prepare(
        `SELECT t.name FROM problem_tags pt JOIN tags t ON t.id = pt.tag_id
          WHERE pt.problem_id = '1:A' ORDER BY t.name`
      )
      .all() as { name: string }[]
    expect(rows.map((r) => r.name).sort()).toEqual(['Special Judge', '并查集', '贪心'].sort())
  })

  it('题目同时带中英文写法时不会重复插入关联（UNIQUE 生效）', () => {
    const insertTag = db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)')
    const tagId = db.prepare('SELECT id FROM tags WHERE name = ?')
    const link = db.prepare('INSERT OR IGNORE INTO problem_tags (problem_id, tag_id) VALUES (?, ?)')
    insertTag.run('贪心')
    const id = (tagId.get('贪心') as { id: number }).id
    link.run('1:A', id) // '1:A' 已同时挂了 greedy 与 贪心

    migrateProblemTagsToCanonical(db)
    const count = (
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM problem_tags pt JOIN tags t ON t.id = pt.tag_id
            WHERE pt.problem_id = '1:A' AND t.name = '贪心'`
        )
        .get() as { c: number }
    ).c
    expect(count).toBe(1)
  })

  it('幂等：再执行一次没有变化', () => {
    migrateProblemTagsToCanonical(db)
    const before = db.prepare('SELECT id, name FROM tags ORDER BY id').all()
    expect(migrateProblemTagsToCanonical(db)).toBe(0)
    const after = db.prepare('SELECT id, name FROM tags ORDER BY id').all()
    expect(after).toEqual(before)
  })

  it('迁移后按中文筛选能同时取到原来挂英文的题', () => {
    migrateProblemTagsToCanonical(db)
    const repo = new ProblemsRepo(db)
    const r = repo.list({ page: 1, pageSize: 20, tags: ['贪心'] })
    expect(r.total).toBe(2)
    expect(r.items.map((p) => p.id).sort()).toEqual(['1:A', 'P1001'].sort())
  })
})
