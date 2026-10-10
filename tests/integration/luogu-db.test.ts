import { describe, it, expect, beforeEach } from 'vitest'
import { initDb, closeDb } from '../../src/main/db/index'
import { ProblemsRepo } from '../../src/main/db/repositories/problems'
import { SCHEMA_SQL } from '../../src/main/db/schema'
import Database from 'better-sqlite3'
import { tmpdir } from 'os'
import { join } from 'path'
import { unlinkSync } from 'fs'
import type { ProblemUpsertInput } from '@shared/types'

/**
 * 洛谷数据源数据层（v1.1 FR-8）：
 * 双源共存 / source 过滤 / 洛谷数字序 / 难度筛选 / 旧库迁移幂等。
 */

let db: Database.Database
let repo: ProblemsRepo

const cfInputs: ProblemUpsertInput[] = [
  { contestId: 1741, index: 'A', name: 'CF-A', rating: 800, solvedCount: 10, tags: ['implementation'] },
  { contestId: 1741, index: 'B', name: 'CF-B', rating: 1200, solvedCount: 5, tags: ['math'] }
]

const luoguInputs: ProblemUpsertInput[] = [
  { contestId: 0, index: 'P1000', name: '超级玛丽游戏', rating: null, difficulty: 1, solvedCount: 703083, totalSubmit: 1833173, source: 'luogu', tags: ['模拟', '语言入门'] },
  { contestId: 0, index: 'P1002', name: '过河卒', rating: null, difficulty: 2, solvedCount: 100, totalSubmit: 200, source: 'luogu', tags: ['动态规划 DP'] },
  { contestId: 0, index: 'P1010', name: '幂次方', rating: null, difficulty: 2, solvedCount: 80, totalSubmit: 150, source: 'luogu', tags: ['数学'] }
]

beforeEach(() => {
  closeDb()
  db = initDb(':memory:')
  repo = new ProblemsRepo(db)
})

describe('双源共存与 upsert（FR-8.7）', () => {
  it('cf 与 luogu 同时入库互不冲突', () => {
    const r1 = repo.upsertMany(cfInputs, '2026-01-01 00:00:00')
    const r2 = repo.upsertMany(luoguInputs, '2026-01-02 00:00:00')
    expect(r1.added).toBe(2)
    expect(r2.added).toBe(3)
    expect(repo.count()).toBe(5)
    expect(repo.count('cf')).toBe(2)
    expect(repo.count('luogu')).toBe(3)
  })

  it('洛谷行字段映射正确（id/contestId/难度/URL）', () => {
    repo.upsertMany(luoguInputs, '2026-01-02 00:00:00')
    const p = repo.getById('P1000')
    expect(p?.source).toBe('luogu')
    expect(p?.contestId).toBe(0)
    expect(p?.rating).toBeNull()
    expect(p?.difficulty).toBe(1)
    expect(p?.totalSubmit).toBe(1833173)
    expect(p?.cfUrl).toBe('https://www.luogu.com.cn/problem/P1000')
    expect(p?.tags).toContain('模拟')
    // CF 行不受影响
    repo.upsertMany(cfInputs, '2026-01-01 00:00:00')
    const cf = repo.getById('1741:A')
    expect(cf?.source).toBe('cf')
    expect(cf?.difficulty).toBeNull()
  })

  it('重复同步幂等（updated 计数）', () => {
    repo.upsertMany(luoguInputs, '2026-01-02 00:00:00')
    const again = repo.upsertMany(luoguInputs, '2026-01-03 00:00:00')
    expect(again.added).toBe(0)
    expect(again.updated).toBe(3)
    expect(repo.count('luogu')).toBe(3)
  })
})

