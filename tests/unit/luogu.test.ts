import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import {
  extractLuoguListJson,
  parseLuoguTags,
  mapLuoguToUpsert
} from '../../src/main/services/luogu'
import { AppError } from '../../src/main/db/errors'

// 真实洛谷页面 fixture（2026-09 抓取，见 docs/03 §9）
const page1 = readFileSync(new URL('../fixtures/luogu/list-page1.html', import.meta.url), 'utf8')
const page2 = readFileSync(new URL('../fixtures/luogu/list-page2.html', import.meta.url), 'utf8')
const tagsText = readFileSync(new URL('../fixtures/luogu/tags.json', import.meta.url), 'utf8')

describe('extractLuoguListJson（真实页面解析，FR-8.1）', () => {
  it('提取总数与首页 50 条题目', () => {
    const data = extractLuoguListJson(page1)
    expect(data.count).toBeGreaterThan(10000) // P 题库约 1.6 万
    expect(data.perPage).toBe(50)
    expect(data.result.length).toBe(50)
    expect(data.result[0].pid).toBe('P1000')
    expect(data.result[0].name.length).toBeGreaterThan(0)
    expect(typeof data.result[0].difficulty).toBe('number')
    expect(Array.isArray(data.result[0].tags)).toBe(true)
  })

  it('第 2 页与第 1 页无重复 pid', () => {
    const d1 = extractLuoguListJson(page1)
    const d2 = extractLuoguListJson(page2)
    const ids1 = new Set(d1.result.map((p) => p.pid))
    const dup = d2.result.filter((p) => ids1.has(p.pid))
    expect(dup.length).toBe(0)
  })

  it('非洛谷页面抛 LUOGU_PARSE_FAILED', () => {
    expect(() => extractLuoguListJson('<html><body>not luogu</body></html>')).toThrow(AppError)
  })
})

describe('parseLuoguTags（FR-8.1 tag 映射）', () => {
  it('解析 id→中文名（含动态规划/图论）', () => {
    const map = parseLuoguTags(tagsText)
    expect(map.size).toBeGreaterThan(50)
    expect(map.get(3)).toBe('动态规划 DP')
    expect(map.get(6)).toBe('图论')
  })

  it('非法 JSON 抛错', () => {
    expect(() => parseLuoguTags('not-json')).toThrow(AppError)
  })
})

describe('mapLuoguToUpsert（页面 → 入库输入）', () => {
  it('映射字段与 tag 名称正确', () => {
    const data = extractLuoguListJson(page1)
    const tagMap = parseLuoguTags(tagsText)
    const inputs = mapLuoguToUpsert(data, tagMap)
    expect(inputs.length).toBe(50)
    const first = inputs[0]
    expect(first.source).toBe('luogu')
    expect(first.index).toBe('P1000')
    expect(first.rating).toBeNull()
    expect(typeof first.difficulty).toBe('number')
    expect(first.solvedCount).toBeGreaterThan(0) // totalAccepted
    expect(first.totalSubmit).toBeGreaterThanOrEqual(first.solvedCount)
    // tags 已转中文名且无空值
    expect(first.tags.length).toBeGreaterThan(0)
    expect(first.tags.every((t) => typeof t === 'string' && t.length > 0)).toBe(true)
  })
})
