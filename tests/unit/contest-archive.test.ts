import { describe, it, expect } from 'vitest'
import {
  ARCHIVE_KINDS,
  ARCHIVE_KIND_MAP,
  archiveListDescription,
  archiveListName,
  buildArchiveCatalog,
  filterArchiveProblems,
  parseArchiveName,
  type ArchiveProblemRef
} from '@shared/contest-archive'

/**
 * 往届比赛题单（v1.21.0 FR-43）：
 * 从本地洛谷题名解析「比赛 + 年份 + 地区（组别 / 赛区）」→ 聚合成目录 → 按年份 + 地区筛题，
 * 再生成题单（名称 / 描述由纯函数统一给出）。
 */

describe('parseArchiveName：从题名解析比赛 / 年份 / 地区', () => {
  it('蓝桥杯省赛 / 国赛题名（组别、场次、语言都保留在地区里）', () => {
    expect(parseArchiveName('[蓝桥杯 2024 省 A] 日期统计')).toEqual({
      kind: 'lanqiao',
      year: 2024,
      region: '省 A'
    })
    expect(parseArchiveName('[蓝桥杯 2025 国 Python A] 题目')).toEqual({
      kind: 'lanqiao',
      year: 2025,
      region: '国 Python A'
    })
    expect(parseArchiveName('[蓝桥杯 2025 省 AB/Python B 第二场] 题目')).toEqual({
      kind: 'lanqiao',
      year: 2025,
      region: '省 AB/Python B 第二场'
    })
  })

  it('CCPC 站赛题名', () => {
    expect(parseArchiveName('[CCPC 2024 哈尔滨站] 题目')).toEqual({
      kind: 'ccpc',
      year: 2024,
      region: '哈尔滨站'
    })
    expect(parseArchiveName('[CCPC 2024 Shandong I] 题目')).toEqual({
      kind: 'ccpc',
      year: 2024,
      region: 'Shandong I'
    })
  })

  it('非往届比赛题名返回 null', () => {
    expect(parseArchiveName('CF 1741A')).toBeNull()
    expect(parseArchiveName('[ABC 300 A] 题目')).toBeNull()
    expect(parseArchiveName('[蓝桥杯] 缺年份')).toBeNull()
    expect(parseArchiveName('[蓝桥杯 1800 省 A] 年份越界')).toBeNull()
    expect(parseArchiveName('')).toBeNull()
  })
})

const problems: ArchiveProblemRef[] = [
  { id: 'lq-2024-a1', name: '[蓝桥杯 2024 省 A] 题目1' },
  { id: 'lq-2024-b1', name: '[蓝桥杯 2024 省 B] 题目2' },
  { id: 'lq-2024-a2', name: '[蓝桥杯 2024 省 A] 题目3' },
  { id: 'lq-2023-a1', name: '[蓝桥杯 2023 省 A] 题目4' },
  { id: 'lq-2025-s1', name: '[蓝桥杯 2025 省 A] 题目5' },
  { id: 'lq-2025-g1', name: '[蓝桥杯 2025 国 A] 题目6' },
  { id: 'cc-2025-h1', name: '[CCPC 2025 哈尔滨站] 题目7' },
  { id: 'cc-2024-c1', name: '[CCPC 2024 重庆站] 题目8' },
  { id: 'cf-1', name: 'CF 1741A' }
]

describe('buildArchiveCatalog：比赛 → 年份 → 地区目录', () => {
  it('两种比赛都返回，年份倒序、地区题数聚合、蓝桥杯「省」在「国」之前', () => {
    const catalog = buildArchiveCatalog(problems)
    expect(catalog.map((c) => c.kind)).toEqual(['lanqiao', 'ccpc'])

    const lq = catalog[0]
    expect(lq.label).toBe('蓝桥杯')
    expect(lq.total).toBe(6)
    expect(lq.years.map((y) => y.year)).toEqual([2025, 2024, 2023])
    expect(lq.years[0].count).toBe(2)
    expect(lq.years[0].regions).toEqual([
      { region: '省 A', count: 1 },
      { region: '国 A', count: 1 }
    ])
    expect(lq.years[1].count).toBe(3)
    expect(lq.years[1].regions).toEqual([
      { region: '省 A', count: 2 },
      { region: '省 B', count: 1 }
    ])
    expect(lq.years[2].regions).toEqual([{ region: '省 A', count: 1 }])

    const ccpc = catalog[1]
    expect(ccpc.label).toBe('CCPC')
    expect(ccpc.total).toBe(2)
    expect(ccpc.years.map((y) => y.year)).toEqual([2025, 2024])
  })

  it('题库里没有往届比赛题时返回空目录（不抛错）', () => {
    const catalog = buildArchiveCatalog([{ id: 'x', name: 'CF 1741A' }])
    expect(catalog).toHaveLength(2)
    for (const c of catalog) {
      expect(c.total).toBe(0)
      expect(c.years).toEqual([])
    }
  })
})

describe('filterArchiveProblems：按比赛 + 年份 + 地区筛题', () => {
  it('地区为空表示该届全部题目，顺序保持不变', () => {
    expect(filterArchiveProblems(problems, { kind: 'lanqiao', year: 2024, region: null })).toEqual([
      'lq-2024-a1',
      'lq-2024-b1',
      'lq-2024-a2'
    ])
    expect(filterArchiveProblems(problems, { kind: 'lanqiao', year: 2024, region: '' })).toHaveLength(3)
  })

  it('指定地区只返回该组别题目；不同比赛不串题', () => {
    expect(filterArchiveProblems(problems, { kind: 'lanqiao', year: 2024, region: '省 A' })).toEqual([
      'lq-2024-a1',
      'lq-2024-a2'
    ])
    expect(filterArchiveProblems(problems, { kind: 'lanqiao', year: 2025, region: '国 A' })).toEqual(['lq-2025-g1'])
    expect(filterArchiveProblems(problems, { kind: 'ccpc', year: 2024, region: '重庆站' })).toEqual(['cc-2024-c1'])
    expect(filterArchiveProblems(problems, { kind: 'ccpc', year: 2025, region: '省 A' })).toEqual([])
  })
})

describe('题单名称 / 描述', () => {
  it('名称按「比赛 年份 · 地区」生成，未选地区时标注全部组别 / 赛区', () => {
    expect(archiveListName({ kind: 'lanqiao', year: 2024, region: '省 A' })).toBe('蓝桥杯 2024 · 省 A')
    expect(archiveListName({ kind: 'lanqiao', year: 2024, region: null })).toBe('蓝桥杯 2024（全部组别）')
    expect(archiveListName({ kind: 'ccpc', year: 2025 })).toBe('CCPC 2025（全部赛区）')
  })

  it('描述写明题数与数据来源', () => {
    const desc = archiveListDescription({ kind: 'lanqiao', year: 2024, region: '省 A' }, 2)
    expect(desc).toContain('往届比赛题单')
    expect(desc).toContain('蓝桥杯 2024 · 省 A')
    expect(desc).toContain('共 2 题')
    expect(desc).toContain('本地洛谷题库')
  })

  it('比赛元数据：蓝桥杯挂 lanqiao 赛道、CCPC 挂 icpc 赛道（用于题单自动关联赛道）', () => {
    expect(ARCHIVE_KINDS.map((k) => k.id)).toEqual(['lanqiao', 'ccpc'])
    expect(ARCHIVE_KIND_MAP.get('lanqiao')?.trackId).toBe('lanqiao')
    expect(ARCHIVE_KIND_MAP.get('ccpc')?.trackId).toBe('icpc')
  })
})
