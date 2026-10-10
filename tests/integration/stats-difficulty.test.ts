import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import Database from 'better-sqlite3'
import { initDb, closeDb } from '../../src/main/db/index'
import { ProblemsRepo } from '../../src/main/db/repositories/problems'
import { RecordsRepo } from '../../src/main/db/repositories/records'
import type { ProblemUpsertInput } from '@shared/types'

/**
 * 难度分布统计（v1.9 FR-22）与 v1.9 迁移（FR-21：problems.source CHECK 增加 leetcode）。
 */

function seedProblems(repo: ProblemsRepo): void {
  const inputs: ProblemUpsertInput[] = [
    // CF：三档 rating
    { contestId: 1, index: 'A', name: 'CF-800', rating: 800, solvedCount: 0, tags: [] },
    { contestId: 2, index: 'B', name: 'CF-1200', rating: 1200, solvedCount: 0, tags: [] },
    { contestId: 3, index: 'C', name: 'CF-3000', rating: 3000, solvedCount: 0, tags: [] },
    // 洛谷：难度 1 / 3
    { contestId: 0, index: 'P1000', name: 'LG-1', rating: null, difficulty: 1, solvedCount: 0, source: 'luogu', tags: [] },
    { contestId: 0, index: 'P1001', name: 'LG-3', rating: null, difficulty: 3, solvedCount: 0, source: 'luogu', tags: [] },
    // 力扣：难度 1 / 2
    { contestId: 0, index: 'two-sum', name: '两数之和', rating: null, difficulty: 1, solvedCount: 0, source: 'leetcode', frontendId: '1', tags: [] },
    { contestId: 0, index: 'add-two-numbers', name: '两数相加', rating: null, difficulty: 2, solvedCount: 0, source: 'leetcode', frontendId: '2', tags: [] }
  ]
  repo.upsertMany(inputs, '2026-09-20 10:00:00')
}

describe('records.difficultyStats（按题目难度标签统计）', () => {
  let db: ReturnType<typeof initDb>
  let problems: ProblemsRepo
  let records: RecordsRepo

  beforeEach(() => {
    closeDb()
    db = initDb(':memory:')
    problems = new ProblemsRepo(db)
    records = new RecordsRepo(db)
    seedProblems(problems)
  })
  afterEach(() => closeDb())

  it('空库：三题源 attempted=0（不报错）', () => {
    const s = records.difficultyStats()
    expect(s.cf.attempted).toBe(0)
    expect(s.luogu.attempted).toBe(0)
    expect(s.leetcode.attempted).toBe(0)
    expect(s.leetcode.buckets.map((b) => b.key)).toEqual(['d1', 'd2', 'd3'])
  })

  it('按题源与难度档聚合：去重题目数 + 曾 AC 题数', () => {
    // CF 800：先 WA 后 AC（同题两条记录）→ 1 题 / 1 AC
    records.create({ problemId: '1:A', status: 'WA' })
    records.create({ problemId: '1:A', status: 'AC' })
    // CF 1200：未 AC
    records.create({ problemId: '2:B', status: 'WA' })
    // CF 3000：AC
    records.create({ problemId: '3:C', status: 'AC' })
    // 洛谷 1：AC；洛谷 3：WA
    records.create({ problemId: 'P1000', status: 'AC' })
    records.create({ problemId: 'P1001', status: 'WA' })
    // 力扣 简单 AC；中等 WA
    records.create({ problemId: 'LC1', status: 'AC' })
    records.create({ problemId: 'LC2', status: 'WA' })

    const s = records.difficultyStats()

    expect(s.cf.attempted).toBe(3)
    expect(s.cf.ac).toBe(2)
    const cf800 = s.cf.buckets.find((b) => b.key === '800')!
    expect(cf800).toMatchObject({ label: '800–999', attempted: 1, ac: 1, acRate: 100 })
    expect(s.cf.buckets.find((b) => b.key === '1200')).toMatchObject({ attempted: 1, ac: 0, acRate: 0 })
    expect(s.cf.buckets.find((b) => b.key === 'ge3000')).toMatchObject({ attempted: 1, ac: 1 })
    // CF 空档（1000–1199）被补齐且为 0
    expect(s.cf.buckets.find((b) => b.key === '1000')?.attempted).toBe(0)

    expect(s.luogu.attempted).toBe(2)
    expect(s.luogu.ac).toBe(1)
    expect(s.luogu.buckets.find((b) => b.key === 'd1')).toMatchObject({ attempted: 1, ac: 1, share: 50 })
    expect(s.luogu.buckets.find((b) => b.key === 'd3')).toMatchObject({ attempted: 1, ac: 0, share: 50 })

    expect(s.leetcode.attempted).toBe(2)
    expect(s.leetcode.ac).toBe(1)
    const lcEasy = s.leetcode.buckets.find((b) => b.key === 'd1')!
    const lcMid = s.leetcode.buckets.find((b) => b.key === 'd2')!
    expect(lcEasy).toMatchObject({ label: '简单', attempted: 1, ac: 1, acRate: 100, share: 50 })
    expect(lcMid).toMatchObject({ label: '中等', attempted: 1, ac: 0, acRate: 0, share: 50 })
    expect(s.leetcode.buckets.find((b) => b.key === 'd3')).toMatchObject({ label: '困难', attempted: 0 })
  })

  it('删除全部记录后回到零（统计不残留）', () => {
    const rec = records.create({ problemId: 'LC1', status: 'AC' })
    expect(records.difficultyStats().leetcode.attempted).toBe(1)
    records.delete(rec.id)
    expect(records.difficultyStats().leetcode.attempted).toBe(0)
  })
})

