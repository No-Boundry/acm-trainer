import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDb, closeDb } from '../../src/main/db/index'
import { ProblemsRepo } from '../../src/main/db/repositories/problems'
import type { ProblemFilter, ProblemSource } from '@shared/types'

/**
 * 题库排序（v1.9.1 修复）：
 * 「按难度」必须按各题源自己的难度列排序（CF=rating、洛谷/力扣=difficulty），
 * 「按题号」必须数字序（洛谷 P10000 在 P1001 之后）、力扣数字题号在前；
 * 空难度/空 rating 恒排最后（升降序都不翻到最前）；全部视图先按题源分组。
 */

let db: ReturnType<typeof initDb>
let repo: ProblemsRepo

beforeEach(() => {
  closeDb()
  db = initDb(':memory:')
  repo = new ProblemsRepo(db)
  // 有意打乱插入顺序，确保结果只由 ORDER BY 决定
  repo.upsertMany(
    [
      // 洛谷：难度 5 / 1 / 3 / 7 / NULL，题号含 P10000（数字序测试）
      { contestId: 0, index: 'P10000', name: 'LG-P10000', rating: null, difficulty: 5, solvedCount: 0, source: 'luogu', tags: [] },
      { contestId: 0, index: 'P1001', name: 'LG-P1001', rating: null, difficulty: 1, solvedCount: 0, source: 'luogu', tags: [] },
      { contestId: 0, index: 'P3374', name: 'LG-P3374', rating: null, difficulty: 3, solvedCount: 0, source: 'luogu', tags: [] },
      { contestId: 0, index: 'P9999', name: 'LG-P9999', rating: null, difficulty: 7, solvedCount: 0, source: 'luogu', tags: [] },
      { contestId: 0, index: 'P5000', name: 'LG-未评定', rating: null, difficulty: null, solvedCount: 0, source: 'luogu', tags: [] },
      // 力扣：难度 2 / 1 / 3 + 一道非数字题号（LCR）
      { contestId: 0, index: 'lru-cache', name: 'LRU 缓存', rating: null, difficulty: 2, solvedCount: 0, source: 'leetcode', frontendId: '146', tags: [] },
      { contestId: 0, index: 'two-sum', name: '两数之和', rating: null, difficulty: 1, solvedCount: 0, source: 'leetcode', frontendId: '1', tags: [] },
      { contestId: 0, index: 'merge-k-sorted-lists', name: '合并 K 个升序链表', rating: null, difficulty: 3, solvedCount: 0, source: 'leetcode', frontendId: '23', tags: [] },
      { contestId: 0, index: 'lcr-001', name: 'LCR 会员题', rating: null, difficulty: 1, solvedCount: 0, source: 'leetcode', frontendId: 'LCR 001', tags: [] },
      // CF：rating 1600 / 800 / NULL
      { contestId: 1741, index: 'B', name: 'CF-1741B', rating: 1600, solvedCount: 0, tags: [] },
      { contestId: 4, index: 'A', name: 'CF-4A', rating: 800, solvedCount: 0, tags: [] },
      { contestId: 9, index: 'C', name: 'CF-9C-未定级', rating: null, solvedCount: 0, tags: [] }
    ],
    '2026-10-03 10:00:00'
  )
})

afterEach(() => closeDb())

function ids(filter: Partial<ProblemFilter>, source: 'all' | ProblemSource): string[] {
  const res = repo.list({
    page: 1,
    pageSize: 100,
    source,
    sortBy: 'rating',
    sortDir: 'desc',
    ...filter
  })
  return res.items.map((i) => i.id)
}

