import { describe, it, expect } from 'vitest'
import {
  STL_CATEGORIES,
  STL_ENTRIES,
  categoryMeta,
  groupStlEntries,
  searchStlEntries
} from '@shared/stl-reference'

/**
 * STL 速查参考资料测试（v1.8.2 FR-18）：数据完整性与搜索/分组纯函数。
 */

describe('STL 速查数据完整性', () => {
  it('条目数量足够且 id 唯一', () => {
    expect(STL_ENTRIES.length).toBeGreaterThanOrEqual(30)
    const ids = STL_ENTRIES.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('每条都有名称、用途与非空代码片段，且分类合法', () => {
    const validCats = new Set(STL_CATEGORIES.map((c) => c.key))
    for (const e of STL_ENTRIES) {
      expect(e.name.trim(), `${e.id} 缺少名称`).not.toBe('')
      expect(e.summary.trim().length, `${e.id} 用途过短`).toBeGreaterThan(8)
      expect(e.code.trim().length, `${e.id} 缺少代码片段`).toBeGreaterThan(10)
      expect(validCats.has(e.category), `${e.id} 分类非法：${e.category}`).toBe(true)
    }
  })

  it('六个分类均有内容（序列/适配器/关联/其他/算法/技巧）', () => {
    for (const c of STL_CATEGORIES) {
      const n = STL_ENTRIES.filter((e) => e.category === c.key).length
      expect(n, `分类 ${c.key} 为空`).toBeGreaterThan(0)
    }
  })

  it('外链均为 https，且覆盖核心容器', () => {
    for (const e of STL_ENTRIES) {
      if (e.url) expect(e.url.startsWith('https://'), `${e.id} 外链非 https`).toBe(true)
    }
    const names = STL_ENTRIES.map((e) => e.name).join(' ')
    for (const key of ['std::vector', 'std::map', 'std::set', 'std::priority_queue', 'sort', 'bitset']) {
      expect(names, `缺少 ${key}`).toContain(key)
    }
  })
})

describe('searchStlEntries（关键字搜索）', () => {
  it('空关键字返回全部', () => {
    expect(searchStlEntries('').length).toBe(STL_ENTRIES.length)
    expect(searchStlEntries('   ').length).toBe(STL_ENTRIES.length)
  })

  it('按名称/用途/代码/坑点均可命中，且大小写无关', () => {
    expect(searchStlEntries('vector').some((e) => e.name.includes('vector'))).toBe(true)
    expect(searchStlEntries('VECTOR').length).toBeGreaterThan(0)
    // 命中坑点文本
    const invalid = searchStlEntries('迭代器')
    expect(invalid.some((e) => e.id === 'tip-iterator-invalidation')).toBe(true)
    // 命中代码片段（'reserve' 只出现在部分条目的代码中）
    expect(searchStlEntries('reserve').length).toBeGreaterThan(0)
  })

  it('多关键字为 AND 语义', () => {
    const both = searchStlEntries('map find')
    expect(both.length).toBeGreaterThan(0)
    expect(both.every((e) => /map/i.test(e.name + e.summary + e.code))).toBe(true)
  })

  it('无匹配返回空数组', () => {
    expect(searchStlEntries('zzzz-not-exist')).toEqual([])
  })
})

describe('groupStlEntries（分类分组）', () => {
  it('按分类顺序分组，且不返回空分组', () => {
    const groups = groupStlEntries()
    expect(groups.length).toBe(STL_CATEGORIES.length)
    const order = groups.map((g) => g.meta.key)
    expect(order).toEqual(STL_CATEGORIES.map((c) => c.key))
    for (const g of groups) expect(g.items.length).toBeGreaterThan(0)
    const total = groups.reduce((s, g) => s + g.items.length, 0)
    expect(total).toBe(STL_ENTRIES.length)
  })

  it('可对过滤后的子集分组（只保留有内容的分类）', () => {
    const onlyAlgorithm = groupStlEntries(STL_ENTRIES.filter((e) => e.category === 'algorithm'))
    expect(onlyAlgorithm.length).toBe(1)
    expect(onlyAlgorithm[0].meta.key).toBe('algorithm')
  })

  it('categoryMeta 对未知分类回退为「其他」', () => {
    expect(categoryMeta('misc').label).toBe('其他常用')
    // @ts-expect-error 故意传入非法分类
    expect(categoryMeta('nope').label).toBe('其他')
  })
})
