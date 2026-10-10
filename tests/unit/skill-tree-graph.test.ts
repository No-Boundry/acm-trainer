import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { SKILL_NODES, SKILL_NODE_MAP, CF_TAGS } from '../../src/shared/skill-tree'

/**
 * 图谱数据校验（v1.6 FR-9.1）：
 * 依赖引用存在、层级严格递增（无环）、关联标签真实存在（CF 全集 / 洛谷真实字典），
 * 防止节点统计静默为 0。
 */

describe('技能树图谱完整性（FR-9.1）', () => {
  it('节点 id 唯一且依赖引用均存在', () => {
    const ids = new Set(SKILL_NODES.map((n) => n.id))
    expect(ids.size).toBe(SKILL_NODES.length)
    for (const n of SKILL_NODES) {
      for (const d of n.dependsOn) {
        expect(ids.has(d), `${n.id} 依赖不存在的节点 ${d}`).toBe(true)
      }
    }
  })

  it('依赖层级不向上（dep.layer ≤ 自身.layer）且全图无环（Kahn 拓扑）', () => {
    for (const n of SKILL_NODES) {
      for (const d of n.dependsOn) {
        const dep = SKILL_NODE_MAP.get(d)!
        expect(dep.layer <= n.layer, `${n.id} 依赖 ${d} 层级向上（违反由易到难）`).toBe(true)
      }
    }
    // Kahn 环检测
    const indeg = new Map<string, number>()
    const adj = new Map<string, string[]>()
    for (const n of SKILL_NODES) {
      indeg.set(n.id, n.dependsOn.length)
      adj.set(n.id, [])
    }
    for (const n of SKILL_NODES) {
      for (const d of n.dependsOn) adj.get(d)!.push(n.id)
    }
    const queue = SKILL_NODES.filter((n) => indeg.get(n.id) === 0).map((n) => n.id)
    let visited = 0
    while (queue.length > 0) {
      const cur = queue.shift()!
      visited += 1
      for (const next of adj.get(cur)!) {
        indeg.set(next, indeg.get(next)! - 1)
        if (indeg.get(next) === 0) queue.push(next)
      }
    }
    expect(visited).toBe(SKILL_NODES.length) // 存在环则 visited < 总数
  })

  it('每个节点至少有 1 个关联标签（final_sprint 综合节点除外）', () => {
    for (const n of SKILL_NODES) {
      if (n.id === 'final_sprint') continue
      expect(n.tags.length > 0, `${n.id} 缺少关联标签`).toBe(true)
    }
  })

  it('关联标签存在于 CF 全集 / 真实洛谷字典 / 真实力扣字典（防静默 0 统计）', () => {
    const tagsText = readFileSync(new URL('../fixtures/luogu/tags.json', import.meta.url), 'utf8')
    const parsed = JSON.parse(tagsText) as { tags: { name: string }[] }
    const luoguNames = new Set(parsed.tags.map((t) => t.name.trim()))
    // v1.9 FR-21：力扣中文标签字典（真实接口抓取，见 fixtures/leetcode/tags.json 头部说明）
    const lcText = readFileSync(new URL('../fixtures/leetcode/tags.json', import.meta.url), 'utf8')
    const lcParsed = JSON.parse(lcText) as { tags: { name: string }[] }
    const lcNames = new Set(lcParsed.tags.map((t) => t.name.trim()))
    const cfSet = new Set(CF_TAGS.map((t) => t.toLowerCase()))
    const missing: string[] = []
    for (const n of SKILL_NODES) {
      for (const tag of n.tags) {
        const ok = cfSet.has(tag.toLowerCase()) || luoguNames.has(tag) || lcNames.has(tag)
        if (!ok) missing.push(`${n.id}:${tag}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('至少 30 个节点、覆盖 6 层以上', () => {
    expect(SKILL_NODES.length).toBeGreaterThanOrEqual(30)
    const layers = new Set(SKILL_NODES.map((n) => n.layer))
    expect(layers.size).toBeGreaterThanOrEqual(6)
  })

  it('v1.7 FR-11：每个节点均有非空且足够长度的中文简介（无占位/TODO）', () => {
    for (const n of SKILL_NODES) {
      expect(typeof n.intro, `${n.id} 缺少 intro`).toBe('string')
      expect(n.intro.length, `${n.id} 简介过短`).toBeGreaterThanOrEqual(25)
      expect(n.intro, `${n.id} 简介含占位符`).not.toMatch(/TODO|占位|待写|intro/i)
      // 简介应包含中文字符（面向中文用户的定位/说明）
      expect(/[\u4e00-\u9fff]/.test(n.intro), `${n.id} 简介无中文`).toBe(true)
    }
  })
})
