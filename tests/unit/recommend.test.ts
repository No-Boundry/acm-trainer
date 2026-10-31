import { describe, it, expect } from 'vitest'
import {
  aggregatePractice,
  buildRecommendation,
  diversify,
  dueReviewSet,
  forgettingUrgency,
  knowledgeFilterTags,
  memoryStrength,
  nodeTagOptions,
  passesFilters,
  practiceState,
  resolveFilterTags,
  sortFresh,
  sortPracticed,
  type BuildRecommendDeps,
  type ProblemPractice
} from '../../src/main/services/recommend'
import type { ProblemRow, RecommendedProblem, SkillNodeReport, TagUsage } from '@shared/types'
import { mergeRecommendSettings } from '../../src/main/services/recommend-service'

/**
 * 首页推荐习题（v1.14 FR-31~FR-33）纯函数单测。
 *
 * 覆盖：遗忘曲线强度/紧急度、已练习排序 5 种方式、未练习排序 6 种方式、
 * 「练习中」知识点优先 + AC 数升序、知识点/标签筛选并集、到期复习置顶。
 */

const NOW = new Date('2026-03-10T12:00:00')

function problem(partial: Partial<ProblemRow> & { id: string }): ProblemRow {
  return {
    id: partial.id,
    contestId: partial.contestId === undefined ? 1 : partial.contestId,
    index: 'A',
    name: partial.name ?? `题 ${partial.id}`,
    rating: partial.rating === undefined ? 1500 : partial.rating,
    difficulty: null,
    solvedCount: partial.solvedCount ?? 100,
    totalSubmit: 200,
    source: partial.source ?? 'cf',
    url: '',
    tags: partial.tags ?? [],
    practiced: false,
    lastStatus: null
  }
}

