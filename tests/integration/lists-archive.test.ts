import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDb, closeDb } from '../../src/main/db/index'
import { ProblemsRepo } from '../../src/main/db/repositories/problems'
import { ListsRepo } from '../../src/main/db/repositories/lists'
import {
  archiveListDescription,
  archiveListName,
  buildArchiveCatalog,
  filterArchiveProblems
} from '@shared/contest-archive'
import { coveredNodeIds } from '@shared/skill-tree'
import { canonicalTags } from '@shared/tag-map'
import type { ProblemUpsertInput } from '@shared/types'

/**
 * 往届比赛题单（v1.21.0 FR-43）集成：本地题库 → 目录 → 按年份 + 地区筛题 → 生成题单，
 * 以及 v1.21.0 FR-44「题单 → 知识点」的覆盖映射（学习路径「仅显示题单知识点」的数据基础）。
 */

let db: ReturnType<typeof initDb>
let problems: ProblemsRepo
let lists: ListsRepo

function seed(): void {
  const inputs: ProblemUpsertInput[] = [
    {
      contestId: 0,
      index: 'P1001',
      name: '[蓝桥杯 2024 省 A] 日期统计',
      solvedCount: 0,
      source: 'luogu',
      tags: ['模拟'],
      difficulty: 2
    },
    {
      contestId: 0,
      index: 'P1002',
      name: '[蓝桥杯 2024 省 A] 幸运数',
      solvedCount: 0,
      source: 'luogu',
      tags: ['贪心', 'greedy'],
      difficulty: 3
    },
    {
      contestId: 0,
      index: 'P1003',
      name: '[蓝桥杯 2024 省 B] 子串问题',
      solvedCount: 0,
      source: 'luogu',
      tags: ['动态规划'],
      difficulty: 4
    },
    {
      contestId: 0,
      index: 'P1004',
      name: '[蓝桥杯 2025 国 A] 质数判定',
      solvedCount: 0,
      source: 'luogu',
      tags: ['数学', '质数'],
      difficulty: 5
    },
    {
      contestId: 0,
      index: 'P1005',
      name: '[CCPC 2024 哈尔滨站] 图论签到',
      solvedCount: 0,
      source: 'luogu',
      tags: ['图论'],
      difficulty: 4
    },
    {
      contestId: 0,
      index: 'P1006',
      name: '[CCPC 2024 哈尔滨站] 树上问题',
      solvedCount: 0,
      source: 'luogu',
      tags: ['树'],
      difficulty: 5
    },
    {
      contestId: 1741,
      index: 'A',
      name: 'CF 1741A',
      rating: 800,
      solvedCount: 0,
      tags: ['贪心']
    }
  ]
  problems.upsertMany(inputs, '2026-10-04 10:00:00')
}

beforeEach(() => {
  closeDb()
  db = initDb(':memory:')
  problems = new ProblemsRepo(db)
  lists = new ListsRepo(db)
  seed()
})
afterEach(() => closeDb())

describe('archiveCandidates：只挑出往届比赛题（不新增数据源）', () => {
  it('按题名前缀识别蓝桥杯 / CCPC，普通 CF 题不参与', () => {
    const candidates = problems.archiveCandidates()
    const ids = candidates.map((c) => c.id)
    expect([...ids].sort()).toEqual(['P1001', 'P1002', 'P1003', 'P1004', 'P1005', 'P1006'])
    expect(candidates.find((c) => c.id === 'P1002')?.name).toBe('[蓝桥杯 2024 省 A] 幸运数')
    expect(ids).not.toContain('1741:A')
  })
})

describe('往届比赛题单：目录 → 筛题 → 生成题单', () => {
  it('目录按年份倒序、地区聚合题数', () => {
    const catalog = buildArchiveCatalog(problems.archiveCandidates())
    const lq = catalog.find((c) => c.kind === 'lanqiao')!
    expect(lq.total).toBe(4)
    expect(lq.years.map((y) => y.year)).toEqual([2025, 2024])
    expect(lq.years[1].regions).toEqual([
      { region: '省 A', count: 2 },
      { region: '省 B', count: 1 }
    ])
    const ccpc = catalog.find((c) => c.kind === 'ccpc')!
    expect(ccpc.total).toBe(2)
    expect(ccpc.years).toEqual([{ year: 2024, count: 2, regions: [{ region: '哈尔滨站', count: 2 }] }])
  })

  it('选「蓝桥杯 2024 · 全部组别」生成 3 题题单，origin=archive、自动挂 lanqiao 赛道', () => {
    const sel = { kind: 'lanqiao' as const, year: 2024, region: null }
    const ids = filterArchiveProblems(problems.archiveCandidates(), sel)
    expect([...ids].sort()).toEqual(['P1001', 'P1002', 'P1003'])

    const list = lists.create({
      name: archiveListName(sel),
      description: archiveListDescription(sel, ids.length),
      origin: 'archive',
      trackId: 'lanqiao'
    })
    expect(lists.addProblems(list.id, ids)).toBe(3)

    const detail = lists.detail(list.id, problems)
    expect(detail.list.name).toBe('蓝桥杯 2024（全部组别）')
    expect(detail.list.origin).toBe('archive')
    expect(detail.list.trackId).toBe('lanqiao')
    expect(detail.list.total).toBe(3)
    expect(
      [...detail.items.map((it) => it.problem?.name ?? '')].sort()
    ).toEqual([
      '[蓝桥杯 2024 省 A] 日期统计',
      '[蓝桥杯 2024 省 A] 幸运数',
      '[蓝桥杯 2024 省 B] 子串问题'
    ].sort())
  })

  it('选「省 A」只生成该组别题目；换比赛不串题', () => {
    const region = { kind: 'lanqiao' as const, year: 2024, region: '省 A' }
    expect([...filterArchiveProblems(problems.archiveCandidates(), region)].sort()).toEqual(['P1001', 'P1002'])
    // 名称里带地区
    expect(archiveListName(region)).toBe('蓝桥杯 2024 · 省 A')

    const ccpc = { kind: 'ccpc' as const, year: 2024, region: null }
    expect([...filterArchiveProblems(problems.archiveCandidates(), ccpc)].sort()).toEqual(['P1005', 'P1006'])
    // 该年份下不存在的地区 → 空
    expect(filterArchiveProblems(problems.archiveCandidates(), { ...ccpc, region: '省 A' })).toEqual([])
  })

  it('生成题单后能算出它覆盖的知识点（FR-44）', () => {
    const sel = { kind: 'lanqiao' as const, year: 2024, region: null }
    const ids = filterArchiveProblems(problems.archiveCandidates(), sel)
    const list = lists.create({ name: archiveListName(sel), origin: 'archive' })
    lists.addProblems(list.id, ids)

    const detail = lists.detail(list.id, problems)
    const rawTags = detail.items.flatMap((it) => it.problem?.tags ?? [])
    const tags = canonicalTags([...rawTags])
    const nodeIds = coveredNodeIds(tags)
    expect(nodeIds).toContain('greedy') // 贪心 / greedy 归一后命中
    expect(nodeIds).toContain('dp') // 「动态规划」命中
    expect(detail.items.length).toBe(3)
  })
})
