import { describe, it, expect, beforeEach } from 'vitest'
import { initDb, closeDb } from '../../src/main/db/index'
import { ProblemsRepo } from '../../src/main/db/repositories/problems'
import { RecordsRepo } from '../../src/main/db/repositories/records'
import { ContestsRepo } from '../../src/main/db/repositories/contests'
import { RatingRepo } from '../../src/main/db/repositories/rating'
import { SettingsRepo } from '../../src/main/db/repositories/settings'
import {
  computeLeetcodePracticeRating,
  computeRatingBreakdown,
  parseLeetcodeDiffMap,
  recalcRating
} from '../../src/main/services/rating'
import type { Database } from 'better-sqlite3'
import type { ProblemUpsertInput } from '@shared/types'

interface TestRepos {
  problems: ProblemsRepo
  records: RecordsRepo
  contests: ContestsRepo
  rating: RatingRepo
  settings: SettingsRepo
}

let db: Database.Database
let repos: TestRepos

beforeEach(() => {
  closeDb()
  db = initDb(':memory:')
  repos = {
    problems: new ProblemsRepo(db),
    records: new RecordsRepo(db),
    contests: new ContestsRepo(db),
    rating: new RatingRepo(db),
    settings: new SettingsRepo(db)
  }
})

function seed(ratings: number[]): void {
  const inputs: ProblemUpsertInput[] = ratings.map((rating, i) => ({
    contestId: 100 + i,
    index: 'A',
    name: `P${i}`,
    rating,
    solvedCount: 1,
    tags: []
  }))
  repos.problems.upsertMany(inputs, '2026-01-01 00:00:00')
}

