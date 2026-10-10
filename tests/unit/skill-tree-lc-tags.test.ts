import { describe, it, expect } from 'vitest'
import { SKILL_NODES } from '@shared/skill-tree'

/**
 * 力扣中文标签 → 知识点节点映射（v1.9 FR-21）：
 * 力扣题库使用中文标签（数组/哈希表/动态规划…），此处确保关键标签已接入对应节点，
 * 使「题库 → 知识点」筛选对力扣题同样有效。
 */

function tagsOf(id: string): string[] {
  const node = SKILL_NODES.find((n) => n.id === id)
  expect(node, `节点 ${id} 不存在`).toBeTruthy()
  return node!.tags
}

describe('知识点节点标签（含力扣中文标签接入）', () => {
  it('节点内标签不重复', () => {
    for (const n of SKILL_NODES) {
      expect(new Set(n.tags).size, `${n.id} 存在重复标签`).toBe(n.tags.length)
    }
  })

  it('除综合节点外每个节点都有标签；综合节点保持无标签（不参与筛题）', () => {
    for (const n of SKILL_NODES) {
      if (n.id === 'final_sprint') expect(n.tags).toEqual([])
      else expect(n.tags.length, `${n.id} 无标签`).toBeGreaterThan(0)
    }
  })

  it('关键力扣标签已接入对应节点', () => {
    const expectations: [string, string][] = [
      ['math_basic', '最大公约数'],
      ['impl', '模拟'],
      ['sort', '归并排序'],
      ['greedy', '贪心'],
      ['prefix', '前缀和'],
      ['recursion', '分治'],
      ['twopointer', '滑动窗口'],
      ['bitops', '位运算'],
      ['binary', '二分查找'],
      ['stack_queue', '栈'],
      ['search', '深度优先搜索'],
      ['search', '广度优先搜索'],
      ['search', '回溯'],
      ['graph', '拓扑排序'],
      ['graph', '强连通分量'],
      ['dp', '动态规划'],
      ['dp', '最长上升子序列'],
      ['dsu', '并查集'],
      ['fenwick', '树状数组'],
      ['heap', '堆（优先队列）'],
      ['monotone', '单调栈'],
      ['monotone', '单调队列'],
      ['segtree', '线段树'],
      ['segtree', '扫描线'],
      ['number', '费马小定理'],
      ['combo', '容斥原理'],
      ['shortest', 'Dijkstra 算法'],
      ['mst', '最小生成树'],
      ['dp_knapsack', '0-1 背包'],
      ['dp_tree', '二叉树'],
      ['dp_state', '位掩码'],
      ['strings', '字符串匹配'],
      ['strings', '字典树'],
      ['strings_suf', '后缀数组'],
      ['lca', '最近公共祖先'],
      ['geo', '凸包'],
      ['flow', '最大流'],
      ['flow_adv', '最小费用流'],
      ['match', '匈牙利算法'],
      ['persist', '可持久化数据结构']
    ]
    for (const [id, tag] of expectations) {
      expect(tagsOf(id), `${id} 缺少力扣标签「${tag}」`).toContain(tag)
    }
  })

  it('仍有节点覆盖力扣算法题（≥20 个节点含力扣专属标签）', () => {
    // 力扣专属：这些标签只可能来自力扣（洛谷/CF 标签命名不同）
    const lcOnly = [
      '最大公约数',
      '归并排序',
      '滑动窗口',
      '二分查找',
      '深度优先搜索',
      '广度优先搜索',
      '回溯',
      '拓扑排序',
      '强连通分量',
      '堆（优先队列）',
      '扫描线',
      '费马小定理',
      '容斥原理',
      'Dijkstra 算法',
      '最小生成树',
      '0-1 背包',
      '二叉树',
      '位掩码',
      '字符串匹配',
      '字典树',
      '后缀数组',
      '最近公共祖先',
      '凸包',
      '最大流',
      '最小费用流',
      '匈牙利算法',
      '可持久化数据结构'
    ]
    const nodesWithLc = SKILL_NODES.filter((n) => n.tags.some((t) => lcOnly.includes(t)))
    expect(nodesWithLc.length).toBeGreaterThanOrEqual(20)
  })

  it('未接入过于宽泛的容器类标签（避免知识点筛选被稀释；仅容器/工程/交互专用节点例外）', () => {
    const tooGeneric = ['数组', '哈希表', '字符串', '矩阵', '设计', '交互', '数据流', '计数']
    // v1.10：这些节点本身就是「容器与 STL / 大模拟工程实现 / 交互题 / 矩阵与线性代数」主题，允许承载容器类标签
    const allowed = new Set(['stl_usage', 'sim_impl', 'interactive', 'matrix_linear'])
    for (const n of SKILL_NODES) {
      if (allowed.has(n.id)) continue
      for (const t of tooGeneric) {
        expect(n.tags, `${n.id} 不应包含过于宽泛的标签「${t}」`).not.toContain(t)
      }
    }
  })

  it('v1.10 新增的国内比赛高频节点存在、有标签且有简介', () => {
    const newNodes = [
      'stl_usage',
      'sim_impl',
      'brute_force',
      'expression',
      'interactive',
      'game_theory',
      'prob_stats',
      'matrix_linear',
      'meet_middle',
      'hash_str'
    ]
    for (const id of newNodes) {
      const node = SKILL_NODES.find((n) => n.id === id)
      expect(node, `缺少节点 ${id}`).toBeTruthy()
      expect(node!.tags.length, `${id} 无关联标签`).toBeGreaterThan(0)
      expect(node!.intro.length, `${id} 简介过短`).toBeGreaterThanOrEqual(25)
    }
    expect(SKILL_NODES.length).toBeGreaterThanOrEqual(54)
  })
})