describe('source 过滤与排序（FR-8.2/8.4）', () => {
  beforeEach(() => {
    repo.upsertMany(cfInputs, '2026-01-01 00:00:00')
    repo.upsertMany(luoguInputs, '2026-01-02 00:00:00')
  })

  it('source=luogu 仅返回洛谷行', () => {
    const res = repo.list({ page: 1, pageSize: 50, source: 'luogu' })
    expect(res.total).toBe(3)
    expect(res.items.every((p) => p.source === 'luogu')).toBe(true)
  })

  it('source=cf 仅返回 CF 行', () => {
    const res = repo.list({ page: 1, pageSize: 50, source: 'cf' })
    expect(res.total).toBe(2)
  })

  it('洛谷视图按题号数字序（P1000 < P1002 < P1010）', () => {
    const res = repo.list({ page: 1, pageSize: 50, source: 'luogu', sortBy: 'id', sortDir: 'asc' })
    expect(res.items.map((p) => p.id)).toEqual(['P1000', 'P1002', 'P1010'])
  })

  it('洛谷难度筛选', () => {
    const res = repo.list({ page: 1, pageSize: 50, source: 'luogu', difficulty: 2 })
    expect(res.total).toBe(2)
    expect(res.items.every((p) => p.difficulty === 2)).toBe(true)
  })

  it('全部视图含两源且洛谷行排 CF 之后', () => {
    const res = repo.list({ page: 1, pageSize: 50, sortBy: 'id', sortDir: 'asc' })
    expect(res.total).toBe(5)
    const idxLuogu = res.items.findIndex((p) => p.source === 'luogu')
    const idxCf = res.items.findIndex((p) => p.source === 'cf')
    expect(idxLuogu).toBeGreaterThan(idxCf)
  })

  it('keyword 跨源匹配', () => {
    const res = repo.list({ page: 1, pageSize: 50, keyword: 'P1002' })
    expect(res.total).toBe(1)
    expect(res.items[0].id).toBe('P1002')
  })
})

describe('旧库迁移（v0.1 → v1.1，FR-8.7）', () => {
  it('旧 schema（无新列）initDb 后补齐列且旧数据标 cf', () => {
    // 用旧版 DDL 建临时文件库并插入一条 CF 题
    const tmp = join(tmpdir(), `acm-migrate-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
    const preDb = new Database(tmp)
    preDb.exec(`
      CREATE TABLE problems (
        id TEXT PRIMARY KEY, contest_id INTEGER NOT NULL, "index" TEXT NOT NULL,
        name TEXT NOT NULL, rating INTEGER, solved_count INTEGER NOT NULL DEFAULT 0,
        cf_url TEXT NOT NULL, fetched_at TEXT NOT NULL, UNIQUE (contest_id, "index")
      );
      INSERT INTO problems VALUES ('1741:A', 1741, 'A', 'Old', 800, 10,
        'https://codeforces.com/problemset/problem/1741/A', '2026-01-01 00:00:00');
    `)
    preDb.close()
    closeDb()
    const migrated = initDb(tmp)
    // 迁移后：新列存在
    const cols = migrated.pragma('table_info(problems)') as { name: string }[]
    const names = cols.map((c) => c.name)
    expect(names).toContain('source')
    expect(names).toContain('difficulty')
    expect(names).toContain('total_submit')
    // 旧数据 source 默认 'cf'
    const oldRow = migrated
      .prepare('SELECT source, difficulty FROM problems WHERE id = ?')
      .get('1741:A') as { source: string; difficulty: number | null }
    expect(oldRow.source).toBe('cf')
    expect(oldRow.difficulty).toBeNull()
    // 迁移后可正常写入洛谷题
    const repo2 = new ProblemsRepo(migrated)
    repo2.upsertMany(luoguInputs.slice(0, 1), '2026-02-01 00:00:00')
    expect(repo2.count()).toBe(2)
    closeDb()
    unlinkSync(tmp)
  })

  it('新库直接含新列（SCHEMA_SQL 幂等）', () => {
    db.exec(SCHEMA_SQL)
    const cols = db.pragma('table_info(problems)') as { name: string }[]
    const names = cols.map((c) => c.name)
    expect(names).toContain('source')
    expect(names).toContain('difficulty')
    expect(names).toContain('total_submit')
  })
})
