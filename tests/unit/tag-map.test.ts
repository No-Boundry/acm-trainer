import { describe, it, expect } from 'vitest'
import {
  TAG_ALIASES,
  TAG_ALIAS_TOTAL,
  canonicalTag,
  canonicalTags
} from '../../src/shared/tag-map'
import { CF_TAGS, SKILL_NODES } from '../../src/shared/skill-tree'

/**
 * v1.18 FR-38：标签同义映射表本身的一致性。
 *
 * 映射表是「一个概念一行」的唯一事实来源，写库、迁移、查询三处都依赖它，
 * 因此这里把「不能出现的形状」全部钉死：别名重复、别名撞 canonical、
 * 空别名、映射无变化（等于没映射）。
 */

const entries = Object.entries(TAG_ALIASES)

describe('标签映射表结构', () => {
  it('canonical 不重复、不含空白首尾', () => {
    const names = entries.map(([canonical]) => canonical)
    expect(new Set(names).size).toBe(names.length)
    for (const name of names) expect(name).toBe(name.trim())
  })

  it('同一别名不会指向两个 canonical', () => {
    const seen = new Map<string, string>()
    for (const [canonical, aliases] of entries) {
      for (const alias of aliases) {
        const key = alias.toLowerCase()
        const prev = seen.get(key)
        expect(prev === undefined || prev === canonical, `别名 ${alias} 同时指向 ${prev} 与 ${canonical}`).toBe(
          true
        )
        seen.set(key, canonical)
      }
    }
  })

  it('别名不会撞上另一个 canonical（避免链式映射）', () => {
    const canonicalSet = new Set(entries.map(([canonical]) => canonical.toLowerCase()))
    for (const [canonical, aliases] of entries) {
      for (const alias of aliases) {
        // 纯大小写差异（如别名 '2-sat' ↔ canonical '2-SAT'）不算撞车，
        // 查找时不区分大小写，两者指向同一个 canonical。
        if (alias.toLowerCase() === canonical.toLowerCase()) continue
        expect(canonicalSet.has(alias.toLowerCase()), `别名 ${alias} 已是 canonical`).toBe(false)
      }
    }
  })

  it('别名非空、不与自身 canonical 相同、组内不重复', () => {
    for (const [canonical, aliases] of entries) {
      expect(aliases.length).toBeGreaterThan(0)
      const lowers = aliases.map((a) => a.toLowerCase())
      expect(new Set(lowers).size).toBe(lowers.length)
      for (const alias of aliases) {
        expect(alias.trim()).toBe(alias)
        expect(alias).not.toBe(canonical)
        expect(alias.length).toBeGreaterThan(0)
      }
    }
  })

  it('映射总数与别名数对得上', () => {
    const aliasCount = entries.reduce((sum, [, aliases]) => sum + aliases.length, 0)
    expect(TAG_ALIAS_TOTAL).toBe(entries.length + aliasCount)
    expect(TAG_ALIAS_TOTAL).toBeGreaterThan(60)
  })
})

describe('canonicalTag', () => {
  it('英文 Codeforces 标签映射到中文', () => {
    expect(canonicalTag('greedy')).toBe('贪心')
    expect(canonicalTag('dp')).toBe('动态规划')
    expect(canonicalTag('graphs')).toBe('图论')
    expect(canonicalTag('data structures')).toBe('数据结构')
    expect(canonicalTag('brute force')).toBe('暴力')
    expect(canonicalTag('meet-in-the-middle')).toBe('折半搜索')
  })

  it('中文同义写法归并到同一 canonical', () => {
    expect(canonicalTag('动态规划 DP')).toBe('动态规划')
    expect(canonicalTag('二分查找')).toBe('二分')
    expect(canonicalTag('深度优先搜索 DFS')).toBe('深度优先搜索')
    expect(canonicalTag('优先队列')).toBe('堆')
    expect(canonicalTag('堆（优先队列）')).toBe('堆')
    expect(canonicalTag('字典树 Trie')).toBe('字典树')
    expect(canonicalTag('后缀自动机 SAM')).toBe('后缀自动机')
  })

  it('canonical 自身是幂等的', () => {
    for (const [canonical, aliases] of entries) {
      expect(canonicalTag(canonical)).toBe(canonical)
      for (const alias of aliases) expect(canonicalTag(canonicalTag(alias))).toBe(canonical)
    }
  })

  it('大小写与连续空白不敏感', () => {
    expect(canonicalTag('Greedy')).toBe('贪心')
    expect(canonicalTag('  DP  ')).toBe('动态规划')
    expect(canonicalTag('Binary   Lifting')).toBe('倍增')
    expect(canonicalTag('Two Pointers')).toBe('双指针')
  })

  it('未收录标签原样返回（去掉首尾空白），不误伤来源/赛事类标签', () => {
    expect(canonicalTag('Special Judge')).toBe('Special Judge')
    expect(canonicalTag('ICPC')).toBe('ICPC')
    expect(canonicalTag('洛谷原创')).toBe('洛谷原创')
    expect(canonicalTag(' 2024 ')).toBe('2024')
    expect(canonicalTag('Ad-hoc')).toBe('Ad-hoc')
    expect(canonicalTag('')).toBe('')
  })
})

describe('canonicalTags', () => {
  it('批量映射并去重，保持首次出现顺序', () => {
    expect(canonicalTags(['greedy', '贪心', 'dp', '动态规划 DP'])).toEqual(['贪心', '动态规划'])
    expect(canonicalTags(['dp', 'greedy'])).toEqual(['动态规划', '贪心'])
  })

  it('过滤空串、保留未收录标签', () => {
    expect(canonicalTags(['', '  ', 'graphs', 'Special Judge'])).toEqual(['图论', 'Special Judge'])
    expect(canonicalTags([])).toEqual([])
  })
})

describe('技能树节点标签在映射后仍然可用', () => {
  it('每个节点的 canonical 标签非空且无重复（final_sprint 设计上无标签）', () => {
    for (const node of SKILL_NODES) {
      const tags = canonicalTags(node.tags)
      expect(new Set(tags).size).toBe(tags.length)
      if (node.id === 'final_sprint') expect(tags).toEqual([])
      else expect(tags.length).toBeGreaterThan(0)
    }
  })

  it('CF 官方标签全部有中文 canonical（不再残留纯英文概念标签）', () => {
    for (const tag of CF_TAGS) {
      const canonical = canonicalTag(tag)
      expect(canonical, `CF 标签 ${tag} 未映射`).not.toBe(tag)
      // 剩下未映射的只允许是无中文概念的 ASCII 术语（本例中 CF_TAGS 全部应已映射）
    }
  })

  it('节点里的英文写法映射后与中文写法合并，节点标签数不会虚高', () => {
    const dsu = SKILL_NODES.find((n) => n.id === 'dsu')!
    expect(canonicalTags(dsu.tags)).toEqual(['并查集'])
    const greedy = SKILL_NODES.find((n) => n.id === 'greedy')!
    expect(canonicalTags(greedy.tags)).toEqual(['贪心'])
    const dp = SKILL_NODES.find((n) => n.id === 'dp')!
    expect(canonicalTags(dp.tags)).toContain('动态规划')
    expect(canonicalTags(dp.tags)).not.toContain('dp')
  })
})
