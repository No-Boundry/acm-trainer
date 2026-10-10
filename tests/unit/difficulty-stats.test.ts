import { describe, it, expect } from 'vitest'
import { buildDifficultyStats, type DifficultyRawRow } from '../../src/main/services/difficulty-stats'

/**
 * 难度分布统计纯函数（v1.9 FR-22）：分档标签、零填充、排序、AC 率与占比。
 */

const row = (
  source: DifficultyRawRow['source'],
  bucket: string,
  attempted: number,
  ac: number
): DifficultyRawRow => ({ source, bucket, attempted, ac })

describe('buildDifficultyStats（难度分布组装）', () => {
  it('无数据：三题源均 0，力扣/洛谷仍展示标准档位（图表不空）', () => {
    const r = buildDifficultyStats([])
    expect(r.cf.attempted).toBe(0)
    expect(r.cf.buckets).toEqual([])
    expect(r.luogu.buckets.map((b) => b.key)).toEqual(['d0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7'])
    expect(r.leetcode.buckets.map((b) => b.key)).toEqual(['d1', 'd2', 'd3'])
    expect(r.leetcode.buckets.every((b) => b.attempted === 0 && b.acRate === null)).toBe(true)
  })

  it('CF：rating 分段标签、<800 与 3000+ 边界、区间内空档补齐', () => {
    const r = buildDifficultyStats([
      row('cf', 'lt800', 3, 3),
      row('cf', '800', 5, 3),
      row('cf', '1400', 2, 1),
      row('cf', 'ge3000', 1, 0)
    ])
    expect(r.cf.buckets.map((b) => b.key)).toEqual(['lt800', '800', '1000', '1200', '1400', 'ge3000'])
    expect(r.cf.buckets.map((b) => b.label)).toEqual([
      '<800',
      '800–999',
      '1000–1199',
      '1200–1399',
      '1400–1599',
      '3000+'
    ])
    expect(r.cf.buckets.find((b) => b.key === '1000')?.attempted).toBe(0)
    expect(r.cf.attempted).toBe(11)
    expect(r.cf.ac).toBe(7)
  })

  it('CF：未标难度（rating 为空）单独成档并排在最后', () => {
    const r = buildDifficultyStats([row('cf', '800', 1, 0), row('cf', 'na', 2, 1)])
    expect(r.cf.buckets.at(-1)).toMatchObject({ key: 'na', label: '未标难度', attempted: 2, ac: 1 })
  })

  it('AC 率与占比按题源计算（保留 1 位小数）', () => {
    const r = buildDifficultyStats([
      row('luogu', 'd1', 3, 3),
      row('luogu', 'd3', 1, 0)
    ])
    const d1 = r.luogu.buckets.find((b) => b.key === 'd1')!
    const d3 = r.luogu.buckets.find((b) => b.key === 'd3')!
    expect(d1.acRate).toBe(100)
    expect(d1.share).toBe(75)
    expect(d3.acRate).toBe(0)
    expect(d3.share).toBe(25)
    expect(r.luogu.attempted).toBe(4)
    expect(r.luogu.ac).toBe(3)
  })

  it('洛谷难度带中文档位名，力扣带简单/中等/困难', () => {
    const r = buildDifficultyStats([
      row('luogu', 'd3', 1, 1),
      row('luogu', 'd5', 1, 1),
      row('leetcode', 'd2', 2, 1)
    ])
    expect(r.luogu.buckets.find((b) => b.key === 'd3')?.label).toBe('3 · 普及/提高-')
    expect(r.luogu.buckets.find((b) => b.key === 'd5')?.label).toBe('5 · 提高+/省选-')
    expect(r.leetcode.buckets.map((b) => b.label)).toEqual(['简单', '中等', '困难'])
  })

  it('只保留标准档 + 有数据档：洛谷 d0/d7 空档保留，CF 无固定全集时不虚构档位', () => {
    const r = buildDifficultyStats([row('cf', '1000', 1, 1), row('luogu', 'd7', 1, 0)])
    expect(r.cf.buckets.map((b) => b.key)).toEqual(['1000'])
    expect(r.luogu.buckets).toHaveLength(8)
    expect(r.luogu.attempted).toBe(1)
  })
})
