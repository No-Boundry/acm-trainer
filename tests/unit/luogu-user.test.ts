import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import {
  parseLuoguUserPractice,
  importLuoguPractice,
  isLuoguChallengePage,
  scanPidsFromText,
  buildPracticeFromText,
  LUOGU_LOGIN_REQUIRED
} from '../../src/main/services/luogu-user'
import { initDb, closeDb } from '../../src/main/db/index'
import { ProblemsRepo } from '../../src/main/db/repositories/problems'
import { RecordsRepo } from '../../src/main/db/repositories/records'
import { AppError } from '../../src/main/db/errors'

const CONTENT_ONLY_JSON = JSON.stringify({
  currentData: {
    user: {
      uid: 12345,
      name: 'acm_student',
      passedProblemCount: 4,
      passedProblems: [
        { pid: 'P1000', type: 'P', difficulty: 1 },
        { pid: 'P1002', type: 'P' },
        { pid: 'P1002' }, // 重复
        { pid: 'ABC', type: 'P' }, // 非 P 前缀 → 忽略
        { pid: 'P1010', type: 'P' }
      ]
    }
  }
})

describe('scanPidsFromText（v1.2.1 文本直接识别 P 题号）', () => {
  it('纯题号列表', () => {
    expect(scanPidsFromText('P1000 P1002 P1010')).toEqual(['P1000', 'P1002', 'P1010'])
  })

  it('JSON / 网页源码中提取并去重保序', () => {
    const json = JSON.stringify({ problems: [{ pid: 'P1000' }, { pid: 'P1001' }, { pid: 'P1000' }] })
    expect(scanPidsFromText(json)).toEqual(['P1000', 'P1001'])
    const html =
      '<a href="https://www.luogu.com.cn/problem/P1003">P1003 过河卒</a> 通过 P1005 <a href="/problem/P1003">再看</a>'
    expect(scanPidsFromText(html)).toEqual(['P1003', 'P1005'])
  })

  it('渲染文字（无代码结构）也能识别', () => {
    const text = '通过题目：P1000（超级玛丽游戏）、P1002；正在做 P1004。'
    expect(scanPidsFromText(text)).toEqual(['P1000', 'P1002', 'P1004'])
  })

  it('忽略过短/嵌入字母数字的误匹配', () => {
    expect(scanPidsFromText('XP1000 P1 P123')).toEqual([])
    expect(scanPidsFromText('P1000A')).toEqual([]) // 后随字母
  })

  it('无题号文本 → buildPracticeFromText 抛 VALIDATION', () => {
    expect(scanPidsFromText('今天天气不错')).toEqual([])
    expect(() => buildPracticeFromText('没有任何题号')).toThrow(/P 题号/)
  })

  it('buildPracticeFromText 生成可导入输入（uid 未知）', () => {
    const p = buildPracticeFromText('P1000\nP1002\nP1000')
    expect(p.passedPids).toEqual(['P1000', 'P1002'])
    expect(p.uid).toBeUndefined()
  })
})

