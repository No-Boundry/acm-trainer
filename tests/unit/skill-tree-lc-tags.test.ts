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
      // v1.19 拆分：回溯归入「暴力与剪枝」，强连通/割点桥归入「连通性与割点桥」
      ['brute_force', '回溯'],
      ['graph', '拓扑排序'],
      ['graph_conn', '强连通分量'],
      ['dp', '动态规划'],
      ['dp_seq', '最长上升子序列'],
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
      ['ac_auto', '字典树'],
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
    const tooGeneric = ['数组', '哈希表', '字符串', '矩阵', '设计', '交互', '数据流']
    // v1.10：这些节点本身就是「容器与 STL / 大模拟工程实现 / 交互题 / 矩阵与线性代数」主题，允许承载容器类标签
    // v1.20 FR-41：把标签大类整合进知识点后，「计数」只能落在组合数学节点（原本它是筛选界面里的独立标签，
    // 有 217 道题；不并进来就没有任何入口能筛到它们）。
    const allowed = new Set(['stl_usage', 'sim_impl', 'interactive', 'matrix_linear', 'combo'])
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

describe('知识点粒度（v1.19 FR-39：单节点标签过多则拆分）', () => {
  it('节点总数为 70（54 + 拆分出的 16 个专题节点）', () => {
    expect(SKILL_NODES.length).toBe(70)
  })

  it('每个节点的关联标签不超过 10 个（v1.20 FR-41：标签大类并入知识点后上限放宽到 10）', () => {
    for (const n of SKILL_NODES) {
      if (n.id === 'final_sprint') continue
      expect(n.tags.length, `${n.id} 关联标签过多（${n.tags.length}）`).toBeLessThanOrEqual(10)
    }
  })

  it('v1.20 FR-41：题库里有量但原先只在筛选界面裸露的概念标签，已归入知识点', () => {
    const expectIn = new Map<string, string>([
      ['搜索', 'search'],
      ['递推', 'dp'],
      ['树链剖分', 'lca'],
      ['根号分治', 'sparse_block'],
      ['莫队', 'sparse_block'],
      ['动态规划优化', 'dp_opt'],
      ['最小圆覆盖', 'geo_adv'],
      ['生成函数', 'fft'],
      ['动态树 LCT', 'balanced_tree'],
      ['连通块', 'graph_conn']
    ])
    for (const [tag, nodeId] of expectIn) {
      const node = SKILL_NODES.find((n) => n.id === nodeId)
      expect(node, `缺少节点 ${nodeId}`).toBeTruthy()
      expect(node!.tags, `${nodeId} 应包含「${tag}」`).toContain(tag)
    }
  })

  it('拆分出的 16 个专题节点都存在、有标签且有简介', () => {
    const splitIds = [
      'prime',
      'bezout',
      'sort_adv',
      'dp_seq',
      'graph_conn',
      'euler',
      'graph_extra',
      'heuristic_search',
      'shortest_adv',
      'sparse_block',
      'balanced_tree',
      'lichao_kd',
      'ac_auto',
      'flow_impl',
      'minimax',
      'geo_adv'
    ]
    expect(splitIds.length).toBe(16)
    for (const id of splitIds) {
      const node = SKILL_NODES.find((n) => n.id === id)
      expect(node, `缺少拆分节点 ${id}`).toBeTruthy()
      expect(node!.tags.length, `${id} 无关联标签`).toBeGreaterThan(0)
      expect(node!.intro.length, `${id} 简介过短`).toBeGreaterThanOrEqual(25)
    }
  })
})
