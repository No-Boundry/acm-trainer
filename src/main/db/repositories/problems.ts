import type { Database } from 'better-sqlite3'
import type {
  ProblemFilter,
  ProblemListResult,
  ProblemRow,
  ProblemSource,
  ProblemUpsertInput
} from '@shared/types'

interface ProblemRowRaw {
  id: string
  contestId: number
  index: string
  name: string
  rating: number | null
  difficulty: number | null
  solvedCount: number
  totalSubmit: number
  source: ProblemSource
  cfUrl: string
  fetchedAt: string
  tagsCsv: string | null
  practiced: number
  lastStatus: string | null
}

function mapRow(r: ProblemRowRaw): ProblemRow {
  return {
    id: r.id,
    contestId: r.contestId,
    index: r.index,
    name: r.name,
    rating: r.rating,
    difficulty: r.difficulty,
    solvedCount: r.solvedCount,
    totalSubmit: r.totalSubmit,
    source: r.source,
    cfUrl: r.cfUrl,
    fetchedAt: r.fetchedAt,
    tags: r.tagsCsv ? r.tagsCsv.split(',') : [],
    practiced: r.practiced === 1,
    lastStatus: (r.lastStatus ?? null) as ProblemRow['lastStatus']
  }
}

/** 题目行查询（供题库列表与题单/计划详情复用；导出给 repositories/lists|plans） */
export const ROW_SELECT = `
  SELECT p.id, p.contest_id AS contestId, p."index", p.name, p.rating, p.difficulty,
         p.solved_count AS solvedCount, p.total_submit AS totalSubmit, p.source,
         p.cf_url AS cfUrl, p.fetched_at AS fetchedAt,
         (SELECT GROUP_CONCAT(t.name, ',') FROM problem_tags pt
            JOIN tags t ON t.id = pt.tag_id WHERE pt.problem_id = p.id) AS tagsCsv,
         EXISTS(SELECT 1 FROM practice_records r WHERE r.problem_id = p.id) AS practiced,
         (SELECT r2.status FROM practice_records r2
            WHERE r2.problem_id = p.id ORDER BY r2.created_at DESC, r2.id DESC LIMIT 1) AS lastStatus
  FROM problems p
`

/** 生成题目 id 与来源题面 URL（v1.1 双源：cf / luogu；v1.9 FR-21：增加 leetcode） */
export function problemIdentity(
  p: ProblemUpsertInput
): { id: string; url: string; source: ProblemSource } {
  const source = p.source ?? 'cf'
  if (source === 'luogu') {
    // luogu：id = pid（如 P1000），index 也存 pid（满足 NOT NULL 约束）
    return {
      id: p.index,
      url: `https://www.luogu.com.cn/problem/${p.index}`,
      source
    }
  }
  if (source === 'leetcode') {
    // leetcode：index = titleSlug（唯一，满足 UNIQUE(contest_id,index)），
    // id = 'LC' + 题号（如 LC1 / LCLCR001 / LC面试题01.01），题号缺失时退回 slug
    const num = (p.frontendId ?? p.index).replace(/\s+/g, '')
    return {
      id: `LC${num}`,
      url: `https://leetcode.cn/problems/${p.index}/`,
      source
    }
  }
  return {
    id: `${p.contestId}:${p.index}`,
    url: `https://codeforces.com/problemset/problem/${p.contestId}/${p.index}`,
    source
  }
}

/**
 * 排序表达式（v1.9.1 修复：按难度 / 按题号在多题源下排序异常）。
 *
 * 关键点：
 * 1. 「难度」在不同题源里不是同一列：CF 用 rating（800–3500），洛谷用 difficulty（0–7），
 *    力扣用 difficulty（1–3）。原先统一用 `p.rating`，导致洛谷/力扣视图里所有行 rating 均为
 *    NULL，排序完全失效（看起来"没反应"）。
 * 2. 「题号」也要按题源解释：洛谷 P10000 必须排在 P1001 之后（按数字，而非字符串）。
 * 3. 全部视图下三源量纲不同，无法横向比较 → 先按题源分组（CF → 洛谷 → 力扣），组内再按该源口径排序。
 * 4. 空难度/空 rating 一律排在最后，且 **不随升/降序翻转**（此前 DESC 时空值会跑到最前）。
 */
