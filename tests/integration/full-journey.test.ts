import { describe, it, expect, beforeEach } from 'vitest'
import { initDb, closeDb } from '../../src/main/db/index'
import { createRepos, type Repos } from '../../src/main/services/index'
import { mapToUpsert } from '../../src/main/services/cf'
import { finishContest } from '../../src/main/services/contest'
import { computeRatingBreakdown, recalcRating } from '../../src/main/services/rating'
import type { Database } from 'better-sqlite3'
import { fixture, type CfProblemsetFixture } from './fixtures/cf-fixture'

// A12 冒烟：完整用户旅程（数据层 + 核心服务，不依赖 Electron 与网络）
// CF 数据以 fixture 模拟（结构对齐 Codeforces API）

let db: Database.Database
let repos: Repos

beforeEach(() => {
  closeDb()
  db = initDb(':memory:')
  repos = createRepos()
})

describe('全流程冒烟（A12）', () => {
  it('同步 → 筛选 → 练习 → 错题 → 笔记 → 模板 → 比赛 → 水平评估', async () => {
    // 1) 模拟 CF 同步（本地 fixture，不联网）
    const inputs = mapToUpsert(fixture.result)
    const { added, updated } = repos.problems.upsertMany(inputs, '2026-01-01 00:00:00')
    expect(added).toBeGreaterThan(0)
    expect(updated).toBe(0)
    expect(repos.problems.allTags().length).toBeGreaterThan(0)
    expect(repos.problems.lastSync().cf).not.toBeNull()

    // 2) 组合筛选
    const filtered = repos.problems.list({
      page: 1,
      pageSize: 10,
      ratingMin: 1400,
      ratingMax: 1800,
      tags: ['dp'],
      sortBy: 'rating',
      sortDir: 'desc'
    })
    expect(filtered.items.every((p) => (p.rating ?? 0) >= 1400 && (p.rating ?? 0) <= 1800)).toBe(true)
    expect(filtered.items.every((p) => p.tags.includes('dp'))).toBe(true)

    // 3) 练习记录（含错题标记）
    const p1 = filtered.items[0].id
    repos.records.create({ problemId: p1, status: 'WA', durationSeconds: 900, isMistake: true })
    repos.records.create({ problemId: p1, status: 'AC', durationSeconds: 1200 })
    const mistakeList = repos.records.list({ mistakeOnly: true })
    expect(mistakeList.total).toBe(1)
    expect(repos.problems.getById(p1)?.practiced).toBe(true)

    // 4) 笔记关联题目
    const note = repos.notes.create({ title: `${p1} 题解`, content: '# 思路', problemId: p1, tags: ['dp'] })
    expect(repos.notes.list({ problemId: p1 }).length).toBe(1)
    expect(repos.notes.list({ keyword: '思路' }).length).toBe(1)

    // 5) 模板
    const tpl = repos.templates.create({ category: '图论', title: 'Dijkstra', code: 'void dijkstra(){}' })
    expect(repos.templates.categories()).toContain('图论')

    // 6) 虚拟比赛（生成 → 创建 → 开始 → 提交 → 结束）
    const ids = filtered.items.slice(0, 3).map((p) => p.id)
    const contest = repos.contests.createContest({ name: '冒烟赛', durationMinutes: 60, problemIds: ids })
    const running = repos.contests.start(contest.id)
    expect(running.status).toBe('running')
    repos.contests.submit(contest.id, ids[0], 'AC')
    repos.contests.submit(contest.id, ids[1], 'WA')
    repos.contests.submit(contest.id, ids[1], 'AC')
    const result = finishContest(repos, contest.id)
    expect(result.solvedCount).toBe(2)
    expect(result.totalPenaltySeconds).toBeGreaterThan(0)
    const item = repos.contests.list().find((c) => c.id === contest.id)
    expect(item?.solvedCount).toBe(2)

    // 7) 水平评估（练习 + 比赛数据）
    const breakdown = computeRatingBreakdown(repos)
    expect(breakdown.finalRating).not.toBeNull()
    expect(breakdown.practiceRating).not.toBeNull()
    expect(breakdown.contestRating).not.toBeNull()
    expect(breakdown.title).not.toBeNull()

    const recalc = recalcRating(repos, 'manual')
    expect(recalc.history.length).toBe(1)
    expect(recalc.history[0].rating).toBe(breakdown.finalRating)

    // 8) 统计聚合
    const stats = repos.records.stats(30)
    expect(stats.totalAttempts).toBe(2)
    expect(stats.acCount).toBe(1)
    expect(stats.accuracy).toBe(50)
  })

  it('mapToUpsert：过滤 QUESTION、合并 solvedCount、保留无 rating 题', async () => {
    const inputs = mapToUpsert(fixture.result)
    // 8 道题中 1 道 QUESTION 被过滤 → 7 道入库
    expect(inputs.length).toBe(7)
    expect(inputs.find((i) => i.index === 'A' && i.contestId === 2000)).toBeUndefined()
    const a1741 = inputs.find((i) => i.contestId === 1741 && i.index === 'A')
    expect(a1741?.solvedCount).toBe(100000)
    const noRating = inputs.find((i) => i.contestId === 3000)
    expect(noRating?.rating).toBeNull()
    expect(noRating?.tags).toEqual(['math'])

    repos.problems.upsertMany(inputs, '2026-01-01 00:00:00')
    expect(repos.problems.count()).toBe(7)
    // 重复同步 → 全部 updated
    const { added, updated } = repos.problems.upsertMany(inputs, '2026-01-02 00:00:00')
    expect(added).toBe(0)
    expect(updated).toBe(7)
    expect(repos.problems.count()).toBe(7)
  })
})
