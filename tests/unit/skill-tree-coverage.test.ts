import { describe, it, expect } from 'vitest'
import { SKILL_NODES, coveredNodeIds } from '@shared/skill-tree'
import { canonicalTags } from '@shared/tag-map'

/**
 * v1.21.0 FR-44：把题单里的题库标签映射回知识点节点。
 * 语义 = 节点任一关联标签命中即算覆盖（并集，与题库知识点筛选一致），标签先经 tag-map 归一。
 */

describe('coveredNodeIds：题单标签 → 知识点节点', () => {
  it('英文/中文别名归一后能命中同一节点', () => {
    expect(coveredNodeIds(['贪心'])).toContain('greedy')
    expect(coveredNodeIds(['greedy'])).toContain('greedy')
    // canonicalTags 把 greedy 与 贪心 归一，两种写法等价
    expect(coveredNodeIds(['greedy'])).toEqual(coveredNodeIds(['贪心']))
    expect(canonicalTags(['greedy', '贪心'])).toEqual(canonicalTags(['贪心']))
  })

  it('多个标签取并集：一份题单可以覆盖多个知识点', () => {
    const greedy = coveredNodeIds(['贪心'])
    const dp = coveredNodeIds(['动态规划'])
    const both = coveredNodeIds(['贪心', '动态规划'])
    expect(both).toContain('greedy')
    expect(both).toContain('dp')
    expect(new Set(both)).toEqual(new Set([...greedy, ...dp]))
    expect(both.length).toBeGreaterThanOrEqual(2)
  })

  it('未知标签返回空数组（不抛错）', () => {
    expect(coveredNodeIds([])).toEqual([])
    expect(coveredNodeIds(['完全不存在的标签 xyz'])).toEqual([])
    expect(coveredNodeIds(new Set<string>())).toEqual([])
  })

  it('结果按图谱声明顺序排列，可直接用于「仅显示题单知识点」', () => {
    const input = new Set(['贪心', '动态规划', '深度优先搜索'])
    const ids = coveredNodeIds(input)
    expect(ids.length).toBeGreaterThan(0)
    const order = new Map(SKILL_NODES.map((n, i) => [n.id, i]))
    for (let i = 1; i < ids.length; i++) {
      expect(order.get(ids[i])! > order.get(ids[i - 1])!).toBe(true)
    }
    // 同一输入两次调用结果稳定
    expect(coveredNodeIds(input)).toEqual(ids)
  })

  it('重复标签不产生重复节点', () => {
    const ids = coveredNodeIds(['贪心', 'greedy', '贪心'])
    expect(new Set(ids).size).toBe(ids.length)
  })
})
