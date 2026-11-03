import Database from 'better-sqlite3'
import { SCHEMA_SQL } from './schema'
import { AppError } from './errors'
import { canonicalTag } from '@shared/tag-map'

let db: Database.Database | null = null

/**
 * 轻量迁移：为旧库补充新增列 / 调整约束（幂等）。
 * 新库在 SCHEMA_SQL 的 CREATE TABLE 中已是最新形态，此处仅对旧库生效。
 */
function migrate(instance: Database.Database): void {
  const cols = instance.pragma('table_info(problems)') as { name: string }[]
  const has = (n: string): boolean => cols.some((c) => c.name === n)
  if (!has('source')) {
    instance.exec(
      `ALTER TABLE problems ADD COLUMN source TEXT NOT NULL DEFAULT 'cf' CHECK (source IN ('cf','luogu'))`
    )
  }
  if (!has('difficulty')) {
    instance.exec('ALTER TABLE problems ADD COLUMN difficulty INTEGER')
  }
  if (!has('total_submit')) {
    instance.exec('ALTER TABLE problems ADD COLUMN total_submit INTEGER NOT NULL DEFAULT 0')
  }
  // v1.2 FR-8.9：练习记录导入标记列
  const recCols = instance.pragma('table_info(practice_records)') as { name: string }[]
  if (!recCols.some((c) => c.name === 'import_source')) {
    instance.exec('ALTER TABLE practice_records ADD COLUMN import_source TEXT')
  }
  rebuildProblemsIfSourceCheckStale(instance)
  migrateProblemTagsToCanonical(instance)
}

/**
 * v1.18 FR-38：把标签别名物化为 canonical（中文）写法。
 *
 * 幂等：合并后别名标签行被删除，重复执行不会有任何改动。
 * 事务内按 canonical 归并：确保 canonical 标签行存在 → 把别名的题目关联
 * 改挂到 canonical（`INSERT OR IGNORE` 天然去重，一题同时带 'greedy' 与
 * '贪心' 时不会重复插入）→ 删别名的关联与标签行。
 *
 * 不在查询期展开别名的原因：`COUNT(DISTINCT t.id)`（命中标签数排序）与
 * 标签使用统计会把同一概念的两个拼写算成两份，物化后这些口径天然正确。
 *
 * @returns 被合并掉的别名标签行数（0 表示本来就是干净的）
 */
export function migrateProblemTagsToCanonical(instance: Database.Database): number {
  const rows = instance.prepare('SELECT id, name FROM tags').all() as {
    id: number
    name: string
  }[]
  const stale = rows.filter((r) => canonicalTag(r.name) !== r.name)
  if (stale.length === 0) return 0

  const insertCanonical = instance.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)')
  const tagIdOf = instance.prepare('SELECT id FROM tags WHERE name = ?')
  const moveLinks = instance.prepare(
    `INSERT OR IGNORE INTO problem_tags (problem_id, tag_id)
     SELECT problem_id, ? FROM problem_tags WHERE tag_id = ?`
  )
  const dropLinks = instance.prepare('DELETE FROM problem_tags WHERE tag_id = ?')
  const dropTag = instance.prepare('DELETE FROM tags WHERE id = ?')

  instance.transaction(() => {
    for (const row of stale) {
      const canonical = canonicalTag(row.name)
      insertCanonical.run(canonical)
      const target = tagIdOf.get(canonical) as { id: number } | undefined
      if (!target || target.id === row.id) continue
      moveLinks.run(target.id, row.id)
      dropLinks.run(row.id)
      dropTag.run(row.id)
    }
  })()
  return stale.length
}

/**
 * v1.9 FR-21：problems.source 的 CHECK 约束原先只允许 ('cf','luogu')，
 * SQLite 不支持修改 CHECK，需要一次性重建表。重建在事务内进行，
 * 期间关闭外键约束（避免 DROP TABLE 触发子表 ON DELETE CASCADE 清空数据），
 * 完成后子表按表名 "problems" 继续引用，数据与索引保持不变。
 */
function rebuildProblemsIfSourceCheckStale(instance: Database.Database): void {
  const row = instance
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'problems'`)
    .get() as { sql: string | null } | undefined
  const sql = row?.sql ?? ''
  if (!sql || sql.includes("'leetcode'")) return

  const hadForeignKeys = instance.pragma('foreign_keys', { simple: true }) === 1
  instance.pragma('foreign_keys = OFF')
  try {
    instance.transaction(() => {
      instance.exec(`
        CREATE TABLE problems__v19 (
          id            TEXT PRIMARY KEY,
          contest_id    INTEGER NOT NULL,
          "index"       TEXT NOT NULL,
          name          TEXT NOT NULL,
          rating        INTEGER,
          difficulty    INTEGER,
          solved_count  INTEGER NOT NULL DEFAULT 0,
          total_submit  INTEGER NOT NULL DEFAULT 0,
          source        TEXT NOT NULL DEFAULT 'cf' CHECK (source IN ('cf','luogu','leetcode')),
          cf_url        TEXT NOT NULL,
          fetched_at    TEXT NOT NULL,
          UNIQUE (contest_id, "index")
        );
        INSERT INTO problems__v19 (id, contest_id, "index", name, rating, difficulty,
                                   solved_count, total_submit, source, cf_url, fetched_at)
          SELECT id, contest_id, "index", name, rating, difficulty,
                 solved_count, total_submit, source, cf_url, fetched_at FROM problems;
        DROP TABLE problems;
        ALTER TABLE problems__v19 RENAME TO problems;
      `)
    })()
  } finally {
    if (hadForeignKeys) instance.pragma('foreign_keys = ON')
  }
}

/**
 * 初始化（或复用）SQLite 连接并应用 schema + 迁移。
 * @param dbPath 数据库文件路径；测试可传 ':memory:'。生产由 main 传入 userData 路径。
 */
export function initDb(dbPath: string): Database.Database {
  if (db) return db
  const instance = new Database(dbPath)
  instance.pragma('journal_mode = WAL')
  instance.pragma('foreign_keys = ON')
  instance.exec(SCHEMA_SQL)
  migrate(instance)
  db = instance
  return instance
}

export function getDb(): Database.Database {
  if (!db) throw new AppError('DB_NOT_INITIALIZED', '数据库尚未初始化')
  return db
}

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}