const SOURCE_GROUP_EXPR = "CASE p.source WHEN 'cf' THEN 0 WHEN 'luogu' THEN 1 ELSE 2 END"

/** 单源「难度」排序：空值标记（恒 ASC）+ 取值 */
const DIFFICULTY_EXPR: Record<ProblemSource, [string, string]> = {
  cf: ['p.rating IS NULL', 'p.rating'],
  luogu: ['p.difficulty IS NULL', 'p.difficulty'],
  leetcode: ['p.difficulty IS NULL', 'p.difficulty']
}

/** 单源「题号」排序键（每项一个完整表达式，避免按逗号切分破坏 CAST(...) 这类表达式） */
const ID_EXPR: Record<ProblemSource, string[]> = {
  cf: ['p.contest_id', 'p."index"'],
  luogu: ['CAST(substr(p.id, 2) AS INTEGER)'],
  leetcode: ["CASE WHEN p.id GLOB 'LC[0-9]*' THEN 0 ELSE 1 END", 'CAST(substr(p.id, 3) AS INTEGER)']
}

/** 全部视图：按 source 取对应的难度/题号键 */
const ALL_DIFFICULTY_NULL = `CASE p.source WHEN 'cf' THEN p.rating IS NULL WHEN 'luogu' THEN p.difficulty IS NULL ELSE p.difficulty IS NULL END`
const ALL_DIFFICULTY_VALUE = `CASE p.source WHEN 'cf' THEN p.rating ELSE p.difficulty END`
const ALL_ID_GROUP = `CASE p.source WHEN 'cf' THEN p.contest_id WHEN 'luogu' THEN CAST(substr(p.id, 2) AS INTEGER) ELSE CASE WHEN p.id GLOB 'LC[0-9]*' THEN 0 ELSE 1 END END`
const ALL_ID_VALUE = `CASE p.source WHEN 'cf' THEN p."index" WHEN 'luogu' THEN p.id ELSE CAST(substr(p.id, 3) AS INTEGER) END`

/**
 * 生成完整 ORDER BY 子句（含方向）。空值标记恒为 ASC（排最后），
 * 其余键使用 filter.sortDir。
 */
export function buildOrderSql(filter: ProblemFilter): string {
  const dir = filter.sortDir === 'asc' ? 'ASC' : 'DESC'
  const source = filter.source
  const sortBy = filter.sortBy ?? 'rating'
  const parts: string[] = []

  if (sortBy === 'solvedCount') {
    // AC 数：无空值概念，直接按数值
    return `p.solved_count ${dir}, p.id ${dir}`
  }

  if (sortBy === 'rating') {
    if (source === 'cf' || source === 'luogu' || source === 'leetcode') {
      const [nullFlag, value] = DIFFICULTY_EXPR[source]
      return `${nullFlag} ASC, ${value} ${dir}, p.id ${dir}`
    }
    return `${SOURCE_GROUP_EXPR} ASC, ${ALL_DIFFICULTY_NULL} ASC, ${ALL_DIFFICULTY_VALUE} ${dir}, p.id ${dir}`
  }

  // sortBy === 'id'（按题号）
  if (source === 'cf' || source === 'luogu' || source === 'leetcode') {
    return [...ID_EXPR[source].map((expr) => `${expr} ${dir}`), `p.id ${dir}`].join(', ')
  }
  parts.push(`${SOURCE_GROUP_EXPR} ASC`, `${ALL_ID_GROUP} ${dir}`, `${ALL_ID_VALUE} ${dir}`, `p.id ${dir}`)
  return parts.join(', ')
}

export class ProblemsRepo {
  constructor(private db: Database) {}

