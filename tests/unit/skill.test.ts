import { describe, it, expect } from 'vitest'
import { classifyTier, nodeAvailability, buildSkillReport } from '../../src/main/services/skill'
import { SKILL_NODES } from '@shared/skill-tree'
import type { Repos } from '../../src/main/services'
import type { NodePracticeStats } from '@shared/types'

const s = (partial: Partial<NodePracticeStats>): NodePracticeStats => ({
  attempted: 0,
  acProblems: 0,
  attempts: 0,
  acAttempts: 0,
  acc: null,
  hardSolved: 0,
  lastActiveDays: null,
  ...partial
})

describe('classifyTier（v1.6 FR-9.2 五档）', () => {
  it('无尝试 → untouched', () => {
    expect(classifyTier(s({}))).toBe('untouched')
  })

  it('有尝试但 AC < 3 → newbie', () => {
    expect(classifyTier(s({ attempted: 3, acProblems: 2, attempts: 5, acAttempts: 2, acc: 0.4 }))).toBe('newbie')
  })

  it('AC ≥3 但 <8 或正确率低 → learning', () => {
    expect(classifyTier(s({ attempted: 5, acProblems: 5, attempts: 8, acAttempts: 6, acc: 0.75 }))).toBe('learning') // ac<8
    expect(classifyTier(s({ attempted: 20, acProblems: 8, attempts: 30, acAttempts: 10, acc: 0.33 }))).toBe('learning') // acc 低
  })

  it('AC ≥8 且正确率达标 → proficient（无难题）', () => {
    expect(classifyTier(s({ attempted: 10, acProblems: 9, attempts: 14, acAttempts: 10, acc: 0.71 }))).toBe('proficient')
  })

  it('AC ≥15 且 acc ≥0.7 且有难题 → master', () => {
    expect(
      classifyTier(s({ attempted: 18, acProblems: 16, attempts: 22, acAttempts: 17, acc: 0.77, hardSolved: 1 }))
    ).toBe('master')
  })

  it('AC ≥25 且 acc ≥0.6 → master（无需难题）', () => {
    expect(classifyTier(s({ attempted: 30, acProblems: 26, attempts: 40, acAttempts: 26, acc: 0.65, hardSolved: 0 }))).toBe(
      'master'
    )
  })
})

describe('nodeAvailability（FR-9.3 依赖达标）', () => {
  it('全部前置 proficient/master → 可学', () => {
    expect(nodeAvailability(['proficient'])).toBe(true)
    expect(nodeAvailability(['master', 'proficient'])).toBe(true)
  })

  it('存在未达标前置 → 锁定', () => {
    expect(nodeAvailability(['learning'])).toBe(false)
    expect(nodeAvailability(['untouched', 'proficient'])).toBe(false)
    expect(nodeAvailability([])).toBe(true)
  })
})

describe('buildSkillReport 组装（FR-9.2/9.3 + v1.7 FR-11 intro 透传）', () => {
  const emptyRepos = (): Repos =>
    ({
      records: { list: () => ({ items: [], total: 0 }) },
      problems: { getById: () => null }
    }) as unknown as Repos

  it('空数据：44 节点全 untouched、intro 与图谱一致、推荐 = L0 五节点', () => {
    const report = buildSkillReport(emptyRepos())
    expect(report.nodes).toHaveLength(SKILL_NODES.length)
    const byId = new Map(SKILL_NODES.map((n) => [n.id, n]))
    for (const node of report.nodes) {
      // v1.7 FR-11：报告节点必须携带内置简介
      expect(node.intro).toBe(byId.get(node.id)!.intro)
      expect(node.intro.length).toBeGreaterThan(0)
      expect(node.tier).toBe('untouched')
    }
    const l0 = SKILL_NODES.filter((n) => n.layer === 0)
      .map((n) => n.id)
      .sort()
    expect([...report.recommendedIds].sort()).toEqual(l0)
    expect(report.allDone).toBe(false)
  })
})