function ago(days: number, hour = 12): string {
  const d = new Date(NOW.getTime() - days * 86400000)
  d.setHours(hour, 0, 0, 0)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:00`
}

function practice(partial: Partial<ProblemPractice> & { problemId: string }): ProblemPractice {
  const acCount = partial.acCount ?? 1
  const attempts = partial.attempts ?? acCount
  return {
    problemId: partial.problemId,
    attempts,
    acCount,
    acc: partial.acc ?? acCount / attempts,
    lastAt: partial.lastAt ?? ago(partial.daysSince ?? 1),
    lastStatus: partial.lastStatus ?? (acCount > 0 ? 'AC' : 'WA'),
    daysSince: partial.daysSince ?? 1
  }
}

function node(partial: Partial<SkillNodeReport> & { id: string; name: string }): SkillNodeReport {
  return {
    layer: 1,
    tags: [],
    dependsOn: [],
    intro: '节点简介（测试用），长度足够渲染。',
    stats: {
      attempted: 0,
      acProblems: 0,
      attempts: 0,
      acAttempts: 0,
      acc: 0,
      hardSolved: 0,
      lastActiveDays: null
    },
    tier: 'untouched',
    depsReady: true,
    ...partial
  }
}

describe('遗忘曲线：聚合与强度', () => {
  it('aggregatePractice 按题聚合尝试次数/AC 次数/正确率/距今天数', () => {
    const m = aggregatePractice(
      [
        { problemId: 'C1', status: 'WA', createdAt: ago(5) },
        { problemId: 'C1', status: 'AC', createdAt: ago(3) },
        { problemId: 'C1', status: 'AC', createdAt: ago(1) }
      ],
      NOW
    )
    const p = m.get('C1')!
    expect(p.attempts).toBe(3)
    expect(p.acCount).toBe(2)
    expect(p.acc).toBeCloseTo(2 / 3, 5)
    expect(p.daysSince).toBe(1)
    expect(p.lastStatus).toBe('AC')
  })

  it('昨天刚 AC 的题强度高；很久没碰的题强度低', () => {
    const fresh = memoryStrength(practice({ problemId: 'A', acCount: 1, daysSince: 1 }))
    const old = memoryStrength(practice({ problemId: 'B', acCount: 1, daysSince: 30 }))
    expect(fresh).toBeGreaterThan(old)
    expect(old).toBeLessThan(0.1)
  })

  it('AC 次数越多，间隔越长，同样天数下强度更高（间隔重复的效果）', () => {
    const once = memoryStrength(practice({ problemId: 'A', acCount: 1, daysSince: 10 }))
    const four = memoryStrength(practice({ problemId: 'A', acCount: 4, daysSince: 10 }))
    expect(four).toBeGreaterThan(once)
  })

  it('未 AC 的题衰减更快（未 AC 与 1 次 AC 在同一天数下比较）', () => {
    const trying = memoryStrength(practice({ problemId: 'A', acCount: 0, attempts: 3, daysSince: 3 }))
    const done = memoryStrength(practice({ problemId: 'B', acCount: 1, daysSince: 3 }))
    expect(trying).toBeLessThan(done)
  })

  it('forgettingUrgency = 1 − 强度，且 30 天未碰会远超 0.5（触发「该复习了」）', () => {
    const old = practice({ problemId: 'A', acCount: 1, daysSince: 30 })
    expect(forgettingUrgency(old)).toBeCloseTo(1 - memoryStrength(old), 3)
    expect(forgettingUrgency(old)).toBeGreaterThanOrEqual(0.5)
    // 1 次 AC 的期望间隔只有 1 天，1 天后强度已降到 1/3 → 紧急度 0.667，
    // 因此「临界 0.5」按期望间隔判定，而不是按绝对天数。
    const fresh = practice({ problemId: 'B', acCount: 1, daysSince: 1 })
    expect(forgettingUrgency(fresh)).toBeCloseTo(0.667, 3)
    // 多次 AC 会显著压低紧急度（巩固过的题不该被立刻重推）
    const reinforced = practice({ problemId: 'C', acCount: 10, daysSince: 7 })
    expect(forgettingUrgency(reinforced)).toBeLessThan(0.5)
  })

  it('practiceState：无记录=undone，有记录无 AC=trying，有 AC=done', () => {
    expect(practiceState(undefined)).toBe('undone')
    expect(practiceState(practice({ problemId: 'A', acCount: 0, attempts: 2 }))).toBe('trying')
    expect(practiceState(practice({ problemId: 'B', acCount: 1 }))).toBe('done')
  })
})

describe('已练习部分排序（默认遗忘曲线）', () => {
  const entries = [
    { problem: problem({ id: 'C1' }), practice: practice({ problemId: 'C1', acCount: 1, daysSince: 40, acc: 1 }) },
    { problem: problem({ id: 'C2' }), practice: practice({ problemId: 'C2', acCount: 1, daysSince: 2, acc: 1 }) },
    { problem: problem({ id: 'C3' }), practice: practice({ problemId: 'C3', acCount: 0, attempts: 4, daysSince: 10, acc: 0 }) }
  ]

  it('forgetting：越接近遗忘越靠前（40 天 > 10 天未 AC > 2 天）', () => {
    const order = sortPracticed(entries, 'forgetting').map((e) => e.problem.id)
    expect(order[0]).toBe('C1')
    expect(order[1]).toBe('C3')
    expect(order[2]).toBe('C2')
  })

  it('recent：最近练过的优先', () => {
    expect(sortPracticed(entries, 'recent').map((e) => e.problem.id)).toEqual(['C2', 'C3', 'C1'])
  })

  it('stale：最久没碰的优先', () => {
    expect(sortPracticed(entries, 'stale').map((e) => e.problem.id)).toEqual(['C1', 'C3', 'C2'])
  })

  it('weak：正确率低的优先', () => {
    expect(sortPracticed(entries, 'weak')[0].problem.id).toBe('C3')
  })

  it('difficulty：难度从低到高，null 难度排最后', () => {
    const withNull = [
      ...entries,
      { problem: problem({ id: 'C4', rating: null }), practice: practice({ problemId: 'C4' }) }
    ]
    const order = sortPracticed(
      withNull.map((e) => ({ ...e, problem: { ...e.problem, rating: e.problem.id === 'C2' ? 800 : e.problem.rating } })),
      'difficulty'
    ).map((e) => e.problem.id)
    expect(order[0]).toBe('C2') // 800
    expect(order[order.length - 1]).toBe('C4') // null
  })
})

describe('未练习部分排序（默认练习中知识点优先 + AC 数升序）', () => {
  const nodes = [
    node({ id: 'greedy', name: '贪心', tags: ['greedy', '贪心'], tier: 'learning' }),
    node({ id: 'graph', name: '图论', tags: ['graph', '图论'], tier: 'untouched' })
  ]
  const candidates = [
    problem({ id: 'N1', tags: ['graph'], solvedCount: 10 }),
    problem({ id: 'N2', tags: ['greedy'], solvedCount: 900 }),
    problem({ id: 'N3', tags: ['greedy'], solvedCount: 50 }),
    problem({ id: 'N4', tags: ['greedy', 'graph'], solvedCount: 5 })
  ]
  const deps = {
    candidates,
    nodes,
    learning: { tier: 'learning', tags: ['greedy', '贪心'] },
    nodeAcc: () => 1
  }

  it('learning-node：练习中知识点的题排在前面，组内 AC 数升序', () => {
    const order = sortFresh({ ...deps, order: 'learning-node' }).map((r) => r.problem.id)
    expect(order).toEqual(['N4', 'N3', 'N2', 'N1'])
  })

  it('easier / harder：按难度升/降序', () => {
    const cands = [
      problem({ id: 'A', rating: 1800 }),
      problem({ id: 'B', rating: 1200 }),
      problem({ id: 'C', rating: 2400 })
    ]
    const base = { ...deps, candidates: cands }
    expect(sortFresh({ ...base, order: 'easier' }).map((r) => r.problem.id)).toEqual(['B', 'A', 'C'])
    expect(sortFresh({ ...base, order: 'harder' }).map((r) => r.problem.id)).toEqual(['C', 'A', 'B'])
  })

  it('popular：全球 AC 数最多的优先', () => {
    const order = sortFresh({ ...deps, order: 'popular' }).map((r) => r.problem.id)
    expect(order[0]).toBe('N2') // 900
  })

  it('weak-node：最薄弱知识点（正确率最低）的题优先', () => {
    const order = sortFresh({
      ...deps,
      order: 'weak-node',
      nodeAcc: (id) => (id === 'graph' ? 0.9 : 0.1)
    }).map((r) => r.problem.id)
    // greedy 更薄弱（0.1）→ 属于 greedy 的题在前
    expect(order.indexOf('N2')).toBeLessThan(order.indexOf('N1'))
  })

  it('random：使用注入的随机数（可复现）', () => {
    let i = 0
    const seq = [0.1, 0.9, 0.3, 0.7]
    const order = sortFresh({ ...deps, order: 'random', random: () => seq[i++ % seq.length] }).map((r) => r.problem.id)
    expect(order.length).toBe(4)
    expect(new Set(order).size).toBe(4)
  })

  it('理由文案：练习中的题与普通新题区分', () => {
    const res = sortFresh({ ...deps, order: 'learning-node' })
    const inNode = res.find((r) => r.problem.id === 'N3')!
    expect(inNode.reason.kind).toBe('learning-node')
    expect(inNode.reason.text).toContain('练习中')
    const n1 = res.find((r) => r.problem.id === 'N1')
    // N1 只属于 untouched 节点 → 仍在 learning.tags 之外（除非 tags 命中）
    expect(n1!.reason.kind).toBe('new')
  })
})

describe('筛选：知识点与手动标签', () => {
  const nodes = [
    node({ id: 'dsu', name: '并查集', tags: ['并查集', 'dsu'] }),
    node({ id: 'graph', name: '图论入门', tags: ['图', '拓扑排序'] })
  ]

  it('knowledgeFilterTags 返回节点标签并集；空选择 = 不过滤', () => {
    expect(knowledgeFilterTags(nodes, ['dsu']).sort()).toEqual(['dsu', '并查集'])
    expect(knowledgeFilterTags(nodes, [])).toEqual([])
  })

  it('resolveFilterTags 合并知识点标签与手动标签（去重）', () => {
    const tags = resolveFilterTags(nodes, ['dsu'], ['图', '并查集'])
    expect(tags.sort()).toEqual(['dsu', '图', '并查集'].sort())
  })

  it('手动只选一个标签时：filterTags 原样保留，且 passesFilters 只认该标签', () => {
    // resolveFilterTags 是「并集」语义（节点默认标签 ∪ 手动标签），
    // 「只按某个标签过滤」由 passesFilters 独立完成 —— 所以直接只传 filterTags。
    const tags = resolveFilterTags(nodes, [], ['dsu'])
    expect(tags).toEqual(['dsu'])
    const p = problem({ id: 'X', tags: ['并查集'] })
    expect(passesFilters(p, { filterTags: tags })).toBe(false)
    expect(passesFilters(p, { filterTags: resolveFilterTags(nodes, [], ['并查集']) })).toBe(true)
  })

  it('passesFilters：标签 / 难度上限 / 数据源', () => {
    const p = problem({ id: 'X', rating: 1800, tags: ['并查集'], source: 'luogu' })
    expect(passesFilters(p, { filterTags: ['并查集'] })).toBe(true)
    expect(passesFilters(p, { filterTags: ['图'] })).toBe(false)
    expect(passesFilters(p, { filterTags: [], ratingMax: 1600 })).toBe(false)
    expect(passesFilters(p, { filterTags: [], ratingMax: 2000 })).toBe(true)
    expect(passesFilters(p, { filterTags: [], source: 'cf' })).toBe(false)
    expect(passesFilters(p, { filterTags: [], source: 'all' })).toBe(true)
  })

  it('nodeTagOptions：默认标签在前，并带上题库题数', () => {
    const usage: TagUsage[] = [
      { tag: 'dsu', attempted: 2, acProblems: 1, lastAt: null, lastActiveDays: 3, totalProblems: 415, progress: 0.002 },
      { tag: '并查集', attempted: 5, acProblems: 3, lastAt: null, lastActiveDays: 1, totalProblems: 492, progress: 0.006 }
    ]
    const opts = nodeTagOptions(nodes[0], usage)
    expect(opts.map((o) => o.tag)).toEqual(['并查集', 'dsu'])
    expect(opts.every((o) => o.isDefault)).toBe(true)
    expect(opts.find((o) => o.tag === 'dsu')!.totalProblems).toBe(415)
  })
})

describe('buildRecommendation 端到端（纯函数）', () => {
  const nodes = [
    node({ id: 'greedy', name: '贪心', tags: ['greedy'], tier: 'learning' }),
    node({ id: 'graph', name: '图论', tags: ['graph'], tier: 'untouched' })
  ]

  function deps(partial: Partial<BuildRecommendDeps> = {}): BuildRecommendDeps {
    return {
      problems: [
        problem({ id: 'P_done', tags: ['greedy'], rating: 1200 }),
        problem({ id: 'P_try', tags: ['graph'], rating: 1400 }),
        problem({ id: 'P_new1', tags: ['greedy'], rating: 1300, solvedCount: 10 }),
        problem({ id: 'P_new2', tags: ['greedy'], rating: 1600, solvedCount: 500 }),
        problem({ id: 'P_new3', tags: ['graph'], rating: 1500, solvedCount: 20 })
      ],
      records: [
        { problemId: 'P_done', status: 'AC', createdAt: ago(60) },
        { problemId: 'P_try', status: 'WA', createdAt: ago(3) }
      ],
      nodes,
      now: NOW,
      ...partial
    }
  }

  it('把题目分成已练习 / 未练习两部分，且 totals 不受 limit 截断', () => {
    const r = buildRecommendation(deps(), { practicedLimit: 1, freshLimit: 1 })
    expect(r.practiced.length).toBe(1)
    expect(r.fresh.length).toBe(1)
    expect(r.totals.practiced).toBe(2)
    expect(r.totals.fresh).toBe(3)
    expect(r.practicedOrder).toBe('forgetting')
    expect(r.freshOrder).toBe('learning-node')
  })

  it('已练习部分默认按遗忘曲线：60 天没碰的排在 3 天前之前', () => {
    const r = buildRecommendation(deps(), {})
    expect(r.practiced[0].problem.id).toBe('P_done')
    expect(r.practiced[0].reason.kind).toBe('due-review')
    expect(r.practiced[0].urgency).toBeGreaterThan(r.practiced[1].urgency)
  })

  it('未练习部分默认优先练习中知识点，并按 AC 数升序', () => {
    const r = buildRecommendation(deps(), {})
    const ids = r.fresh.map((f) => f.problem.id)
    expect(ids.slice(0, 2)).toEqual(['P_new1', 'P_new2']) // greedy（练习中），AC 10 < 500
    expect(ids[2]).toBe('P_new3') // graph（非练习中）排后面
  })

  it('设置里改成「难度从低到高」时，未练习部分按 rating 升序', () => {
    const r = buildRecommendation(deps(), { freshOrder: 'easier' })
    expect(r.fresh.map((f) => f.problem.rating)).toEqual([1300, 1500, 1600])
  })

  it('已练习部分可切换为「最近练过的优先」', () => {
    const d = deps()
    // 两条记录都要有 AC，才能都算「已练习」且状态为 done
    d.records = [
      { problemId: 'P_done', status: 'AC', createdAt: ago(60) },
      { problemId: 'P_try', status: 'AC', createdAt: ago(3) }
    ]
    const r = buildRecommendation(d, { practicedOrder: 'recent' })
    expect(r.practiced.map((p) => p.problem.id).sort()).toEqual(['P_done', 'P_try'])
    // 「最近练过」优先：P_try 3 天前，P_done 60 天前
    expect(r.practiced[0].problem.id).toBe('P_try')
    expect(r.practiced.every((p) => p.state === 'done')).toBe(true)
  })

  it('只有「已练习」标记、没有提交记录的题也归入已练习部分（不会被当成新题）', () => {
    const d = deps()
    d.records = []
    d.practicedIds = ['P_new3']
    const r = buildRecommendation(d, {})
    expect(r.practiced.map((p) => p.problem.id)).toEqual(['P_new3'])
    expect(r.practiced[0].reason.text).toContain('已标记为练习过')
    expect(r.fresh.map((p) => p.problem.id)).not.toContain('P_new3')
  })

  it('到期复习（题单间隔复习）置顶，即使不满足遗忘曲线阈值', () => {
    const base = deps()
    base.records = [{ problemId: 'P_done', status: 'AC', createdAt: ago(1) }]
    base.problems = base.problems.filter((p) => p.id !== 'P_try')
    const r = buildRecommendation({ ...base, dueReviewIds: new Set(['P_done']) }, {})
    expect(r.practiced[0].dueReview).toBe(true)
    expect(r.practiced[0].reason.text).toContain('题单复习已到期')
    expect(r.practiced[0].urgency).toBe(1)
  })

  it('知识点筛选：只推荐该知识点标签下的题（已练习与未练习都过滤）', () => {
    const r = buildRecommendation(deps(), { knowledgeIds: ['graph'] })
    expect(r.filterTags.sort()).toEqual(['graph'])
    expect(r.practiced.map((p) => p.problem.id)).toEqual(['P_try'])
    expect(r.fresh.map((p) => p.problem.id)).toEqual(['P_new3'])
  })

  it('手动标签筛选：filterTags 单独生效（不传节点）', () => {
    const r = buildRecommendation(deps(), { filterTags: ['greedy'] })
    expect(r.fresh.map((p) => p.problem.id).sort()).toEqual(['P_new1', 'P_new2'])
    expect(r.practiced.map((p) => p.problem.id)).toEqual(['P_done'])
  })

  it('难度上限过滤生效', () => {
    const r = buildRecommendation(deps(), { ratingMax: 1400 })
    expect(r.fresh.every((f) => (f.problem.rating ?? 0) <= 1400)).toBe(true)
  })

  it('题单归属会带到推荐条目上（listNames）', () => {
    const r = buildRecommendation(deps({ listNamesOf: (id) => (id === 'P_new1' ? ['十月冲刺'] : []) }), {})
    expect(r.fresh.find((f) => f.problem.id === 'P_new1')!.listNames).toEqual(['十月冲刺'])
  })

  it('knowledgeIds 会解析回题目的知识点（用于展示色点）', () => {
    const r = buildRecommendation(deps(), {})
    expect(r.fresh.find((f) => f.problem.id === 'P_new3')!.knowledgeIds).toEqual(['graph'])
  })
})

describe('mergeRecommendSettings：设置项 → 请求参数（v1.14 FR-33）', () => {
  it('未显式传入时，排序方式与条数取自设置', () => {
    const r = mergeRecommendSettings({
      recommendOrderPracticed: 'weak',
      recommendOrderFresh: 'harder',
      recommendPracticedLimit: '12',
      recommendFreshLimit: '5'
    })
    expect(r.practicedOrder).toBe('weak')
    expect(r.freshOrder).toBe('harder')
    expect(r.practicedLimit).toBe(12)
    expect(r.freshLimit).toBe(5)
  })

  it('请求里显式给出的字段优先于设置', () => {
    const r = mergeRecommendSettings(
      { recommendOrderFresh: 'harder', recommendFreshLimit: '5' },
      { freshOrder: 'easier', freshLimit: 3 }
    )
    expect(r.freshOrder).toBe('easier')
    expect(r.freshLimit).toBe(3)
  })

  it('非法排序值被丢弃（回落到默认），不产生不存在的口径', () => {
    const r = mergeRecommendSettings({ recommendOrderPracticed: '不存在的值', recommendOrderFresh: 'bogus' })
    expect(r.practicedOrder).toBeUndefined()
    expect(r.freshOrder).toBeUndefined()
  })

  it('条数被钳制到 1–30，非法值回落', () => {
    expect(mergeRecommendSettings({ recommendFreshLimit: '999' }).freshLimit).toBe(30)
    expect(mergeRecommendSettings({ recommendFreshLimit: '0' }).freshLimit).toBeUndefined()
    expect(mergeRecommendSettings({ recommendFreshLimit: 'abc' }).freshLimit).toBeUndefined()
    expect(mergeRecommendSettings({ recommendPracticedLimit: '-3' }).practicedLimit).toBeUndefined()
  })

  it('保留其余请求字段（knowledgeIds / filterTags / source 等）', () => {
    const r = mergeRecommendSettings({}, { knowledgeIds: ['dsu'], filterTags: ['dsu'], ratingMax: 1600 })
    expect(r.knowledgeIds).toEqual(['dsu'])
    expect(r.filterTags).toEqual(['dsu'])
    expect(r.ratingMax).toBe(1600)
  })
})

describe('dueReviewSet：题单复习到期判定', () => {
  it('只把 due <= today 且 stage > 0 的题算作到期', () => {
    const set = dueReviewSet(
      [
        { problemId: 'A', reviewStage: 2, reviewDue: '2026-03-10' },
        { problemId: 'B', reviewStage: 2, reviewDue: '2026-03-11' },
        { problemId: 'C', reviewStage: 0, reviewDue: '2026-03-01' },
        { problemId: 'D', reviewStage: 1, reviewDue: null }
      ],
      '2026-03-10'
    )
    expect([...set]).toEqual(['A'])
  })
})

/**
 * v1.15 缺陷回归：「未练习」栏被同一道题填满。
 *
 * 真实库里 132 道题 `solved_count = 0`（CF 实验场/gym 与部分洛谷题从未采集 AC 数），
 * 而 CF 1639 那场比赛的 11 道题**都叫 "Treasure Hunt"**且 rating 为 NULL。
 * 旧实现把 0 当"最少人做"排在最前、再按 id 打破平局，于是首页 8 个推荐位全是 1639:A…1639:H。
 */
describe('未练习推荐：solvedCount=0 与同名题（v1.15 回归）', () => {
  const noNodes: SkillNodeReport[] = []
  const baseDeps = {
    problems: [] as ProblemRow[],
    records: [] as { problemId: string; status: string; createdAt: string }[],
    nodes: noNodes,
    learning: { tier: 'untouched' as const, tags: [] as string[] },
    nodeAcc: () => 1
  }

  function rec(p: ProblemRow): RecommendedProblem {
    return {
      problem: p,
      state: 'undone',
      reason: { kind: 'new', text: '' },
      urgency: 0,
      daysSince: null,
      knowledgeIds: [],
      listNames: [],
      dueReview: false
    }
  }

  it('solvedCount = 0 视为「未采集」，排在有 AC 数的题之后', () => {
    const candidates = [
      problem({ id: 'Z1', solvedCount: 0, rating: null }),
      problem({ id: 'A1', solvedCount: 7 }),
      problem({ id: 'Z2', solvedCount: 0, rating: null })
    ]
    const order = sortFresh({ ...baseDeps, candidates, order: 'learning-node' }).map((r) => r.problem.id)
    expect(order).toEqual(['A1', 'Z1', 'Z2'])
  })

  it('端到端：AC 数未采集的同名题不会占据推荐位首位', () => {
    const treasure = Array.from({ length: 11 }, (_, i) =>
      problem({ id: `1639:${String.fromCharCode(65 + i)}`, name: 'Treasure Hunt', solvedCount: 0, contestId: 1639, rating: null })
    )
    const normal = [
      problem({ id: '1:A', solvedCount: 120 }),
      problem({ id: '2:B', solvedCount: 80 })
    ]
    const res = buildRecommendation(
      { ...baseDeps, problems: [...treasure, ...normal] },
      { freshLimit: 4 }
    )
    expect(res.fresh[0].problem.name).not.toBe('Treasure Hunt')
    expect(res.fresh[0].problem.id).toBe('2:B')
    expect(res.fresh[1].problem.id).toBe('1:A')
  })

  it('diversify：优先挑不同比赛/不同题名，仍不足才回填重复项', () => {
    const items = [
      ...Array.from({ length: 5 }, (_, i) =>
        rec(problem({ id: `T${i + 1}`, name: 'Treasure Hunt', contestId: 1639 }))
      ),
      rec(problem({ id: 'G1', name: 'Graph Game', contestId: 100 })),
      rec(problem({ id: 'G2', name: 'Digit DP', contestId: 101 })),
      rec(problem({ id: 'G3', name: 'Sort It', contestId: 102 }))
    ]
    const out = diversify(items, 4)
    expect(out.map((r) => r.problem.id)).toEqual(['T1', 'G1', 'G2', 'G3'])
    const names = out.map((r) => r.problem.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('diversify：同一场比赛最多 2 条，第 3 条排到后面', () => {
    const items = [
      rec(problem({ id: 'C1', name: 'Alpha', contestId: 900 })),
      rec(problem({ id: 'C2', name: 'Beta', contestId: 900 })),
      rec(problem({ id: 'C3', name: 'Gamma', contestId: 900 })),
      rec(problem({ id: 'D1', name: 'Delta', contestId: 901 }))
    ]
    const out = diversify(items, 4)
    expect(out.map((r) => r.problem.id)).toEqual(['C1', 'C2', 'D1', 'C3'])
  })

  it('diversify：不丢弃条目，limit 大于可用多样性时回填', () => {
    const items = [
      rec(problem({ id: 'X1', name: 'Same', contestId: 1 })),
      rec(problem({ id: 'X2', name: 'Same', contestId: 2 })),
      rec(problem({ id: 'X3', name: 'Same', contestId: 3 }))
    ]
    const out = diversify(items, 3)
    expect(out.length).toBe(3)
    expect(out.map((r) => r.problem.id)).toEqual(['X1', 'X2', 'X3'])
  })
})

/**
 * v1.16：题源筛选（首页推荐与题库页共用同一个题源）。
 * mergeRecommendSettings 负责把非法题源退化为「全部」，避免推荐列表被静默清空。
 */
describe('题源筛选（v1.16）', () => {
  it('合法题源原样保留', () => {
    for (const source of ['cf', 'luogu', 'leetcode'] as const) {
      expect(mergeRecommendSettings({}, { source }).source).toBe(source)
    }
    expect(mergeRecommendSettings({}, { source: 'all' }).source).toBe('all')
  })

  it('未传题源时默认为「全部」', () => {
    expect(mergeRecommendSettings({}, {}).source).toBe('all')
  })

  it('非法题源退化为「全部」（不把推荐清空）', () => {
    const invalid = { source: 'codeforces' } as unknown as { source: 'cf' }
    expect(mergeRecommendSettings({}, invalid).source).toBe('all')
  })

  it('题源进入 buildRecommendation 后只保留该平台题目', () => {
    const cf = problem({ id: '1A', source: 'cf' })
    const luogu = problem({ id: 'P1001', source: 'luogu' })
    const r = buildRecommendation(
      {
        problems: [cf, luogu],
        records: [],
        nodes: [],
        listNamesOf: () => [],
        dueReviewIds: new Set<string>()
      },
      mergeRecommendSettings({}, { source: 'luogu', freshLimit: 5 })
    )
    const ids = r.fresh.map((x) => x.problem.id)
    expect(ids).toEqual(['P1001'])
    expect(ids).not.toContain('1A')
  })
})
