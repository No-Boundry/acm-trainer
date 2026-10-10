import { describe, it, expect, beforeEach } from 'vitest'
import { initDb, closeDb } from '../../src/main/db/index'
import { ProblemsRepo } from '../../src/main/db/repositories/problems'
import { RecordsRepo } from '../../src/main/db/repositories/records'
import { NotesRepo } from '../../src/main/db/repositories/notes'
import { TemplatesRepo } from '../../src/main/db/repositories/templates'
import { ContestsRepo } from '../../src/main/db/repositories/contests'
import { SettingsRepo } from '../../src/main/db/repositories/settings'
import { exportData, importData, EXPORT_VERSION } from '../../src/main/services/data'
import { AppError } from '../../src/main/db/errors'
import type { Database } from 'better-sqlite3'

const problems = [
  { contestId: 1741, index: 'A', name: 'T1', rating: 800, solvedCount: 100, tags: ['implementation'] },
  { contestId: 1741, index: 'B', name: 'T2', rating: 1200, solvedCount: 50, tags: ['math'] }
]

describe('数据导出/导入（FR-7.2/7.3）', () => {
  beforeEach(() => closeDb())

  function seedSource(): void {
    const db = initDb(':memory:')
    const prepo = new ProblemsRepo(db)
    prepo.upsertMany(problems, '2026-01-01 00:00:00')
    new RecordsRepo(db).create({ problemId: '1741:A', status: 'AC', durationSeconds: 300, isMistake: false })
    new RecordsRepo(db).create({ problemId: '1741:B', status: 'WA', isMistake: true })
    new NotesRepo(db).create({ title: 'T1 题解', content: '# ok', problemId: '1741:A', tags: ['模拟'] })
    new TemplatesRepo(db).create({ category: '图论', title: 'Dijkstra', code: 'void d(){}' })
    const c = new ContestsRepo(db).createContest({ name: '赛', durationMinutes: 60, problemIds: ['1741:A'] })
    new ContestsRepo(db).start(c.id)
    new ContestsRepo(db).submit(c.id, '1741:A', 'AC')
    new ContestsRepo(db).finish(c.id)
    new SettingsRepo(db).set('noteAutoSaveMs', '1500')
  }

  it('导出包含全部数据，导入后可完整恢复（往返一致）', () => {
    seedSource()
    const payload = exportData(initDb(':memory:') as Database)
    expect(payload.version).toBe(EXPORT_VERSION)
    expect((payload.problems as unknown[]).length).toBe(2)
    expect((payload['practice_records'] as unknown[]).length).toBe(2)
    expect((payload.notes as unknown[]).length).toBe(1)
    expect((payload.templates as unknown[]).length).toBe(1)
    expect((payload.contests as unknown[]).length).toBe(1)
    expect((payload['contest_submissions'] as unknown[]).length).toBe(1)
    expect((payload.settings as { key: string }[])).toEqual(
      expect.arrayContaining([{ key: 'noteAutoSaveMs', value: '1500' }])
    )

    // 全新库导入
    closeDb()
    const db2 = initDb(':memory:')
    const counts = importData(db2, payload)
    const byTable = new Map(counts.map((c) => [c.table, c.count]))
    expect(byTable.get('problems')).toBe(2)
    expect(byTable.get('practice_records')).toBe(2)
    expect(byTable.get('contest_submissions')).toBe(1)

    // 数据可读性抽查
    const prepo = new ProblemsRepo(db2)
    const p = prepo.getById('1741:A')
    expect(p?.name).toBe('T1')
    expect(p?.tags).toContain('implementation')
    const recs = new RecordsRepo(db2).list({ mistakeOnly: true })
    expect(recs.total).toBe(1)
    expect(new NotesRepo(db2).list({ keyword: '题解' }).length).toBe(1)
    expect(new TemplatesRepo(db2).getById(1)?.title).toBe('Dijkstra')
    expect(new SettingsRepo(db2).get('noteAutoSaveMs')).toBe('1500')
    const contests = new ContestsRepo(db2).list()
    expect(contests.length).toBe(1)
    expect(contests[0].solvedCount).toBe(1)
  })

  it('非法备份内容被拒绝', () => {
    initDb(':memory:')
    expect(() => importData(initDb(':memory:') as Database, { version: 999 })).toThrow(AppError)
    expect(() => importData(initDb(':memory:') as Database, null)).toThrow(AppError)
  })

  it('缺失表键的备份：拒绝导入且不清空现有数据（防静默清空）', () => {
    seedSource()
    const db = initDb(':memory:') as Database
    expect(() => importData(db, { version: 1 })).toThrow(/缺少数据表/)
    // 数据未被清空
    expect((db.prepare('SELECT COUNT(*) AS c FROM problems').get() as { c: number }).c).toBe(2)
    expect((db.prepare('SELECT COUNT(*) AS c FROM practice_records').get() as { c: number }).c).toBe(2)
  })

  it('含未知列的行被拒绝（防标识符注入/结构不匹配）', () => {
    seedSource()
    const payload = exportData(initDb(':memory:') as Database)
    ;(payload.problems as Record<string, unknown>[])[0].evilCol = 'x'
    expect(() => importData(initDb(':memory:') as Database, payload)).toThrow(/未知列/)
  })

  it('settings 为全量替换语义（与"覆盖全部数据"一致）', () => {
    seedSource() // 写入 noteAutoSaveMs=1500
    const payload = exportData(initDb(':memory:') as Database)
    payload.settings = [{ key: 'syncReminderEnabled', value: 'false' }]
    closeDb()
    initDb(':memory:')
    importData(initDb(':memory:') as Database, payload)
    const all = new SettingsRepo(initDb(':memory:') as Database).getAll()
    expect(all).toEqual({ syncReminderEnabled: 'false' })
  })

  it('tags 名称重复被拒绝（避免 UNIQUE 冲突整库回滚）', () => {
    seedSource()
    const payload = exportData(initDb(':memory:') as Database)
    const tags = payload.tags as Record<string, unknown>[]
    tags.push({ ...tags[0] })
    expect(() => importData(initDb(':memory:') as Database, payload)).toThrow(/标签名重复/)
  })
})
