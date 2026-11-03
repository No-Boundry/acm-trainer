import { describe, it, expect, beforeEach } from 'vitest'
import { initDb, closeDb } from '../../src/main/db/index'
import { ProblemsRepo, buildOrderSql } from '../../src/main/db/repositories/problems'
import type { Database } from 'better-sqlite3'

/**
 * v1.17：题库标签筛选从**交集**改为**并集**，并按「命中的标签数」降序排列。
 *
 * 背景：知识点（技能树节点）会挂多个标签，交集语义下选一个节点常筛不出题
 * （要求题目同时带全部标签），与「点节点 = 勾选它关联的全部标签」的预期相反。
 */

let db: Database.Database
let repo: ProblemsRepo

beforeEach(() => {
  closeDb()
  db = initDb(':memory:')
  repo = new ProblemsRepo(db)
  repo.upsertMany(
    [
      { contestId: 1, index: 'A', name: 'Greedy Only', rating: 800, solvedCount: 100, tags: ['greedy', 'sortings'] },
      { contestId: 1, index: 'B', name: 'DP Only', rating: 1800, solvedCount: 50, tags: ['dp'] },
      { contestId: 1, index: 'C', name: 'Graph+DP', rating: 1500, solvedCount: 80, tags: ['graphs', 'dp'] },
      { contestId: 1, index: 'D', name: 'No Tags', rating: 2000, solvedCount: 10, tags: [] },
      { contestId: 1, index: 'E', name: 'Greedy+DP', rating: 1200, solvedCount: 30, tags: ['greedy', 'dp'] }
    ],
    '2026-09-01 00:00:00'
  )
})

describe('problems:list 标签并集（v1.17）', () => {
  it('多选标签取并集：命中任一标签即返回', () => {
    const r = repo.list({ page: 1, pageSize: 20, tags: ['greedy', 'dp'] })
    expect(r.total).toBe(4) // A(greedy) B(dp) C(dp) E(greedy+dp)
    expect(r.items.map((i) => i.id).sort()).toEqual(['1:A', '1:B', '1:C', '1:E'])
  })

  it('命中标签数多的排在前面', () => {
    const r = repo.list({ page: 1, pageSize: 20, tags: ['greedy', 'dp'], sortBy: 'rating', sortDir: 'desc' })
    // 1:E 同时含 greedy+dp（2 个），其余各命中 1 个 → E 必在最前
    expect(r.items[0].id).toBe('1:E')
  })

  it('命中数相同时按用户选择的排序方式（难度降序）排列', () => {
    const r = repo.list({ page: 1, pageSize: 20, tags: ['greedy', 'dp'], sortBy: 'rating', sortDir: 'desc' })
    // 命中的 1 个标签组：1:B(1800) > 1:C(1500) > 1:A(800)
    expect(r.items.slice(1).map((i) => i.id)).toEqual(['1:B', '1:C', '1:A'])
  })

  it('命中数相同时按题号排序也成立（排序键只是次级）', () => {
    const r = repo.list({ page: 1, pageSize: 20, tags: ['greedy', 'dp'], sortBy: 'id', sortDir: 'asc' })
    expect(r.items.map((i) => i.id)).toEqual(['1:E', '1:A', '1:B', '1:C'])
  })

  it('单选标签行为不变（等价于按该标签过滤）', () => {
    const r = repo.list({ page: 1, pageSize: 20, tags: ['dp'] })
    expect(r.total).toBe(3)
    expect(r.items.map((i) => i.id).sort()).toEqual(['1:B', '1:C', '1:E'])
  })

  it('并集可与难度区间、题源条件组合', () => {
    const r = repo.list({ page: 1, pageSize: 20, tags: ['greedy', 'dp'], ratingMin: 1400 })
    expect(r.items.map((i) => i.id).sort()).toEqual(['1:B', '1:C'])
  })

  it('分页时 total 反映并集总数（不是交集）', () => {
    const r = repo.list({ page: 1, pageSize: 2, tags: ['greedy', 'dp'] })
    expect(r.total).toBe(4)
    expect(r.items).toHaveLength(2)
    expect(r.items[0].id).toBe('1:E')
  })

  it('未知标签在并集里被忽略（不报错、不扩大结果）', () => {
    const r = repo.list({ page: 1, pageSize: 20, tags: ['greedy', 'not-exist'] })
    expect(r.total).toBe(2) // 1:A、1:E 都带 greedy
    expect(r.items.map((i) => i.id).sort()).toEqual(['1:A', '1:E'])
  })
})

describe('buildOrderSql 的命中数前缀（v1.17）', () => {
  it('未选标签时不生成命中数子查询（与旧版 ORDER BY 一致）', () => {
    const sql = buildOrderSql({ source: 'cf', sortBy: 'rating', sortDir: 'desc' })
    expect(sql).not.toContain('COUNT(DISTINCT t.id)')
    expect(sql).toBe('p.rating IS NULL ASC, p.rating DESC, p.id DESC')
  })

  it('选了标签时把命中数作为第一排序键', () => {
    const sql = buildOrderSql({ source: 'cf', sortBy: 'rating', sortDir: 'desc', tags: ['greedy', 'dp'] })
    expect(sql.startsWith('(SELECT COUNT(DISTINCT t.id)')).toBe(true)
    expect(sql).toContain('@tag0, @tag1')
    expect(sql).toContain('p.rating DESC')
  })
})
