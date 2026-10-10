import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDb, closeDb } from '../../src/main/db/index'
import { ProblemsRepo } from '../../src/main/db/repositories/problems'
import { ListsRepo } from '../../src/main/db/repositories/lists'
import { parseCandidatesFromText, resolveCandidates, pickProblemsForList } from '../../src/main/services/problem-list'
import { localDate, addDays } from '../../src/main/services/review'
import { AppError } from '../../src/main/db/errors'
import type { ProblemUpsertInput } from '@shared/types'

/**
 * 题单（v1.10 FR-27）+ 题单内间隔复习（FR-29）集成测试：
 * 建单/加题/勾选完成（自动进入复习）/反馈推进/今日到期/备注/移除/级联删除 + 三种题目来源。
 */

let db: ReturnType<typeof initDb>
let problems: ProblemsRepo
let lists: ListsRepo

const TODAY = localDate()

function seed(): void {
  const inputs: ProblemUpsertInput[] = [
    { contestId: 1741, index: 'A', name: 'CF 1741A', rating: 800, solvedCount: 0, tags: ['greedy', '贪心'] },
    { contestId: 1741, index: 'B', name: 'CF 1741B', rating: 1200, solvedCount: 0, tags: ['dp', '动态规划'] },
    { contestId: 1741, index: 'C', name: 'CF 1741C', rating: 1900, solvedCount: 0, tags: ['dp', 'graphs'] },
    { contestId: 0, index: 'P3374', name: '树状数组 1', rating: null, difficulty: 4, solvedCount: 0, source: 'luogu', tags: ['树状数组'] },
    { contestId: 0, index: 'two-sum', name: '两数之和', rating: null, difficulty: 1, solvedCount: 0, source: 'leetcode', frontendId: '1', tags: ['数组', '哈希表'] },
    { contestId: 0, index: 'lru-cache', name: 'LRU 缓存', rating: null, difficulty: 2, solvedCount: 0, source: 'leetcode', frontendId: '146', tags: ['设计', '哈希表'] }
  ]
  problems.upsertMany(inputs, '2026-10-04 10:00:00')
}

beforeEach(() => {
  closeDb()
  db = initDb(':memory:')
  problems = new ProblemsRepo(db)
  lists = new ListsRepo(db)
  seed()
})
afterEach(() => closeDb())

describe('ListsRepo：题单 CRUD 与进度', () => {
  it('创建 / 列表 / 详情（含题目信息）/ 重命名 / 删除', () => {
    const list = lists.create({ name: '蓝桥杯冲刺', description: '省赛' })
    expect(list.total).toBe(0)
    const added = lists.addProblems(list.id, ['1741:A', '1741:B', 'P3374', '不存在的题的'])
    expect(added).toBe(3) // 无效 id 被跳过
    const detail = lists.detail(list.id, problems)
    expect(detail.items).toHaveLength(3)
    expect(detail.items[0].problem?.name).toBe('CF 1741A')
    expect(detail.items[2].problem?.name).toBe('树状数组 1')
    // 重复加入不重复插入
    expect(lists.addProblems(list.id, ['1741:A'])).toBe(0)
    expect(lists.detail(list.id, problems).list.total).toBe(3)

    const renamed = lists.update(list.id, { name: '蓝桥杯冲刺 v2' })
    expect(renamed.name).toBe('蓝桥杯冲刺 v2')

    lists.delete(list.id)
    expect(() => lists.detail(list.id, problems)).toThrow(AppError)
  })

  it('空名称拒绝创建', () => {
    expect(() => lists.create({ name: '   ' })).toThrow(/名称不能为空/)
  })
})

