import { describe, it, expect } from 'vitest'
import {
  computePenaltySeconds,
  computeContestBreakdown,
  finishContest
} from '../../src/main/services/contest'
import type { Contest, Problem, ResultStatus } from '@shared/types'

function makeProblem(id: string, rating: number): Problem {
  return {
    id,
    contestId: 1,
    index: 'A',
    name: id,
    rating,
    difficulty: null,
    solvedCount: 0,
    totalSubmit: 0,
    source: 'cf',
    cfUrl: '',
    tags: [],
    fetchedAt: ''
  }
}

function makeContest(
  problems: { id: string; rating: number }[],
  subs: { problemId: string; status: ResultStatus; secondsElapsed: number; id: number }[]
): Contest {
  return {
    id: 1,
    name: '测试赛',
    durationMinutes: 60,
    status: 'finished',
    startedAt: '2026-01-01 10:00:00',
    finishedAt: '2026-01-01 11:00:00',
    createdAt: '2026-01-01 09:00:00',
    problems: problems.map((p, position) => ({ position, problem: makeProblem(p.id, p.rating) })),
    submissions: subs
  }
}

describe('computePenaltySeconds（ACM 罚时，04 §2.2）', () => {
  it('AC@30min + 1 次 WA → 1800 + 20×60 = 3000s', () => {
    expect(computePenaltySeconds(1800, 1)).toBe(3000)
  })

  it('未 AC → penalty 为 null', () => {
    expect(computePenaltySeconds(null, 2)).toBeNull()
  })

  it('纯 AC 600s → 600s', () => {
    expect(computePenaltySeconds(600, 0)).toBe(600)
  })
})

describe('computeContestBreakdown / finishContest（04 §2.2）', () => {
  it('每题结果与总罚时正确', () => {
    const contest = makeContest(
      [
        { id: 'A', rating: 1400 },
        { id: 'B', rating: 1600 }
      ],
      [
        { problemId: 'A', status: 'WA', secondsElapsed: 300, id: 1 },
        { problemId: 'A', status: 'AC', secondsElapsed: 1800, id: 2 },
        { problemId: 'B', status: 'AC', secondsElapsed: 600, id: 3 }
      ]
    )
    const breakdown = computeContestBreakdown(contest)
    expect(breakdown[0]).toMatchObject({ problemId: 'A', acSeconds: 1800, wrongCount: 1, penaltySeconds: 3000 })
    expect(breakdown[1]).toMatchObject({ problemId: 'B', acSeconds: 600, wrongCount: 0, penaltySeconds: 600 })

    // finishContest 依赖 repos（enrich），此处仅验证纯计算
    const total = breakdown.reduce((s, b) => s + (b.penaltySeconds ?? 0), 0)
    expect(total).toBe(3600)
  })

  it('未 AC 的题 penalty 不计入总罚时', () => {
    const contest = makeContest(
      [{ id: 'A', rating: 1400 }],
      [
        { problemId: 'A', status: 'WA', secondsElapsed: 100, id: 1 },
        { problemId: 'A', status: 'WA', secondsElapsed: 200, id: 2 }
      ]
    )
    const breakdown = computeContestBreakdown(contest)
    expect(breakdown[0]).toMatchObject({ acSeconds: null, wrongCount: 2, penaltySeconds: null, status: 'WA' })
  })
})