  /**
   * 批量 upsert 题目（含标签），事务内执行（cf/luogu 双源，v1.1 FR-8）。
   * @returns {added, updated}
   */
  upsertMany(inputs: ProblemUpsertInput[], fetchedAt: string): { added: number; updated: number } {
    const upsert = this.db.prepare(`
      INSERT INTO problems (id, contest_id, "index", name, rating, difficulty,
                            solved_count, total_submit, source, cf_url, fetched_at)
      VALUES (@id, @contestId, @index, @name, @rating, @difficulty,
              @solvedCount, @totalSubmit, @source, @cfUrl, @fetchedAt)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        rating = excluded.rating,
        difficulty = excluded.difficulty,
        solved_count = excluded.solved_count,
        total_submit = excluded.total_submit,
        source = excluded.source,
        cf_url = excluded.cf_url,
        fetched_at = excluded.fetched_at
    `)
    const hasProblem = this.db.prepare('SELECT 1 AS x FROM problems WHERE id = ?')
    const insertTag = this.db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)')
    const getTag = this.db.prepare('SELECT id FROM tags WHERE name = ?')
    const clearTags = this.db.prepare('DELETE FROM problem_tags WHERE problem_id = ?')
    const addTag = this.db.prepare(
      'INSERT OR IGNORE INTO problem_tags (problem_id, tag_id) VALUES (?, ?)'
    )

