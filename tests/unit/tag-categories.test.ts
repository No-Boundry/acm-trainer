import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { categorizeTag, groupTagsByCategory, TAG_CATEGORIES } from '../../src/shared/tag-categories'

describe('categorizeTag（FR-8.8 跨源标签归类）', () => {
  // CF 官方 tag → 大类
  const cfCases: [string, string][] = [
    ['implementation', '算法基础'],
    ['greedy', '算法基础'],
    ['brute force', '算法基础'],
    ['constructive algorithms', '算法基础'],
    ['sortings', '算法基础'],
    ['binary search', '算法基础'],
    ['two pointers', '算法基础'],
    ['dp', '动态规划'],
    ['graphs', '图论'],
    ['trees', '图论'],
    ['shortest paths', '图论'],
    ['flows', '图论'],
    ['math', '数学'],
    ['number theory', '数学'],
    ['combinatorics', '数学'],
    ['probabilities', '数学'],
    ['games', '数学'],
    ['geometry', '数学'],
    ['fft', '数学'],
    ['data structures', '数据结构'],
    ['strings', '字符串'],
    ['dfs and similar', '搜索'],
    ['meet-in-the-middle', '搜索'],
    ['ternary search', '搜索']
  ]
  for (const [tag, expected] of cfCases) {
    it(`CF tag "${tag}" → ${expected}`, () => {
      expect(categorizeTag(tag)).toBe(expected)
    })
  }

  // 洛谷中文 tag → 大类（含易误伤子串用例）
  const luoguCases: [string, string][] = [
    ['模拟', '算法基础'],
    ['二分', '算法基础'],
    ['动态规划 DP', '动态规划'],
    ['状态压缩', '动态规划'],
    ['图论', '图论'],
    ['二分图', '图论'], // 不被 '二分'/'二分答案' 误伤
    ['最短路', '图论'],
    ['树状数组', '数据结构'], // 不被 '树' 误伤
    ['线段树', '数据结构'],
    ['暴力数据结构', '数据结构'],
    ['字符串哈希', '字符串'],
    ['博弈论', '数学'],
    ['数论', '数学'],
    ['计算几何', '数学'],
    ['搜索', '搜索']
  ]
  for (const [tag, expected] of luoguCases) {
    it(`洛谷 tag "${tag}" → ${expected}`, () => {
      expect(categorizeTag(tag)).toBe(expected)
    })
  }

  it('未知标签落入「其他」', () => {
    expect(categorizeTag('量子计算')).toBe('其他')
    expect(categorizeTag('')).toBe('其他')
  })

  it('真实洛谷 tag 字典覆盖：核心算法标签绝大多数可归类', () => {
    const tagsText = readFileSync(new URL('../fixtures/luogu/tags.json', import.meta.url), 'utf8')
    const parsed = JSON.parse(tagsText) as { tags: { id: number; name: string; type?: number }[] }
    const regular = parsed.tags.filter((t) => t.type === 2 && t.id > 0).map((t) => t.name)
    expect(regular.length).toBeGreaterThan(50)
    const otherShare = regular.filter((n) => categorizeTag(n) === '其他').length / regular.length
    // 常规算法类标签应绝大多数可归类（真实字典 261 个中未归类应 < 6%）
    expect(otherShare).toBeLessThan(0.06)
    // 高频核心标签必须正确
    for (const core of ['动态规划 DP', '图论', '数学', '模拟', '数据结构', '字符串', '搜索', '贪心', '数论']) {
      expect(categorizeTag(core)).not.toBe('其他')
    }
  })
})

describe('groupTagsByCategory', () => {
  it('按分类顺序分组且仅含非空组', () => {
    const groups = groupTagsByCategory(['dp', 'graphs', '模拟', '量子计算', 'math'])
    const names = groups.map((g) => g.category)
    expect(names.indexOf('动态规划')).toBeLessThan(names.indexOf('图论'))
    expect(groups.find((g) => g.category === '算法基础')?.tags).toEqual(['模拟'])
    expect(groups.find((g) => g.category === '其他')?.tags).toEqual(['量子计算'])
    expect(TAG_CATEGORIES.length).toBeGreaterThanOrEqual(8)
  })
})