describe('按难度排序（各题源用各自的难度列）', () => {
  it('洛谷视图：难度降序（空难度排最后）', () => {
    expect(ids({ sortBy: 'rating', sortDir: 'desc' }, 'luogu')).toEqual([
      'P9999', // 7
      'P10000', // 5
      'P3374', // 3
      'P1001', // 1
      'P5000' // NULL 排最后
    ])
  })

  it('洛谷视图：难度升序时空难度仍在最后（不翻到最前）', () => {
    expect(ids({ sortBy: 'rating', sortDir: 'asc' }, 'luogu')).toEqual([
      'P1001',
      'P3374',
      'P10000',
      'P9999',
      'P5000'
    ])
  })

  it('力扣视图：按 简单→困难 的 difficulty 排序', () => {
    const asc = repo.list({ page: 1, pageSize: 100, source: 'leetcode', sortBy: 'rating', sortDir: 'asc' })
    const desc = repo.list({ page: 1, pageSize: 100, source: 'leetcode', sortBy: 'rating', sortDir: 'desc' })
    expect(asc.items.map((i) => i.difficulty)).toEqual([1, 1, 2, 3])
    expect(asc.items[0].id).toBe('LC1')
    expect(desc.items.map((i) => i.difficulty)).toEqual([3, 2, 1, 1])
    expect(desc.items[0].id).toBe('LC23')
  })

  it('CF 视图：rating 降序，未定级（NULL）排最后', () => {
    expect(ids({ sortBy: 'rating', sortDir: 'desc' }, 'cf')).toEqual(['1741:B', '4:A', '9:C'])
  })

  it('全部视图：按题源分组（CF → 洛谷 → 力扣），组内按该源难度', () => {
    const all = ids({ sortBy: 'rating', sortDir: 'desc' }, 'all')
    expect(all.slice(0, 3)).toEqual(['1741:B', '4:A', '9:C']) // CF 组
    // 洛谷组（难度降序，未评定排组末）
    expect(all.slice(3, 8)).toEqual(['P9999', 'P10000', 'P3374', 'P1001', 'P5000'])
    // 力扣组（难度降序；同为难度 1 时按 id 降序 → LCLCR001 在 LC1 前）
    expect(all.slice(8)).toEqual(['LC23', 'LC146', 'LCLCR001', 'LC1'])
  })
})

describe('按题号排序', () => {
  it('洛谷视图：P1001 < P3374 < P10000 < P9999（数字序，不是字符串序）', () => {
    expect(ids({ sortBy: 'id', sortDir: 'asc' }, 'luogu')).toEqual([
      'P1001',
      'P3374',
      'P5000',
      'P9999',
      'P10000'
    ])
  })

  it('力扣视图：数字题号在前（1, 23, 146），非数字题号（LCR）在后', () => {
    expect(ids({ sortBy: 'id', sortDir: 'asc' }, 'leetcode')).toEqual(['LC1', 'LC23', 'LC146', 'LCLCR001'])
    expect(ids({ sortBy: 'id', sortDir: 'desc' }, 'leetcode')).toEqual(['LCLCR001', 'LC146', 'LC23', 'LC1'])
  })

  it('CF 视图：按竞赛号 + 题号字母', () => {
    expect(ids({ sortBy: 'id', sortDir: 'asc' }, 'cf')).toEqual(['4:A', '9:C', '1741:B'])
  })

  it('全部视图：先题源分组，组内按该源题号', () => {
    const all = ids({ sortBy: 'id', sortDir: 'asc' }, 'all')
    expect(all).toEqual([
      '4:A',
      '9:C',
      '1741:B',
      'P1001',
      'P3374',
      'P5000',
      'P9999',
      'P10000',
      'LC1',
      'LC23',
      'LC146',
      'LCLCR001'
    ])
  })
})

describe('按 AC 数排序', () => {
  it('solved_count 排序不受空难度影响', () => {
    repo.upsertMany(
      [
        { contestId: 100, index: 'A', name: 'hot', rating: 1000, solvedCount: 9999, tags: [] },
        { contestId: 101, index: 'A', name: 'cold', rating: 1000, solvedCount: 1, tags: [] }
      ],
      '2026-10-03 10:00:00'
    )
    const top = repo.list({ page: 1, pageSize: 2, source: 'cf', sortBy: 'solvedCount', sortDir: 'desc' })
    expect(top.items.map((i) => i.id)).toEqual(['100:A', '101:A'])
  })
})
