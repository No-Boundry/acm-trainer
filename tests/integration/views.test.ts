import { describe, it, expect, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import { initDb, closeDb } from '../../src/main/db/index'
import { ProblemsRepo } from '../../src/main/db/repositories/problems'
import { ViewsRepo } from '../../src/main/db/repositories/views'
import { createRepos } from '../../src/main/services/index'

/**
 * v1.19 FR-40：刷题记录（打开过的题）。
 *
 * 契约：
 * 1. 每次打开写一条事件，同一道题多次打开聚合成一条并给出次数；
 * 2. 列表按「最近打开时间」倒序；
 * 3. 未知题目 id 静默忽略（不写脏数据、不抛异常，避免打断题面打开）；
 * 4. 清空只影响刷题记录，不影响练习记录。
 */

function seedProblems(repo: ProblemsRepo): void {
  repo.upsertMany(
    [
      { contestId: 1, index: 'A', name: 'CF A', rating: 800, solvedCount: 10, tags: ['greedy'] },
      { contestId: 1, index: 'B', name: 'CF B', rating: 1500, solvedCount: 5, tags: ['dp'] },
      { index: 'P1001', name: 'A+B Problem', difficulty: 1, solvedCount: 0, tags: ['模拟'], source: 'luogu' }
    ],
    '2026-09-01 00:00:00'
  )
}

describe('刷题记录（ViewsRepo）', () => {
  let db: Database.Database
  let problems: ProblemsRepo
  let views: ViewsRepo

  beforeEach(() => {
    closeDb()
    db = initDb(':memory:')
    problems = new ProblemsRepo(db)
    views = new ViewsRepo(db)
    seedProblems(problems)
  })

  it('记录一次打开后能读到该题', () => {
    views.record('1:A', '2026-10-01 09:00:00')
    const rows = views.recent()
    expect(rows).toHaveLength(1)
    expect(rows[0].problemId).toBe('1:A')
    expect(rows[0].name).toBe('CF A')
    expect(rows[0].source).toBe('cf')
    expect(rows[0].rating).toBe(800)
    expect(rows[0].openCount).toBe(1)
    expect(rows[0].lastOpenedAt).toBe('2026-10-01 09:00:00')
    expect(views.count()).toBe(1)
  })

  it('同一题多次打开聚合成一条并累计次数', () => {
    views.record('1:A', '2026-10-01 09:00:00')
    views.record('1:A', '2026-10-02 10:00:00')
    views.record('1:A', '2026-10-03 11:00:00')
    const rows = views.recent()
    expect(rows).toHaveLength(1)
    expect(rows[0].openCount).toBe(3)
    expect(rows[0].firstOpenedAt).toBe('2026-10-01 09:00:00')
    expect(rows[0].lastOpenedAt).toBe('2026-10-03 11:00:00')
    expect(views.count()).toBe(3)
  })

  it('列表按最近打开时间倒序（跨题源混排）', () => {
    views.record('1:A', '2026-10-01 09:00:00')
    views.record('P1001', '2026-10-03 09:00:00')
    views.record('1:B', '2026-10-02 09:00:00')
    const rows = views.recent()
    expect(rows.map((r) => r.problemId)).toEqual(['P1001', '1:B', '1:A'])
    expect(rows[0].source).toBe('luogu')
  })

  it('最近打开优先于总次数：旧题打开十次也排在后面', () => {
    for (let i = 0; i < 10; i += 1) views.record('1:A', `2026-09-0${(i % 9) + 1} 08:00:00`)
    views.record('1:B', '2026-10-05 08:00:00')
    const rows = views.recent()
    expect(rows.map((r) => r.problemId)).toEqual(['1:B', '1:A'])
    expect(rows[1].openCount).toBe(10)
  })

  it('未知题目 id 被静默忽略', () => {
    views.record('not-exist')
    expect(views.recent()).toEqual([])
    expect(views.count()).toBe(0)
  })

  it('limit 生效且做上下界钳制', () => {
    views.record('1:A', '2026-10-01 09:00:00')
    views.record('1:B', '2026-10-02 09:00:00')
    views.record('P1001', '2026-10-03 09:00:00')
    expect(views.recent(2)).toHaveLength(2)
    expect(views.recent(0)).toHaveLength(3) // 非法值回退默认 12，不抛错
    expect(views.recent(-5)).toHaveLength(3)
  })

  it('清空只删记录，不影响题库与练习记录', () => {
    const repos = createRepos()
    repos.views.record('1:A', '2026-10-01 09:00:00')
    repos.records.create({ problemId: '1:A', status: 'AC' })
    repos.views.clear()
    expect(repos.views.recent()).toEqual([])
    expect(repos.records.count()).toBe(1)
    expect(repos.problems.getById('1:A')).toBeTruthy()
  })

  it('题目被删除时记录随之级联删除', () => {
    views.record('1:A', '2026-10-01 09:00:00')
    expect(views.count()).toBe(1)
    db.prepare('PRAGMA foreign_keys = ON').run()
    db.prepare('DELETE FROM problems WHERE id = ?').run('1:A')
    expect(views.count()).toBe(0)
  })
})