describe('parseLuoguUserPractice（FR-8.9 解析，三种形态）', () => {
  it('contentOnly 裸 JSON：提取 uid/AC 列表并去重过滤', () => {
    const r = parseLuoguUserPractice(CONTENT_ONLY_JSON)
    expect(r.uid).toBe(12345)
    expect(r.name).toBe('acm_student')
    expect(r.passedPids).toEqual(['P1000', 'P1002', 'P1010'])
    expect(r.passedProblemCount).toBe(4)
  })

  it('HTML 内嵌 JSON 形态（含 script 包装）', () => {
    const html = `<html><script>${JSON.stringify({
      currentData: { user: { uid: 999, name: 'x', passedProblemCount: 1, passedProblems: [{ pid: 'P2000' }] } }
    })}</script></html>`
    const r = parseLuoguUserPractice(html)
    expect(r.uid).toBe(999)
    expect(r.passedPids).toEqual(['P2000'])
  })

  it('粘贴整页 HTML：script 内 JSON 被 HTML 实体转义仍可解析', () => {
    const json = JSON.stringify({
      currentData: {
        user: { uid: 123, name: 'u', passedProblemCount: 2, passedProblems: [{ pid: 'P1001' }, { pid: 'P1003' }] }
      }
    })
    // 模拟页面把引号/斜杠实体化后的 script 内容
    const escaped = json.replace(/"/g, '&quot;').replace(/\//g, '\\/')
    const html = `<html><head><script>${escaped}</script></head><body>个人主页内容</body></html>`
    const r = parseLuoguUserPractice(html)
    expect(r.uid).toBe(123)
    expect(r.passedPids).toEqual(['P1001', 'P1003'])
  })

  it('粘贴整页 HTML：window._feIni = JSON.parse("...") 形态', () => {
    const json = JSON.stringify({
      currentData: {
        user: { uid: 321, name: 'v', passedProblemCount: 1, passedProblems: [{ pid: 'P1005' }] }
      }
    })
    const html = `<html><body><script>window._feIni = JSON.parse("${json.replace(/"/g, '\\"')}");</script></body></html>`
    const r = parseLuoguUserPractice(html)
    expect(r.uid).toBe(321)
    expect(r.passedPids).toEqual(['P1005'])
  })

  it('匿名/未公开（真实匿名用户页 fixture）→ LUOGU_LOGIN_REQUIRED', () => {
    const anon = readFileSync(new URL('../fixtures/luogu/user-uid1-anon.html', import.meta.url), 'utf8')
    expect(() => parseLuoguUserPractice(anon)).toThrow(AppError)
    try {
      parseLuoguUserPractice(anon)
    } catch (e) {
      expect((e as AppError).code).toBe(LUOGU_LOGIN_REQUIRED)
    }
  })

  it('无用户数据/非法输入 → 登录提示或解析错误', () => {
    expect(() => parseLuoguUserPractice('not json at all')).toThrow(AppError)
    expect(() => parseLuoguUserPractice(JSON.stringify({ foo: 1 }))).toThrow(/登录|数据/)
  })

  it('挑战页判定', () => {
    expect(isLuoguChallengePage('<title>Welcome - Luogu Spilopelia</title>')).toBe(true)
    expect(isLuoguChallengePage('{"currentData":{}}')).toBe(false)
  })
})

describe('importLuoguPractice（FR-8.9 导入编排/幂等）', () => {
  it('匹配→写入 AC 记录（带导入标记）；重复导入跳过', () => {
    closeDb()
    const db = initDb(':memory:')
    const prepo = new ProblemsRepo(db)
    prepo.upsertMany(
      [
        { contestId: 0, index: 'P1000', name: 'A', rating: null, difficulty: 1, solvedCount: 1, source: 'luogu', tags: [] },
        { contestId: 0, index: 'P1002', name: 'B', rating: null, difficulty: 2, solvedCount: 1, source: 'luogu', tags: [] }
      ],
      '2026-01-01 00:00:00'
    )
    const rrepo = new RecordsRepo(db)

    const r1 = importLuoguPractice(prepo, rrepo, {
      uid: 12345,
      name: 'acm_student',
      passedPids: ['P1000', 'P1002', 'P9999'],
      passedProblemCount: 3
    })
    expect(r1.matched).toBe(2)
    expect(r1.imported).toBe(2)
    expect(r1.skipped).toBe(0)
    expect(r1.unmatched).toBe(1) // P9999 不在本地题库

    // 记录内容与标记
    const rec = rrepo.list({ problemId: 'P1000' })
    expect(rec.total).toBe(1)
    expect(rec.items[0].status).toBe('AC')
    expect(rec.items[0].importSource).toBe('luogu-import')
    expect(rec.items[0].note).toContain('12345')

    // 幂等：再次导入全部跳过
    const r2 = importLuoguPractice(prepo, rrepo, {
      uid: 12345,
      name: 'acm_student',
      passedPids: ['P1000', 'P1002'],
      passedProblemCount: 2
    })
    expect(r2.imported).toBe(0)
    expect(r2.skipped).toBe(2)
    expect(repoCount(db, 'practice_records')).toBe(2)
    closeDb()
  })
})

function repoCount(db: import('better-sqlite3').Database, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c
}
