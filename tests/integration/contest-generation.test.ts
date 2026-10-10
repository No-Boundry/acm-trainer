import { describe, it, expect, beforeEach } from 'vitest'
import { initDb, closeDb } from '../../src/main/db/index'
import { ProblemsRepo } from '../../src/main/db/repositories/problems'
import { generateProblemSelection } from '../../src/main/services/contest'
import { AppError } from '../../src/main/db/errors'
import type { Database } from 'better-sqlite3'
import type { ProblemUpsertInput } from '@shared/types'

let db: Database.Database
let repo: ProblemsRepo

beforeEach(() => {
  closeDb()
  db = initDb(':memory:')
  repo = new ProblemsRepo(db)
})

function seedRatings(ratings: number[]): void {
  const inputs: ProblemUpsertInput[] = ratings.map((rating, i) => ({
    contestId: 1000 + i,
    index: 'A',
    name: `P${i}`,
    rating,
    solvedCount: 1,
    tags: ['test']
  }))
  repo.upsertMany(inputs, '2026-01-01 00:00:00')
}

describe('generateProblemSelection（组卷，04 §2.3）', () => {
  it('候选 30 题 rating 800–2000，count=5 → 5 题不重复、难度覆盖广', () => {
    const ratings = Array.from({ length: 30 }, (_, i) => 800 + i * 40) // 800..1960
    seedRatings(ratings)
    const picked = generateProblemSelection(repo, { count: 5, ratingMin: 800, ratingMax: 2000 })
    expect(picked.length).toBe(5)
    expect(new Set(picked).size).toBe(5)

    // 从题库读取实际 rating 校验覆盖度
    const ratingsOf = repo.byIds(picked).map((p) => p.rating as number)
    const spread = Math.max(...ratingsOf) - Math.min(...ratingsOf)
    expect(spread).toBeGreaterThan(400) // 覆盖多个难度分桶
    // 升序
    const sorted = [...ratingsOf]
    expect(ratingsOf).toEqual(sorted.sort((a, b) => a - b))
  })

  it('排除已用题目生效', () => {
    seedRatings([800, 900, 1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700])
    const exclude = generateProblemSelection(repo, { count: 3, ratingMin: 800, ratingMax: 2000 })
    const again = generateProblemSelection(repo, {
      count: 3,
      ratingMin: 800,
      ratingMax: 2000,
      excludeIds: exclude
    })
    for (const id of exclude) {
      expect(again).not.toContain(id)
    }
  })

  it('候选不足 → 抛 VALIDATION', () => {
    seedRatings([800, 900, 1000])
    expect(() => generateProblemSelection(repo, { count: 5, ratingMin: 800, ratingMax: 2000 })).toThrow(
      AppError
    )
  })

  it('无 rating 的题目不会被选中', () => {
    const inputs: ProblemUpsertInput[] = [
      { contestId: 1, index: 'A', name: 'x', rating: null, solvedCount: 0, tags: [] },
      { contestId: 2, index: 'A', name: 'y', rating: 1500, solvedCount: 0, tags: [] }
    ]
    repo.upsertMany(inputs, '2026-01-01 00:00:00')
    const picked = generateProblemSelection(repo, { count: 1, ratingMin: 800, ratingMax: 2000 })
    expect(picked).toEqual(['2:A'])
  })
})