describe('computeRatingBreakdown（水平评估端到端，04 §2.1）', () => {
  it('无任何数据 → 全部 null', () => {
    const b = computeRatingBreakdown(repos as never)
    expect(b.finalRating).toBeNull()
    expect(b.practiceRating).toBeNull()
    expect(b.contestRating).toBeNull()
  })

  it('纯练习：2AC+1WA（均值1500）→ 练习分1400，final=1400，称号=省赛候选', () => {
    seed([1400, 1500, 1600])
    repos.records.create({ problemId: '100:A', status: 'AC' })
    repos.records.create({ problemId: '101:A', status: 'AC' })
    repos.records.create({ problemId: '102:A', status: 'WA' })

    const b = computeRatingBreakdown(repos as never)
    expect(b.practiceRating).toBe(1400) // 1500 - (1-2/3)*300
    expect(b.contestRating).toBeNull()
    expect(b.finalRating).toBe(1400)
    expect(b.accuracy).toBeCloseTo(66.7, 0)
    expect(b.title).toContain('省赛候选')
  })

  it('练习+比赛：practice=1400, contest=1500 → final=1430', () => {
    seed([1400, 1500, 1600])
    repos.records.create({ problemId: '100:A', status: 'AC' })
    repos.records.create({ problemId: '101:A', status: 'AC' })
    repos.records.create({ problemId: '102:A', status: 'WA' })

    // 虚拟比赛：1400、1600 两题全 AC，几乎无罚时
    const c = repos.contests.createContest({
      name: '模拟赛',
      durationMinutes: 60,
      problemIds: ['100:A', '102:A']
    })
    repos.contests.start(c.id)
    repos.contests.submit(c.id, '100:A', 'AC')
    repos.contests.submit(c.id, '102:A', 'AC')
    repos.contests.finish(c.id)

    const b = computeRatingBreakdown(repos as never)
    expect(b.practiceRating).toBe(1400)
    expect(b.contestRating).toBe(1500) // (1400+1600)/2 - ~0 罚时
    expect(b.finalRating).toBe(1430) // 0.7*1400 + 0.3*1500
  })

  it('recalcRating 写入历史', () => {
    seed([1400, 1500])
    repos.records.create({ problemId: '100:A', status: 'AC' })
    repos.records.create({ problemId: '101:A', status: 'AC' })
    const r = recalcRating(repos as never, 'manual')
    expect(r.history.length).toBe(1)
    expect(r.history[0].rating).toBe(1450)
    expect(r.history[0].source).toBe('manual')
  })

  // v1.8.4 回归：history 的 createdAt 必须来自 DB 的 created_at 列。
  // 此前用 SELECT * 后取 row.createdAt（snake_case 未取别名）→ undefined，
  // 水平评估页趋势图 h.createdAt.slice() 抛错，整页空白（首页历史列表同理）。
  it('历史快照 createdAt 有值（趋势图依赖，非 undefined）', () => {
    seed([1400, 1500])
    repos.records.create({ problemId: '100:A', status: 'AC' })
    repos.records.create({ problemId: '101:A', status: 'AC' })

    const inserted = repos.rating.insert(1450, 'manual')
    expect(typeof inserted.createdAt).toBe('string')
    expect(inserted.createdAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)

    const r = recalcRating(repos as never, 'manual')
    expect(r.history.length).toBe(2)
    for (const h of r.history) {
      expect(typeof h.createdAt, 'createdAt 必须是可 slice 的字符串').toBe('string')
      expect(Number.isNaN(Date.parse(h.createdAt.replace(' ', 'T')))).toBe(false)
    }
    // 升序（趋势图按时间从左到右）
    const times = r.history.map((h) => h.createdAt)
    expect([...times].sort()).toEqual(times)
  })

  it('洛谷记录独立计入 luogu 板块，不影响 CF 综合（v1.3 FR-6.6）', () => {
    seed([1400, 1500]) // CF 题 100:A 101:A
    repos.records.create({ problemId: '100:A', status: 'AC' })
    repos.records.create({ problemId: '101:A', status: 'AC' })

    // 洛谷题（难度 2 与 4），其中一道以 UID 导入方式写入（import_source 标记）
    repos.problems.upsertMany(
      [
        { contestId: 0, index: 'P1000', name: 'LG-A', rating: null, difficulty: 2, solvedCount: 1, source: 'luogu', tags: [] },
        { contestId: 0, index: 'P1002', name: 'LG-B', rating: null, difficulty: 4, solvedCount: 1, source: 'luogu', tags: [] }
      ],
      '2026-01-01 00:00:00'
    )
    repos.records.create({ problemId: 'P1000', status: 'AC', note: '洛谷导入', importSource: 'luogu-import' })
    repos.records.create({ problemId: 'P1002', status: 'WA', note: '手动' })

    const b = computeRatingBreakdown(repos as never)
    // CF 综合不受洛谷记录影响（1400/1500 全 AC → 练习分 1450）
    expect(b.practiceRating).toBe(1450)
    expect(b.finalRating).toBe(1450)
    // 洛谷板块独立：难度 2(→1100) AC + 难度 4(→1500) WA → avg=1300, acc=0.5 → 1300-150=1150
    expect(b.luogu.rating).toBe(1150)
    expect(b.luogu.attemptCount).toBe(2)
    expect(b.luogu.acCount).toBe(1)
    expect(b.luogu.accuracy).toBe(50)
    expect(b.luogu.difficultyDist).toEqual([
      { difficulty: 2, total: 1, ac: 1 },
      { difficulty: 4, total: 1, ac: 0 }
    ])
  })

  it('无任何数据 → luogu 板块为空值', () => {
    const b = computeRatingBreakdown(repos as never)
    expect(b.luogu.rating).toBeNull()
    expect(b.luogu.attemptCount).toBe(0)
    expect(b.luogu.difficultyDist).toEqual([])
  })

  it('自定义权值生效（v1.4）：0.5/0.5 → 平均', () => {
    seed([1400, 1600]) // 全 AC → practice = 1500
    repos.records.create({ problemId: '100:A', status: 'AC' })
    repos.records.create({ problemId: '101:A', status: 'AC' })
    repos.settings.set('ratingWeights', JSON.stringify({ practice: 0.5, contest: 0.5 }))
    const b = computeRatingBreakdown(repos as never)
    expect(b.practiceRating).toBe(1500)
    expect(b.finalRating).toBe(1500) // 无比赛数据时仅用练习分（语义不变）
  })

  it('自定义权值与比赛分合成（v1.4）：0.5/0.5 → (1450+1450)/2=1450', () => {
    seed([1400, 1500])
    repos.records.create({ problemId: '100:A', status: 'AC' })
    repos.records.create({ problemId: '101:A', status: 'AC' })
    const c = repos.contests.createContest({ name: '赛', durationMinutes: 60, problemIds: ['100:A', '101:A'] })
    repos.contests.start(c.id)
    repos.contests.submit(c.id, '100:A', 'AC')
    repos.contests.submit(c.id, '101:A', 'AC')
    repos.contests.finish(c.id)

    repos.settings.set('ratingWeights', JSON.stringify({ practice: 0.5, contest: 0.5 }))
    const b = computeRatingBreakdown(repos as never)
    expect(b.practiceRating).toBe(1450) // 1400/1500 全 AC 均值
    expect(b.contestRating).toBe(1450) // 1400/1500 全 AC 均值 − ~0 罚时
    expect(b.finalRating).toBe(1450) // 0.5×1450 + 0.5×1450
  })

  it('自定义洛谷难度映射生效（v1.4）', () => {
    repos.problems.upsertMany(
      [
        { contestId: 0, index: 'P1000', name: 'A', rating: null, difficulty: 2, solvedCount: 1, source: 'luogu', tags: [] },
        { contestId: 0, index: 'P1002', name: 'B', rating: null, difficulty: 4, solvedCount: 1, source: 'luogu', tags: [] }
      ],
      '2026-01-01 00:00:00'
    )
    repos.records.create({ problemId: 'P1000', status: 'AC' })
    repos.records.create({ problemId: 'P1002', status: 'AC' })
    // 自定义：难度2→1000、难度4→1400（全 AC → avg 1200）
    repos.settings.set('luoguDiffRatings', JSON.stringify({ 2: 1000, 4: 1400 }))
    const b = computeRatingBreakdown(repos as never)
    expect(b.luogu.rating).toBe(1200)
  })

  it('非法设置回退默认（v1.4）', () => {
    seed([1400, 1500])
    repos.records.create({ problemId: '100:A', status: 'AC' })
    repos.records.create({ problemId: '101:A', status: 'AC' })
    repos.settings.set('ratingWeights', 'not-json')
    repos.settings.set('luoguDiffRatings', '{"2":-1}')
    const b = computeRatingBreakdown(repos as never)
    expect(b.finalRating).toBe(1450) // 默认 0.7/0.3（无比赛仅练习分）
  })

  // ============ v1.9 FR-23：力扣练习水平（独立板块） ============

  it('力扣记录独立计入 leetcode 板块，不影响 CF 综合', () => {
    seed([1400, 1500]) // CF 100:A 101:A
    repos.records.create({ problemId: '100:A', status: 'AC' })
    repos.records.create({ problemId: '101:A', status: 'AC' })
    repos.problems.upsertMany(
      [
        { contestId: 0, index: 'two-sum', name: '两数之和', rating: null, difficulty: 1, solvedCount: 1, source: 'leetcode', frontendId: '1', tags: [] },
        { contestId: 0, index: 'lru-cache', name: 'LRU 缓存', rating: null, difficulty: 2, solvedCount: 1, source: 'leetcode', frontendId: '146', tags: [] }
      ],
      '2026-01-01 00:00:00'
    )
    repos.records.create({ problemId: 'LC1', status: 'AC' })
    repos.records.create({ problemId: 'LC146', status: 'WA' })

    const b = computeRatingBreakdown(repos as never)
    expect(b.practiceRating).toBe(1450) // 仅 CF 记录参与
    expect(b.finalRating).toBe(1450)
    // 力扣：简单(→1000) AC + 中等(→1500) WA → avg=1250, acc=0.5 → 1250-150=1100
    expect(b.leetcode.rating).toBe(1100)
    expect(b.leetcode.attemptCount).toBe(2)
    expect(b.leetcode.acCount).toBe(1)
    expect(b.leetcode.accuracy).toBe(50)
    expect(b.leetcode.difficultyDist).toEqual([
      { difficulty: 1, total: 1, ac: 1 },
      { difficulty: 2, total: 1, ac: 0 }
    ])
  })

  it('无数据时 leetcode 板块为空值', () => {
    const b = computeRatingBreakdown(repos as never)
    expect(b.leetcode.rating).toBeNull()
    expect(b.leetcode.attemptCount).toBe(0)
    expect(b.leetcode.accuracy).toBeNull()
    expect(b.leetcode.difficultyDist).toEqual([])
  })

  it('自定义力扣难度映射生效；非法值回退默认', () => {
    repos.problems.upsertMany(
      [
        { contestId: 0, index: 'two-sum', name: 'A', rating: null, difficulty: 1, solvedCount: 1, source: 'leetcode', frontendId: '1', tags: [] },
        { contestId: 0, index: 'hard-x', name: 'B', rating: null, difficulty: 3, solvedCount: 1, source: 'leetcode', frontendId: '2', tags: [] }
      ],
      '2026-01-01 00:00:00'
    )
    repos.records.create({ problemId: 'LC1', status: 'AC' })
    repos.records.create({ problemId: 'LC2', status: 'AC' })
    // 自定义：简单→1200、困难→2400（全 AC → avg 1800）
    repos.settings.set('leetcodeDiffRatings', JSON.stringify({ 1: 1200, 3: 2400 }))
    expect(computeRatingBreakdown(repos as never).leetcode.rating).toBe(1800)

    // 非法映射（越界/非数字）→ 回退默认 1000/2000 → avg 1500
    repos.settings.set('leetcodeDiffRatings', JSON.stringify({ 1: 100, 3: 'x' }))
    expect(computeRatingBreakdown(repos as never).leetcode.rating).toBe(1500)
  })

  it('parseLeetcodeDiffMap：键限 1-3、值限 800-3500，非法项丢弃', () => {
    expect(parseLeetcodeDiffMap('{"1":1000,"2":1500,"3":2000}')).toEqual({ 1: 1000, 2: 1500, 3: 2000 })
    expect(parseLeetcodeDiffMap('{"1":1000,"4":1500}')).toEqual({ 1: 1000 })
    expect(parseLeetcodeDiffMap('{"1":100}')).toBeNull()
    expect(parseLeetcodeDiffMap('bad')).toBeNull()
    expect(parseLeetcodeDiffMap(null)).toBeNull()
  })

  it('computeLeetcodePracticeRating：难度折算 + 正确率惩罚（纯函数）', () => {
    expect(computeLeetcodePracticeRating([])).toBeNull()
    // 全 AC：简单(1000) + 中等(1500) → 1250
    expect(
      computeLeetcodePracticeRating([
        { difficulty: 1, isAc: true },
        { difficulty: 2, isAc: true }
      ])
    ).toBe(1250)
    // 一半正确率：avg 1250 − 150 = 1100
    expect(
      computeLeetcodePracticeRating([
        { difficulty: 1, isAc: true },
        { difficulty: 2, isAc: false }
      ])
    ).toBe(1100)
  })
})
