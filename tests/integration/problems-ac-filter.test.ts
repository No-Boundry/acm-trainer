import { describe, it, expect, beforeEach } from 'vitest'
import { initDb, closeDb } from '../../src/main/db/index'
import { ProblemsRepo } from '../../src/main/db/repositories/problems'
import { RecordsRepo } from '../../src/main/db/repositories/records'
import type { Database } from 'better-sqlite3'

/**
 * v1.20 FR-42：按「是否已经 AC 过」筛选题库（技能树详情面板的「排除已 AC / 只看已 AC」）。
 *
 * 与既有的 `practiced`（有没有提交记录）区分：这里只认 `practice_records.status = 'AC'`，
 * 所以「提交过但没 AC」的题在 `ac = 'notac'` 里仍然保留 —— 这正是补题场景需要的口径。
 */

let db: Database.Database
let repo: ProblemsRepo
let records: RecordsRepo

beforeEach(() => {
  closeDb()
  db = initDb(':memory:')
  repo = new ProblemsRepo(db)
  records = new RecordsRepo(db)
  repo.upsertMany(
    [
      { contestId: 1, index: 'A', name: 'AC 过的贪心', rating: 800, solvedCount: 100, tags: ['greedy'] },
      { contestId: 1, index: 'B', name: '只 WA 过', rating: 1200, solvedCount: 50, tags: ['greedy'] },
      { contestId: 1, index: 'C', name: '没碰过', rating: 1500, solvedCount: 80, tags: ['dp'] },
      { contestId: 1, index: 'D', name: 'AC 过的 DP', rating: 1600, solvedCount: 20, tags: ['dp'] },
      { index: 'P1001', name: 'A+B', difficulty: 1, solvedCount: 0, tags: ['模拟'], source: 'luogu' }
    ],
    '2026-09-01 00:00:00'
  )
  // 1:A 与 1:D AC；1:B 只有 WA；P1001 也 AC 过一次
  records.create({ problemId: '1:A', status: 'AC', durationMinutes: null, note: '', isMistake: false })
  records.create({ problemId: '1:D', status: 'AC', durationMinutes: null, note: '', isMistake: false })
  records.create({ problemId: '1:B', status: 'WA', durationMinutes: null, note: '', isMistake: true })
  records.create({ problemId: 'P1001', status: 'AC', durationMinutes: null, note: '', isMistake: false })
})

describe('problems:list 按是否已 AC 过滤（v1.20 FR-42）', () => {
  it('ac = ac：只返回已经 AC 过的题', () => {
    const r = repo.list({ page: 1, pageSize: 20, ac: 'ac' })
    expect(r.total).toBe(3)
    expect(r.items.map((i) => i.id).sort()).toEqual(['1:A', '1:D', 'P1001'])
  })

  it('ac = notac：只返回没有 AC 过的题（提交过但 WA 的仍算未 AC）', () => {
    const r = repo.list({ page: 1, pageSize: 20, ac: 'notac' })
    expect(r.items.map((i) => i.id).sort()).toEqual(['1:B', '1:C'])
  })

  it('ac = all（默认）不加任何额外条件', () => {
    expect(repo.list({ page: 1, pageSize: 20, ac: 'all' }).total).toBe(5)
    expect(repo.list({ page: 1, pageSize: 20 }).total).toBe(5)
  })

  it('与标签筛选组合：只看「已 AC 的贪心题」', () => {
    const r = repo.list({ page: 1, pageSize: 20, tags: ['greedy'], ac: 'ac' })
    expect(r.items.map((i) => i.id)).toEqual(['1:A'])
  })

  it('与题源筛选组合：只看洛谷里已 AC 的题', () => {
    const r = repo.list({ page: 1, pageSize: 20, source: 'luogu', ac: 'ac' })
    expect(r.items.map((i) => i.id)).toEqual(['P1001'])
  })

  it('与 practiced 语义互不影响（practiced 只看有没有提交记录）', () => {
    // 1:B 只有 WA 记录：practiced='done' 命中它，但 ac='ac' 不命中
    expect(repo.list({ page: 1, pageSize: 20, practiced: 'done' }).items.map((i) => i.id)).toContain('1:B')
    expect(repo.list({ page: 1, pageSize: 20, ac: 'ac' }).items.map((i) => i.id)).not.toContain('1:B')
  })

  it('同一题多次 AC 不会重复返回（EXISTS 而非 JOIN）', () => {
    records.create({ problemId: '1:A', status: 'AC', durationMinutes: null, note: '', isMistake: false })
    const r = repo.list({ page: 1, pageSize: 20, ac: 'ac' })
    expect(r.total).toBe(3)
    expect(r.items.filter((i) => i.id === '1:A')).toHaveLength(1)
  })

  it('删除练习记录后该题重新计入「未 AC」', () => {
    const rec = records.list({ problemId: '1:D', pageSize: 10 }).items[0]
    records.delete(rec.id)
    const r = repo.list({ page: 1, pageSize: 20, ac: 'notac' })
    expect(r.items.map((i) => i.id).sort()).toEqual(['1:B', '1:C', '1:D'])
  })
})