describe('题单内间隔复习（FR-29）', () => {
  it('勾选完成 → 自动进入第 1 档并排到 1 天后', () => {
    const list = lists.create({ name: 'L' })
    lists.addProblems(list.id, ['1741:A'])
    const item = lists.setDone(list.id, '1741:A', true)
    expect(item.done).toBe(true)
    expect(item.reviewStage).toBe(1)
    expect(item.reviewDue).toBe(addDays(TODAY, 1))
    expect(item.reviewLastAt).toBe(TODAY)
  })

  it('反馈推进：一般 → 第 2 档（3 天后）；轻松 → 跳档；困难 → 退档', () => {
    const list = lists.create({ name: 'L' })
    lists.addProblems(list.id, ['1741:A', '1741:B', '1741:C'])
    lists.setDone(list.id, '1741:A', true)
    lists.setDone(list.id, '1741:B', true)
    lists.setDone(list.id, '1741:C', true)

    const a = lists.applyReview(list.id, '1741:A', 2, addDays(TODAY, 3), 'ok')
    expect(a.reviewStage).toBe(2)
    expect(a.reviewEase).toBe('ok')

    const b = lists.applyReview(list.id, '1741:B', 3, addDays(TODAY, 7), 'easy')
    expect(b.reviewStage).toBe(3)
    expect(b.reviewEase).toBe('easy')

    // 困难：退一档（3 → 2）
    const c = lists.applyReview(list.id, '1741:C', 2, addDays(TODAY, 3), 'hard')
    expect(c.reviewStage).toBe(2)
    expect(c.reviewEase).toBe('hard')
  })

  it('今日到期（含逾期）汇总，跨题单并带题单名', () => {
    const l1 = lists.create({ name: '题单甲' })
    const l2 = lists.create({ name: '题单乙' })
    lists.addProblems(l1.id, ['1741:A', '1741:B'])
    lists.addProblems(l2.id, ['P3374'])
    // 完成 → 都排到明天（未到期）
    lists.setDone(l1.id, '1741:A', true)
    lists.setDone(l1.id, '1741:B', true)
    lists.setDone(l2.id, 'P3374', true)
    expect(lists.dueReviews(problems, TODAY)).toHaveLength(0)

    // 手动把 A 设为今天到期、B 设为昨天（逾期）
    lists.applyReview(l1.id, '1741:A', 1, TODAY, 'ok')
    lists.applyReview(l1.id, '1741:B', 2, addDays(TODAY, -2), 'ok')
    const due = lists.dueReviews(problems, TODAY)
    expect(due).toHaveLength(2)
    expect(due.map((d) => d.problemId).sort()).toEqual(['1741:A', '1741:B'])
    expect(due.every((d) => d.listName === '题单甲')).toBe(true)
    expect(due[0].problem?.name).toBeTruthy()

    // 题单聚合 dueCount
    expect(lists.getById(l1.id)?.dueCount).toBe(2)
    expect(lists.getById(l2.id)?.dueCount).toBe(0)
  })

  it('已进入复习的条目：再次勾选不清空复习排期；取消勾选只清完成状态', () => {
    const list = lists.create({ name: 'L' })
    lists.addProblems(list.id, ['1741:A'])
    lists.setDone(list.id, '1741:A', true)
    lists.applyReview(list.id, '1741:A', 3, addDays(TODAY, 7), 'ok')

    const again = lists.setDone(list.id, '1741:A', true)
    expect(again.reviewStage).toBe(3)
    expect(again.reviewDue).toBe(addDays(TODAY, 7))

    const un = lists.setDone(list.id, '1741:A', false)
    expect(un.done).toBe(false)
    expect(un.reviewStage).toBe(3) // 复习记录保留（做题成果不因取消勾选而丢）
  })

  it('备注可修改；移除条目后题单进度回退', () => {
    const list = lists.create({ name: 'L' })
    lists.addProblems(list.id, ['1741:A', '1741:B'])
    lists.setNote(list.id, '1741:A', '注意溢出')
    expect(lists.getItem(list.id, '1741:A')?.note).toBe('注意溢出')
    lists.setDone(list.id, '1741:A', true)
    expect(lists.getById(list.id)).toMatchObject({ total: 2, doneCount: 1, reviewCount: 1 })
    lists.removeItem(list.id, '1741:A')
    expect(lists.getById(list.id)).toMatchObject({ total: 1, doneCount: 0, reviewCount: 0 })
    expect(() => lists.removeItem(list.id, '1741:A')).toThrow(AppError)
  })

  it('删除题单级联删除条目', () => {
    const list = lists.create({ name: 'L' })
    lists.addProblems(list.id, ['1741:A', '1741:B'])
    lists.delete(list.id)
    const n = (
      db.prepare('SELECT COUNT(*) AS c FROM problem_list_items WHERE list_id = ?').get(list.id) as {
        c: number
      }
    ).c
    expect(n).toBe(0)
  })
})