describe('v1.9 迁移：旧库 source CHECK 只允许 cf/luogu 时重建表', () => {
  let dir: string
  let dbPath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'acm-migrate-'))
    dbPath = join(dir, 'acm-trainer.db')
  })
  afterEach(() => {
    closeDb()
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  })

  it('保留既有数据与外键级联，并允许写入 leetcode 行', () => {
    // 1) 手工构造 v1.8 形态的旧库（CHECK 只允许 cf/luogu）
    const old = new Database(dbPath)
    old.pragma('foreign_keys = ON')
    old.exec(`
      CREATE TABLE problems (
        id TEXT PRIMARY KEY,
        contest_id INTEGER NOT NULL,
        "index" TEXT NOT NULL,
        name TEXT NOT NULL,
        rating INTEGER,
        difficulty INTEGER,
        solved_count INTEGER NOT NULL DEFAULT 0,
        total_submit INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'cf' CHECK (source IN ('cf','luogu')),
        cf_url TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        UNIQUE (contest_id, "index")
      );
      CREATE TABLE tags (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE);
      CREATE TABLE problem_tags (
        problem_id TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
        tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (problem_id, tag_id)
      );
      CREATE TABLE practice_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        problem_id TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        duration_seconds INTEGER,
        note TEXT,
        is_mistake INTEGER NOT NULL DEFAULT 0,
        import_source TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );
      INSERT INTO problems (id, contest_id, "index", name, rating, difficulty, solved_count,
                            total_submit, source, cf_url, fetched_at)
        VALUES ('1741:A', 1741, 'A', '旧CF题', 800, NULL, 100, 200, 'cf',
                'https://codeforces.com/problemset/problem/1741/A', '2026-01-01 00:00:00'),
               ('P1000', 0, 'P1000', '旧洛谷题', NULL, 1, 10, 20, 'luogu',
                'https://www.luogu.com.cn/problem/P1000', '2026-01-01 00:00:00');
      INSERT INTO tags (name) VALUES ('贪心');
      INSERT INTO problem_tags (problem_id, tag_id) VALUES ('1741:A', 1);
      INSERT INTO practice_records (problem_id, status) VALUES ('1741:A', 'AC'), ('P1000', 'WA');
    `)
    old.close()

    // 2) 走应用初始化（应触发重建迁移）
    const db = initDb(dbPath)
    const problems = new ProblemsRepo(db)
    const records = new RecordsRepo(db)

    // 旧数据完整保留（含标签关联与练习记录）
    expect(problems.count()).toBe(2)
    expect(problems.getById('1741:A')).toMatchObject({ name: '旧CF题', rating: 800, source: 'cf' })
    expect(problems.getById('1741:A')?.tags).toEqual(['贪心'])
    expect(problems.getById('P1000')).toMatchObject({ source: 'luogu', difficulty: 1 })
    expect(records.list({ page: 1, pageSize: 10 }).total).toBe(2)

    // 新数据源可写入
    problems.upsertMany(
      [
        {
          contestId: 0,
          index: 'two-sum',
          name: '两数之和',
          rating: null,
          difficulty: 1,
          solvedCount: 5,
          source: 'leetcode',
          frontendId: '1',
          tags: []
        }
      ],
      '2026-09-20 10:00:00'
    )
    expect(problems.getById('LC1')).toMatchObject({ name: '两数之和', source: 'leetcode', difficulty: 1 })
    expect(problems.lastSync()).toMatchObject({ cf: '2026-01-01 00:00:00', luogu: '2026-01-01 00:00:00', leetcode: '2026-09-20 10:00:00' })

    // 迁移后外键约束仍生效（删题级联删记录）
    db.prepare('DELETE FROM problems WHERE id = ?').run('1741:A')
    expect(records.list({ problemId: '1741:A', page: 1, pageSize: 10 }).total).toBe(0)

    // CHECK 约束仍拦截非法来源
    expect(() =>
      db
        .prepare(
          `INSERT INTO problems (id, contest_id, "index", name, rating, difficulty, solved_count,
                                 total_submit, source, cf_url, fetched_at)
           VALUES ('X', 0, 'x', 'x', NULL, NULL, 0, 0, 'atcoder', 'https://x/', '2026-01-01 00:00:00')`
        )
        .run()
    ).toThrow(/CHECK/)
  })
})