    const run = this.db.transaction((list: ProblemUpsertInput[]) => {
      let added = 0
      let updated = 0
      for (const p of list) {
        const { id, url, source } = problemIdentity(p)
        const exists = hasProblem.get(id) !== undefined
        const nonCf = source === 'luogu' || source === 'leetcode'
        upsert.run({
          id,
          contestId: nonCf ? 0 : p.contestId,
          index: p.index,
          name: p.name,
          rating: nonCf ? null : p.rating,
          difficulty: nonCf ? (p.difficulty ?? null) : null,
          solvedCount: p.solvedCount,
          totalSubmit: p.totalSubmit ?? 0,
          source,
          cfUrl: url,
          fetchedAt
        })
        if (exists) updated += 1
        else added += 1

        clearTags.run(id)
        for (const tagName of p.tags) {
          insertTag.run(tagName)
          const row = getTag.get(tagName) as { id: number } | undefined
          if (row) addTag.run(id, row.id)
        }
      }
      return { added, updated }
    })
    return run(inputs)
  }

  /** 组合筛选（数据源/洛谷难度/CF 难度/标签/状态/关键字）+ 分页 + 排序 */
  list(filter: ProblemFilter): ProblemListResult {
    const conditions: string[] = []
    const params: Record<string, unknown> = {}
    // 分页参数钳制（防御非法输入）
    const page = Math.max(1, Math.floor(filter.page ?? 1))
    const pageSize = Math.min(200, Math.max(1, Math.floor(filter.pageSize ?? 20)))

    // 数据源过滤（FR-8.2；v1.9 支持 leetcode）
    if (filter.source === 'cf' || filter.source === 'luogu' || filter.source === 'leetcode') {
      conditions.push('p.source = @source')
      params.source = filter.source
    }
    // 难度筛选（FR-8.4；v1.9 起同时适用于洛谷 0-7 与力扣 1-3，故限定这两个来源）
    if (filter.difficulty != null) {
      conditions.push("p.source IN ('luogu','leetcode')")
      conditions.push('p.difficulty = @difficulty')
      params.difficulty = filter.difficulty
    }
    if (filter.ratingMin != null) {
      conditions.push('p.rating >= @ratingMin')
      params.ratingMin = filter.ratingMin
    }
    if (filter.ratingMax != null) {
      conditions.push('p.rating <= @ratingMax')
      params.ratingMax = filter.ratingMax
    }
    if (filter.keyword) {
      conditions.push('(p.id LIKE @kw OR p.name LIKE @kw)')
      params.kw = `%${filter.keyword}%`
    }
    if (filter.tags && filter.tags.length > 0) {
      const placeholders = filter.tags.map((_, i) => `@tag${i}`).join(', ')
      conditions.push(
        `p.id IN (
           SELECT pt.problem_id FROM problem_tags pt
           JOIN tags t ON t.id = pt.tag_id
           WHERE t.name IN (${placeholders})
           GROUP BY pt.problem_id
           HAVING COUNT(DISTINCT t.id) = ${filter.tags.length}
         )`
      )
      filter.tags.forEach((t, i) => {
        params[`tag${i}`] = t
      })
    }
    // v1.8：OR 语义标签过滤（知识点筛选并集）——命中任一标签即可
    if (filter.tagsAny && filter.tagsAny.length > 0) {
      const ph = filter.tagsAny.map((_, i) => `@anyTag${i}`).join(', ')
      conditions.push(
        `p.id IN (
           SELECT pt.problem_id FROM problem_tags pt
           JOIN tags t ON t.id = pt.tag_id
           WHERE t.name IN (${ph})
         )`
      )
      filter.tagsAny.forEach((tag, i) => {
        params[`anyTag${i}`] = tag
      })
    }
    if (filter.practiced === 'done') {
      conditions.push('EXISTS (SELECT 1 FROM practice_records r WHERE r.problem_id = p.id)')
    } else if (filter.practiced === 'undone') {
      conditions.push('NOT EXISTS (SELECT 1 FROM practice_records r WHERE r.problem_id = p.id)')
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    // v1.9.1：排序按题源分别取「难度」与「题号」列（见 buildOrderSql）
    const orderSql = buildOrderSql(filter)

    const total = (
      this.db.prepare(`SELECT COUNT(*) AS c FROM problems p ${where}`).get(params) as { c: number }
    ).c

    const rows = this.db
      .prepare(`${ROW_SELECT} ${where} ORDER BY ${orderSql} LIMIT @limit OFFSET @offset`)
      .all({
        ...params,
        limit: pageSize,
        offset: (page - 1) * pageSize
      }) as ProblemRowRaw[]

    return { total, items: rows.map(mapRow) }
  }

  getById(id: string): ProblemRow | null {
    const row = this.db.prepare(`${ROW_SELECT} WHERE p.id = ?`).get(id) as
      | ProblemRowRaw
      | undefined
    return row ? mapRow(row) : null
  }

  /** 按力扣 titleSlug（存在 index 列）反查题目（v1.10：粘贴链接识别用） */
  findBySlug(slug: string): ProblemRow | null {
    const row = this.db
      .prepare(`${ROW_SELECT} WHERE p.source = 'leetcode' AND p."index" = ?`)
      .get(slug) as ProblemRowRaw | undefined
    return row ? mapRow(row) : null
  }

  /** 按知识点标签并集取候选题 id（v1.10：题单/计划抽题用；难度区间由调用方用 list() 过滤） */
  idsForKnowledge(tagsAny: string[], source?: ProblemSource): string[] {
    if (tagsAny.length === 0) return []
    const ph = tagsAny.map(() => '?').join(', ')
    const params: unknown[] = [...tagsAny]
    let sql = `SELECT p.id FROM problems p WHERE p.id IN (
                 SELECT pt.problem_id FROM problem_tags pt
                 JOIN tags t ON t.id = pt.tag_id WHERE t.name IN (${ph})
               )`
    if (source) {
      sql += ' AND p.source = ?'
      params.push(source)
    }
    const rows = this.db.prepare(sql).all(...params) as { id: string }[]
    return rows.map((r) => r.id)
  }

  /** 按 id 批量查询（保持传入顺序），用于比赛题目加载 */
  byIds(ids: string[]): ProblemRow[] {
    if (ids.length === 0) return []
    const placeholders = ids.map(() => '?').join(', ')
    const rows = this.db.prepare(`${ROW_SELECT} WHERE p.id IN (${placeholders})`).all(...ids) as ProblemRowRaw[]
    const byId = new Map(rows.map((r) => [r.id, mapRow(r)]))
    return ids.map((id) => byId.get(id)).filter((x): x is ProblemRow => x !== undefined)
  }

  /** 全部标签（去重，按名称排序） */
  allTags(): string[] {
    const rows = this.db.prepare('SELECT name FROM tags ORDER BY name').all() as { name: string }[]
    return rows.map((r) => r.name)
  }

  count(source?: ProblemSource): number {
    if (source) {
      return (
        this.db.prepare('SELECT COUNT(*) AS c FROM problems WHERE source = ?').get(source) as {
          c: number
        }
      ).c
    }
    return (this.db.prepare('SELECT COUNT(*) AS c FROM problems').get() as { c: number }).c
  }

  /** 各数据源最近同步时间（FR-8.3；v1.9 增加 leetcode） */
  lastSync(): Record<ProblemSource, string | null> {
    const rows = this.db
      .prepare('SELECT source AS s, MAX(fetched_at) AS t FROM problems GROUP BY source')
      .all() as { s: ProblemSource; t: string | null }[]
    const out: Record<ProblemSource, string | null> = { cf: null, luogu: null, leetcode: null }
    for (const r of rows) {
      if (r.s === 'cf' || r.s === 'luogu' || r.s === 'leetcode') out[r.s] = r.t
    }
    return out
  }
}