describe('题单来源 ①：粘贴题号文本识别（FR-27）', () => {
  it('识别 CF / 洛谷 / 力扣题号与链接，并去重', () => {
    const text = `
      错题：1741A、CF 1741 B；洛谷 P3374 与 https://www.luogu.com.cn/problem/P3374
      力扣 LC1 / lru-cache：https://leetcode.cn/problems/lru-cache/
      无关文字 2026 年 10 月 4 日
    `
    const cands = parseCandidatesFromText(text)
    const { matchedIds, missing } = resolveCandidates(problems, cands)
    expect(matchedIds.sort()).toEqual(['1741:A', '1741:B', 'LC1', 'LC146', 'P3374'])
    expect(missing).toEqual([])
  })

  it('未命中的题号进入 missing（最多回显 50 条）', () => {
    const { matchedIds, missing } = resolveCandidates(problems, parseCandidatesFromText('CF 9999Z P99999'))
    expect(matchedIds).toEqual([])
    expect(missing.join(',')).toContain('9999:Z')
    expect(missing.join(',')).toContain('P99999')
  })

  it('不会把洛谷 P 题号里的数字误判成 CF 题号', () => {
    const cands = parseCandidatesFromText('P3374')
    expect(cands).toEqual([{ source: 'luogu', id: 'P3374' }])
  })
})

describe('题单来源 ②：按知识点 + 难度生成（FR-27）', () => {
  it('按知识点标签并集抽题，题量受限且不重复', () => {
    const { ids, candidates } = pickProblemsForList(problems, {
      knowledgeTags: ['dp', '动态规划'],
      count: 2
    })
    expect(candidates).toBeGreaterThanOrEqual(2)
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
    expect(ids.every((id) => ['1741:B', '1741:C'].includes(id))).toBe(true)
  })

  it('难度分层轮转：跨难度桶轮流取，避免全挤在一个难度', () => {
    const { ids } = pickProblemsForList(problems, {
      knowledgeTags: ['dp', '动态规划', 'graphs'],
      count: 3
    })
    // 候选覆盖 1200 与 1900 两个桶，轮转后两桶都有
    expect(ids).toContain('1741:B')
    expect(ids).toContain('1741:C')
  })

  it('排除已练 / 难度区间 / 数据源过滤', () => {
    problems.upsertMany(
      [
        { contestId: 1741, index: 'A', name: 'CF 1741A', rating: 800, solvedCount: 0, tags: ['greedy', '贪心'] }
      ],
      '2026-10-04 10:00:00'
    )
    const rec = db
      .prepare(
        `INSERT INTO practice_records (problem_id, status, created_at) VALUES ('1741:B', 'AC', '2026-10-04 10:00:00')`
      )
      .run()
    void rec

    const excluded = pickProblemsForList(problems, {
      knowledgeTags: ['dp'],
      count: 5,
      excludePracticed: true
    })
    expect(excluded.ids).toEqual(['1741:C'])

    const lcOnly = pickProblemsForList(problems, {
      knowledgeTags: ['数组', '哈希表', '设计'],
      count: 5,
      source: 'leetcode',
      difficultyMin: 2,
      difficultyMax: 2
    })
    expect(lcOnly.ids).toEqual(['LC146'])
  })

  it('无候选时返回空（调用方负责报错提示）', () => {
    const r = pickProblemsForList(problems, { knowledgeTags: ['不存在的标签'], count: 5 })
    expect(r).toEqual({ ids: [], candidates: 0 })
  })
})
