/**
 * 往届比赛题单（v1.21.0 FR-43）。
 *
 * 蓝桥杯 / CCPC 的往届比赛题在洛谷题库中的题名形如：
 * - `[蓝桥杯 2024 省 A] 题目名`
 * - `[CCPC 2024 哈尔滨站] 题目名`
 *
 * 因此不需要新增数据源：直接从本地题库题名解析出「比赛 / 年份 / 地区（组别或赛区）」，
 * 按年份 + 地区联动生成题单。本文件只放纯函数，主进程与单测共用。
 */

/** 支持的往届比赛类型 */
export type ArchiveKind = 'lanqiao' | 'ccpc'

export interface ArchiveKindMeta {
  id: ArchiveKind
  label: string
  /** 生成题单时自动关联的赛道 id（见 shared/skill-tracks.ts） */
  trackId: string
  /** 题名中「年份之后那一段」的展示口径（蓝桥杯是组别/场次，CCPC 是赛区/站） */
  regionLabel: string
  /** 未选具体地区时的说明文字 */
  allRegionLabel: string
}

export const ARCHIVE_KINDS: readonly ArchiveKindMeta[] = [
  {
    id: 'lanqiao',
    label: '蓝桥杯',
    trackId: 'lanqiao',
    regionLabel: '组别 / 场次',
    allRegionLabel: '全部组别'
  },
  {
    id: 'ccpc',
    label: 'CCPC',
    trackId: 'icpc',
    regionLabel: '赛区 / 站',
    allRegionLabel: '全部赛区'
  }
]

export const ARCHIVE_KIND_MAP: ReadonlyMap<ArchiveKind, ArchiveKindMeta> = new Map(
  ARCHIVE_KINDS.map((k) => [k.id, k])
)

/** 题名前缀里带年份/地区的最小候选行（只依赖 id 与 name，便于单测） */
export interface ArchiveProblemRef {
  id: string
  name: string
}

export interface ParsedArchiveName {
  kind: ArchiveKind
  year: number
  /** 地区（蓝桥杯：组别/场次，如「省 A」「国 Python A」；CCPC：赛区/站，如「哈尔滨站」） */
  region: string
}

const ARCHIVE_NAME_RE = /^\[(蓝桥杯|CCPC)\s+(\d{4})\s+([^\]]+?)\s*\]/

const KIND_BY_LABEL: Readonly<Record<string, ArchiveKind>> = { 蓝桥杯: 'lanqiao', CCPC: 'ccpc' }

/**
 * 解析题名中的往届比赛信息；不是往届比赛题时返回 null。
 * 例：`[蓝桥杯 2024 省 A] 幸运数` → { kind:'lanqiao', year:2024, region:'省 A' }
 */
export function parseArchiveName(name: string): ParsedArchiveName | null {
  const m = ARCHIVE_NAME_RE.exec(name ?? '')
  if (!m) return null
  const kind = KIND_BY_LABEL[m[1]]
  if (!kind) return null
  const year = Number(m[2])
  if (!Number.isInteger(year) || year < 1990 || year > 2100) return null
  const region = m[3].trim()
  if (!region) return null
  return { kind, year, region }
}

/** 地区排序：蓝桥杯「省」在「国」之前，其余按中文排序 */
function compareRegion(a: string, b: string): number {
  const rank = (r: string): number => (r.startsWith('省') ? 0 : r.startsWith('国') ? 1 : 2)
  return rank(a) - rank(b) || a.localeCompare(b, 'zh-Hans-CN')
}

export interface ArchiveRegionOption {
  region: string
  count: number
}

export interface ArchiveYearOption {
  year: number
  count: number
  regions: ArchiveRegionOption[]
}

export interface ArchiveKindCatalog {
  kind: ArchiveKind
  label: string
  total: number
  /** 年份倒序（最近一届在前） */
  years: ArchiveYearOption[]
}

/**
 * 从本地题库题名构建「比赛 → 年份 → 地区」目录（按年份、地区聚合题数）。
 * 只统计能解析出往届比赛信息的题；返回两种比赛的完整目录（没有数据时 years 为空）。
 */
export function buildArchiveCatalog(problems: readonly ArchiveProblemRef[]): ArchiveKindCatalog[] {
  const acc = new Map<ArchiveKind, Map<number, Map<string, number>>>()
  for (const meta of ARCHIVE_KINDS) acc.set(meta.id, new Map())

  for (const p of problems) {
    const parsed = parseArchiveName(p.name)
    if (!parsed) continue
    const years = acc.get(parsed.kind)
    if (!years) continue
    let regions = years.get(parsed.year)
    if (!regions) {
      regions = new Map()
      years.set(parsed.year, regions)
    }
    regions.set(parsed.region, (regions.get(parsed.region) ?? 0) + 1)
  }

  return ARCHIVE_KINDS.map((meta) => {
    const years = acc.get(meta.id) ?? new Map<number, Map<string, number>>()
    const yearOptions: ArchiveYearOption[] = [...years.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([year, regions]) => ({
        year,
        count: [...regions.values()].reduce((s, n) => s + n, 0),
        regions: [...regions.entries()]
          .sort((a, b) => compareRegion(a[0], b[0]))
          .map(([region, count]) => ({ region, count }))
      }))
    return {
      kind: meta.id,
      label: meta.label,
      total: yearOptions.reduce((s, y) => s + y.count, 0),
      years: yearOptions
    }
  })
}

/** 题单选择：region 为 null / '' 表示「全部地区」 */
export interface ArchiveSelection {
  kind: ArchiveKind
  year: number
  region?: string | null
}

/** 生成往届比赛题单的请求（IPC lists:createArchive） */
export interface CreateArchiveListInput extends ArchiveSelection {
  /** 题单名称；留空自动用 archiveListName() */
  name?: string
}

/** 按选择筛选题 id（保持传入顺序）；用于生成题单与 IPC 校验 */
export function filterArchiveProblems(
  problems: readonly ArchiveProblemRef[],
  sel: ArchiveSelection
): string[] {
  const region = sel.region?.trim() || null
  const ids: string[] = []
  for (const p of problems) {
    const parsed = parseArchiveName(p.name)
    if (!parsed) continue
    if (parsed.kind !== sel.kind || parsed.year !== sel.year) continue
    if (region && parsed.region !== region) continue
    ids.push(p.id)
  }
  return ids
}

function allRegionLabel(kind: ArchiveKind, fallback = ''): string {
  return ARCHIVE_KIND_MAP.get(kind)?.allRegionLabel ?? (fallback || '全部地区')
}

/** 题单默认名称：`蓝桥杯 2024 · 省 A` / `CCPC 2024（全部赛区）` */
export function archiveListName(sel: ArchiveSelection): string {
  const meta = ARCHIVE_KIND_MAP.get(sel.kind)
  const label = meta?.label ?? sel.kind
  const region = sel.region?.trim() || null
  return region ? `${label} ${sel.year} · ${region}` : `${label} ${sel.year}（${allRegionLabel(sel.kind)}）`
}

/** 题单描述（生成时写入 problem_lists.description） */
export function archiveListDescription(sel: ArchiveSelection, count: number): string {
  const label = ARCHIVE_KIND_MAP.get(sel.kind)?.label ?? sel.kind
  const region = sel.region?.trim() || null
  const regionText = region ? region : allRegionLabel(sel.kind)
  return `往届比赛题单 · ${label} ${sel.year} · ${regionText} · 共 ${count} 题（本地洛谷题库）`
}
