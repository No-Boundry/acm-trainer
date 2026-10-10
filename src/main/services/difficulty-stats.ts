import {
  LEETCODE_DIFFICULTY_LABELS,
  LUOGU_DIFFICULTY_LABELS,
  type DifficultyBucket,
  type DifficultySourceStats,
  type DifficultyStatsResult,
  type ProblemSource
} from '@shared/types'

/**
 * 难度分布统计（v1.9 FR-22）：把「按题目难度标签聚合的练习情况」从 SQL 行整理成
 * 前端可直接渲染的分档结果（补齐空档、排序、算 AC 率与占比）。
 *
 * 桶标识约定（由 records 仓库的 SQL 生成）：
 * - cf：'lt800' | '800' | '1000' … '2800'（200 一档，键为档位下限）| 'ge3000' | 'na'
 * - luogu / leetcode：'d0'…'d7' / 'd1'…'d3' | 'na'（na = 难度未标）
 */

export interface DifficultyRawRow {
  source: ProblemSource
  bucket: string
  attempted: number
  ac: number
}

/** CF 常规分段（200 一档）：键 = 档位下限，展示为 '800–999' */
const CF_BAND_STEP = 200
const CF_BAND_MIN = 800
const CF_BAND_MAX = 3000 // >=3000 归入 'ge3000'

function cfBandKey(lower: number): string {
  return String(lower)
}

function cfBandLabel(lower: number): string {
  return `${lower}–${lower + CF_BAND_STEP - 1}`
}

function bucketLabel(source: ProblemSource, key: string): string {
  if (key === 'na') return '未标难度'
  if (source === 'cf') {
    if (key === 'lt800') return '<800'
    if (key === 'ge3000') return '3000+'
    const n = Number(key)
    return Number.isFinite(n) ? cfBandLabel(n) : key
  }
  const n = Number(key.replace(/^d/, ''))
  if (!Number.isFinite(n)) return key
  if (source === 'luogu') return `${n} · ${LUOGU_DIFFICULTY_LABELS[n] ?? '未知'}`
  return LEETCODE_DIFFICULTY_LABELS[n] ?? '未知'
}

/** 桶排序权重（越小越靠前） */
function bucketOrder(source: ProblemSource, key: string): number {
  if (key === 'na') return 1e6
  if (source === 'cf') {
    if (key === 'lt800') return -1
    if (key === 'ge3000') return 1e5
    return Number(key)
  }
  return Number(key.replace(/^d/, ''))
}

/** 该题源需要零填充的标准档位（没有数据也展示，便于看分布） */
function canonicalKeys(source: ProblemSource): string[] {
  if (source === 'leetcode') return ['d1', 'd2', 'd3']
  if (source === 'luogu') return ['d0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7']
  return []
}

/**
 * 组装单题源的难度分布。
 * CF 无固定档位全集（800–3000 共 12 档），因此只补齐「已有数据的最小档 ~ 最大档」之间的空档，
 * 避免图表被十几根空柱占满。
 */
function buildSourceStats(
  source: ProblemSource,
  rows: DifficultyRawRow[]
): DifficultySourceStats {
  const present = new Map<string, { attempted: number; ac: number }>()
  for (const r of rows) {
    if (r.source !== source) continue
    const cur = present.get(r.bucket) ?? { attempted: 0, ac: 0 }
    cur.attempted += r.attempted
    cur.ac += r.ac
    present.set(r.bucket, cur)
  }

  const keys = new Set<string>(present.keys())
  for (const k of canonicalKeys(source)) keys.add(k)
  if (source === 'cf') {
    const numeric = [...present.keys()]
      .map((k) => Number(k))
      .filter((n) => Number.isFinite(n) && n >= CF_BAND_MIN && n < CF_BAND_MAX)
    if (numeric.length > 0) {
      const min = Math.min(...numeric)
      const max = Math.max(...numeric)
      for (let k = min; k <= max; k += CF_BAND_STEP) keys.add(cfBandKey(k))
    }
  }

  const attempted = [...present.values()].reduce((s, v) => s + v.attempted, 0)
  const ac = [...present.values()].reduce((s, v) => s + v.ac, 0)

  const buckets: DifficultyBucket[] = [...keys]
    .sort((a, b) => bucketOrder(source, a) - bucketOrder(source, b))
    .map((key) => {
      const v = present.get(key) ?? { attempted: 0, ac: 0 }
      return {
        key,
        label: bucketLabel(source, key),
        attempted: v.attempted,
        ac: v.ac,
        acRate: v.attempted > 0 ? Number(((v.ac / v.attempted) * 100).toFixed(1)) : null,
        share: attempted > 0 ? Number(((v.attempted / attempted) * 100).toFixed(1)) : 0
      }
    })

  return { source, attempted, ac, buckets }
}

/** SQL 行 → 三题源难度分布（纯函数，便于单测） */
export function buildDifficultyStats(rows: DifficultyRawRow[]): DifficultyStatsResult {
  return {
    cf: buildSourceStats('cf', rows),
    luogu: buildSourceStats('luogu', rows),
    leetcode: buildSourceStats('leetcode', rows)
  }
}
