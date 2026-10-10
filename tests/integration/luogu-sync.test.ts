import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createServer, type Server } from 'http'
import type { AddressInfo } from 'net'
import { initDb, closeDb } from '../../src/main/db/index'
import { ProblemsRepo } from '../../src/main/db/repositories/problems'
import { syncLuoguProblemset, type LuoguListData } from '../../src/main/services/luogu'
import type { Database } from 'better-sqlite3'

/**
 * 洛谷同步编排端到端（B2/B7，无 Electron 网络栈依赖）：
 * 本地 HTTP 服务模拟洛谷列表/tags 接口，驱动真实 syncLuoguProblemset 全流程。
 */

const TAGS_JSON = JSON.stringify({
  tags: [
    { id: 3, name: '动态规划 DP', type: 2, parent: null },
    { id: 6, name: '图论', type: 2, parent: null },
    { id: 5, name: '数学', type: 2, parent: null }
  ]
})

/** 构造与洛谷页面相同结构的 HTML（内嵌 JSON script） */
function makePageHtml(count: number, perPage: number, result: LuoguListData['result']): string {
  const payload = { instance: 'main', template: 'problem.list', status: 200, locale: 'zh-CN', data: { problems: { perPage, count, result } } }
  return `<html><head></head><body><script>${JSON.stringify(payload)}</script></body></html>`
}

function makeProblem(pid: string, difficulty: number): LuoguListData['result'][number] {
  return {
    pid,
    type: 'P',
    name: `题目 ${pid}`,
    difficulty,
    tags: [3, 6],
    totalSubmit: 1000,
    totalAccepted: 500
  }
}

let db: Database.Database
let server: Server
let baseUrl: string
let pageHits: number[] = []

beforeEach(async () => {
  closeDb()
  db = initDb(':memory:')
  pageHits = []
  const problems: LuoguListData['result'] = []
  for (let i = 1; i <= 100; i++) {
    const n = String(1000 + i) // P1001..P1100
    problems.push(makeProblem(`P${n}`, i % 8))
  }
  server = createServer((req, res) => {
    const url = req.url ?? ''
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    if (url.includes('/_lfe/tags')) {
      res.end(TAGS_JSON)
      return
    }
    const m = url.match(/page=(\d+)/)
    const page = m ? Number(m[1]) : 1
    pageHits.push(page)
    if (page > 2) {
      // 越界页返回空 result（实际服务端行为近似）
      res.end(makePageHtml(100, 50, []))
      return
    }
    const start = (page - 1) * 50
    res.end(makePageHtml(100, 50, problems.slice(start, start + 50)))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterEach(() => {
  server.close()
  closeDb()
})

describe('syncLuoguProblemset 编排（分页/进度/写入/幂等）', () => {
  it('两页 100 题全量入库 + 进度事件 + 重复同步幂等', async () => {
    const repo = new ProblemsRepo(db)
    const progress: string[] = []

    const r1 = await syncLuoguProblemset(
      repo,
      (p) => progress.push(`${p.stage}:${p.percent}:${p.message}`),
      {
        fetchPage: async (page) => {
          const resp = await fetch(`${baseUrl}/problem/list?page=${page}&type=P`)
          const html = await resp.text()
          const { extractLuoguListJson } = await import('../../src/main/services/luogu')
          return extractLuoguListJson(html)
        },
        fetchTags: async () => {
          const resp = await fetch(`${baseUrl}/_lfe/tags/zh-CN`)
          const { parseLuoguTags } = await import('../../src/main/services/luogu')
          return parseLuoguTags(await resp.text())
        }
      },
      1 // 测试用极短限速
    )

    expect(r1.added).toBe(100)
    expect(r1.updated).toBe(0)
    expect(r1.totalPages).toBe(2)
    expect(repo.count('luogu')).toBe(100)
    expect(repo.lastSync().luogu).not.toBeNull()

    // 进度事件完整：fetching → writing 100%
    expect(progress[0]).toContain('fetching:0')
    expect(progress[progress.length - 1]).toBe('writing:100:洛谷同步完成')
    expect(progress.some((p) => p.includes('第 2/2 页'))).toBe(true)

    // 页访问顺序 1,2
    expect(pageHits).toEqual([1, 2])

    // 抽查数据（tag 中文名、难度、id）
    const p = repo.getById('P1001')
    expect(p?.source).toBe('luogu')
    expect(p?.tags).toContain('动态规划 DP')
    expect(p?.difficulty).not.toBeNull()

    // 幂等：重复同步 → updated
    const r2 = await syncLuoguProblemset(repo, () => undefined, {
      fetchPage: async (page) => {
        const resp = await fetch(`${baseUrl}/problem/list?page=${page}&type=P`)
        const { extractLuoguListJson } = await import('../../src/main/services/luogu')
        return extractLuoguListJson(await resp.text())
      },
      fetchTags: async () => {
        const resp = await fetch(`${baseUrl}/_lfe/tags/zh-CN`)
        const { parseLuoguTags } = await import('../../src/main/services/luogu')
        return parseLuoguTags(await resp.text())
      }
    }, 1)
    expect(r2.added).toBe(0)
    expect(r2.updated).toBe(100)
    expect(repo.count('luogu')).toBe(100)
  })

  it('首页拉取失败 → 抛出异常且不写入任何数据', async () => {
    const repo = new ProblemsRepo(db)
    await expect(
      syncLuoguProblemset(repo, () => undefined, {
        fetchPage: async () => {
          throw new Error('network down')
        },
        fetchTags: async () => new Map([[3, '动态规划 DP']])
      })
    ).rejects.toThrow()
    expect(repo.count()).toBe(0)
  })
})
