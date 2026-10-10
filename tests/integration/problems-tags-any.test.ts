import { describe, it, expect, beforeEach } from 'vitest'
import { initDb, closeDb } from '../../src/main/db/index'
import { ProblemsRepo } from '../../src/main/db/repositories/problems'
import type { Database } from 'better-sqlite3'

/**
 * 题库筛选：v1.8 新增 tagsAny（OR 语义）用于「知识点」多选并集筛选，
 * 与原 tags（AND 语义）共存互不影响。
 */

let db: Database.Database
let repo: ProblemsRepo

beforeEach(() => {
  closeDb()
  db = initDb(':memory:')
  repo = new ProblemsRepo(db)
  repo.upsertMany(
    [
      { contestId: 1, index: 'A', name: 'Greedy Easy', rating: 800, solvedCount: 100, tags: ['greedy', 'sortings'] },
      { contestId: 1, index: 'B', name: 'DP Hard', rating: 1800, solvedCount: 50, tags: ['dp'] },
      { contestId: 1, index: 'C', name: 'Graph', rating: 1500, solvedCount: 80, tags: ['graphs', 'dp'] },
      { contestId: 1, index: 'D', name: 'Nobody', rating: 2000, solvedCount: 10, tags: [] }
    ],
    '2026-09-01 00:00:00'
  )
})

describe('problems:list 标签过滤语义', () => {
  it('tagsAny（OR）：命中任一标签即返回，用于知识点并集筛选', () => {
    const r = repo.list({ page: 1, pageSize: 20, tagsAny: ['greedy', 'dp'] })
    expect(r.total).toBe(3) // 1:A（greedy）、1:B（dp）、1:C（dp）
    const ids = r.items.map((i) => i.id).sort()
    expect(ids).toEqual(['1:A', '1:B', '1:C'])
  })

  it('tagsAny 与 tags（AND）叠加：两者同时满足', () => {
    const r = repo.list({ page: 1, pageSize: 20, tags: ['dp'], tagsAny: ['graphs', 'sortings'] })
    // 需要含 dp，且含 graphs 或 sortings → 只有 1:C（dp+graphs）
    expect(r.total).toBe(1)
    expect(r.items[0].id).toBe('1:C')
  })

  it('tagsAny 为空数组时不施加过滤', () => {
    const r = repo.list({ page: 1, pageSize: 20, tagsAny: [] })
    expect(r.total).toBe(4)
  })

  it('tagsAny 可与数据源/难度等条件组合', () => {
    const r = repo.list({ page: 1, pageSize: 20, tagsAny: ['dp'], ratingMin: 1600 })
    expect(r.total).toBe(1)
    expect(r.items[0].id).toBe('1:B')
  })

  it('未知标签 → 无结果（不报错）', () => {
    const r = repo.list({ page: 1, pageSize: 20, tagsAny: ['not-exist-tag'] })
    expect(r.total).toBe(0)
  })
})
