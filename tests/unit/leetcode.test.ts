import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDb, closeDb } from '../../src/main/db/index'
import { ProblemsRepo, problemIdentity } from '../../src/main/db/repositories/problems'
import {
  buildTagPageQuery,
  mapLeetcodeToUpsert,
  parseLeetcodeList,
  parseTagPage,
  syncLeetcodeProblemset,
  LEETCODE_PAGE_SIZE
} from '../../src/main/services/leetcode'
import { AppError } from '../../src/main/db/errors'
import type { Database } from 'better-sqlite3'
import type { SyncProgress } from '@shared/types'

/**
 * 力扣数据源（v1.9 FR-21）：解析 / 映射 / 同步编排（纯函数 + 可注入抓取器）。
 * 真实 HTTP 走 Electron net，见 src/main/ipc/leetcode.ts（GUI 侧另有人工验收）。
 */

const LIST_JSON = JSON.stringify({
  user_name: '',
  num_total: 2,
  stat_status_pairs: [
    {
      stat: {
        question_id: 1,
        question__title: '两数之和',
        question__title_slug: 'two-sum',
        frontend_question_id: '1',
        total_acs: 3000,
        total_submitted: 6000
      },
      difficulty: { level: 1 },
      paid_only: false
    },
    {
      stat: {
        question_id: 2,
        question__title: '会员难题',
        question__title_slug: 'paid-x',
        frontend_question_id: 'LCR 001',
        total_acs: 5,
        total_submitted: 50
      },
      difficulty: { level: 3 },
      paid_only: true
    }
  ]
})

const TAG_JSON = JSON.stringify({
  data: {
    problemsetQuestionList: {
      hasMore: false,
      total: 2,
      questions: [
        {
          titleSlug: 'two-sum',
          title: 'Two Sum',
          titleCn: '两数之和',
          topicTags: [
            { name: 'Array', nameTranslated: '数组' },
            { name: 'Hash Table', nameTranslated: '哈希表' },
            { name: 'Array', nameTranslated: '数组' }
          ]
        },
        { titleSlug: 'paid-x', title: 'Paid X', titleCn: '', topicTags: [{ name: 'Math', nameTranslated: '' }] }
      ]
    }
  }
})

describe('parseLeetcodeList（力扣全量列表）', () => {
  it('解析中文标题/题号/难度/AC 数/会员标记', () => {
    const list = parseLeetcodeList(LIST_JSON)
    expect(list).toHaveLength(2)
    expect(list[0]).toMatchObject({
      frontendId: '1',
      slug: 'two-sum',
      title: '两数之和',
      difficulty: 1,
      solvedCount: 3000,
      totalSubmit: 6000,
      paidOnly: false
    })
    expect(list[1]).toMatchObject({ frontendId: 'LCR 001', difficulty: 3, paidOnly: true })
  })

  it('难度层级异常 → null；缺 slug 的行被跳过', () => {
    const list = parseLeetcodeList(
      JSON.stringify({
        stat_status_pairs: [
          { stat: { question__title: 'X', question__title_slug: 'x', frontend_question_id: '9' }, difficulty: { level: 7 } },
          { stat: { question__title: '无 slug' }, difficulty: { level: 1 } }
        ]
      })
    )
    expect(list).toHaveLength(1)
    expect(list[0].difficulty).toBeNull()
  })

  it('非 JSON / 缺 stat_status_pairs / 空列表 → AppError', () => {
    expect(() => parseLeetcodeList('<html>')).toThrow(AppError)
    expect(() => parseLeetcodeList('{"num_total":1}')).toThrow(/stat_status_pairs/)
    expect(() => parseLeetcodeList('{"stat_status_pairs":[]}')).toThrow(/为空/)
  })
})

describe('parseTagPage（力扣标签分页）', () => {
  it('slug → 中文标签（优先 nameTranslated，回落 name，去重去空）', () => {
    const page = parseTagPage(TAG_JSON)
    expect(page.hasMore).toBe(false)
    expect(page.total).toBe(2)
    expect(page.tags.get('two-sum')).toEqual(['数组', '哈希表'])
    expect(page.tags.get('paid-x')).toEqual(['Math'])
  })

  it('slug → 中文标题（titleCn 优先，缺失回落英文 title）', () => {
    const page = parseTagPage(TAG_JSON)
    expect(page.titles.get('two-sum')).toBe('两数之和')
    expect(page.titles.get('paid-x')).toBe('Paid X')
  })

  it('GraphQL errors → 抛出可读错误', () => {
    expect(() =>
      parseTagPage(JSON.stringify({ errors: [{ message: 'Cannot query field "x"' }] }))
    ).toThrow(/Cannot query field/)
  })

  it('缺 questions → AppError', () => {
    expect(() => parseTagPage('{"data":{}}')).toThrow(AppError)
  })

  it('查询语句使用分页变量且 limit 与常量一致', () => {
    const q = buildTagPageQuery(200, LEETCODE_PAGE_SIZE)
    expect(q).toContain('problemsetQuestionList')
    expect(q).toContain('topicTags')
    expect(q).toContain('nameTranslated')
    expect(q).toContain('titleCn')
    expect(LEETCODE_PAGE_SIZE).toBe(100)
  })
})

describe('mapLeetcodeToUpsert / problemIdentity（力扣入库映射）', () => {
  it('contestId=0、index=slug、source=leetcode、frontendId 透传、标签来自标签页', () => {
    const page = parseTagPage(TAG_JSON)
    const inputs = mapLeetcodeToUpsert(parseLeetcodeList(LIST_JSON), page.tags, page.titles)
    expect(inputs[0]).toMatchObject({
      contestId: 0,
      index: 'two-sum',
      name: '两数之和',
      rating: null,
      difficulty: 1,
      source: 'leetcode',
      frontendId: '1',
      tags: ['数组', '哈希表']
    })
    expect(inputs[1].tags).toEqual(['Math'])
    // 无 titleCn 的题回落英文标题
    expect(inputs[1].name).toBe('Paid X')
  })

  it('未提供标题映射时使用 REST 标题（向后兼容）', () => {
    const inputs = mapLeetcodeToUpsert(parseLeetcodeList(LIST_JSON), parseTagPage(TAG_JSON).tags)
    expect(inputs[0].name).toBe('两数之和')
    expect(inputs[1].name).toBe('会员难题')
  })

  it('id = LC + 去空格题号；URL 指向 leetcode.cn；题号缺失时退回 slug', () => {
    expect(
      problemIdentity({
        contestId: 0,
        index: 'two-sum',
        name: 'x',
        rating: null,
        frontendId: '1',
        solvedCount: 0,
        source: 'leetcode',
        tags: []
      })
    ).toEqual({ id: 'LC1', url: 'https://leetcode.cn/problems/two-sum/', source: 'leetcode' })

    expect(
      problemIdentity({
        contestId: 0,
        index: 'lcr-001',
        name: 'x',
        rating: null,
        frontendId: 'LCR 001',
        solvedCount: 0,
        source: 'leetcode',
        tags: []
      }).id
    ).toBe('LCLCR001')

    expect(
      problemIdentity({
        contestId: 0,
        index: 'cnHoX6',
        name: 'x',
        rating: null,
        solvedCount: 0,
        source: 'leetcode',
        tags: []
      }).id
    ).toBe('LCcnHoX6')
  })

  it('不影响既有 CF / 洛谷身份规则', () => {
    expect(
      problemIdentity({ contestId: 1741, index: 'A', name: 'x', rating: 800, solvedCount: 0, tags: [] })
    ).toEqual({
      id: '1741:A',
      url: 'https://codeforces.com/problemset/problem/1741/A',
      source: 'cf'
    })
    expect(
      problemIdentity({
        contestId: 0,
        index: 'P1000',
        name: 'x',
        rating: null,
        solvedCount: 0,
        source: 'luogu',
        tags: []
      }).id
    ).toBe('P1000')
  })
})

describe('syncLeetcodeProblemset（编排：列表 + 标签分页 → 入库）', () => {
  let db: Database.Database
  let repo: ProblemsRepo

  beforeEach(() => {
    closeDb()
    db = initDb(':memory:')
    repo = new ProblemsRepo(db)
  })
  afterEach(() => closeDb())

  it('全量同步：进度上报、入库 2 道、标签合并、重复同步为更新', async () => {
    const progress: SyncProgress[] = []
    const fetchers = {
      fetchList: async () => LIST_JSON,
      fetchTagPage: async () => TAG_JSON
    }
    const r1 = await syncLeetcodeProblemset(repo, (p) => progress.push(p), fetchers, 0)
    expect(r1.total).toBe(2)
    expect(r1.paidCount).toBe(1)
    expect(r1.added).toBe(2)
    expect(r1.updated).toBe(0)
    expect(progress[0].message).toContain('力扣题库列表')
    expect(progress.at(-1)?.percent).toBe(100)
    expect(progress.some((p) => p.stage === 'writing')).toBe(true)

    expect(repo.getById('LC1')?.name).toBe('两数之和')
    expect(repo.getById('LC1')?.source).toBe('leetcode')
    expect(repo.getById('LC1')?.difficulty).toBe(1)
    expect(repo.getById('LC1')?.solvedCount).toBe(3000)
    expect(repo.getById('LC1')?.cfUrl).toBe('https://leetcode.cn/problems/two-sum/')
    expect(repo.getById('LC1')?.tags).toEqual(expect.arrayContaining(['数组', '哈希表']))
    // 无 titleCn → 回落 GraphQL 英文标题（此处即 'Paid X'）
    expect(repo.getById('LCLCR001')?.name).toBe('Paid X')
    expect(repo.count('leetcode')).toBe(2)

    const r2 = await syncLeetcodeProblemset(repo, () => undefined, fetchers, 0)
    expect(r2.added).toBe(0)
    expect(r2.updated).toBe(2)
    expect(repo.count('leetcode')).toBe(2)
  })

  it('标签页缺该题时仍入库（tags 为空），不影响列表数据', async () => {
    const fetchers = {
      fetchList: async () => LIST_JSON,
      fetchTagPage: async () =>
        JSON.stringify({ data: { problemsetQuestionList: { hasMore: false, total: 1, questions: [] } } })
    }
    await syncLeetcodeProblemset(repo, () => undefined, fetchers, 0)
    expect(repo.getById('LC1')?.tags).toEqual([])
    expect(repo.getById('LC1')?.difficulty).toBe(1)
  })

  it('多页时按 hasMore 继续翻页并累计标签', async () => {
    const calls: number[] = []
    const fetchers = {
      fetchList: async () =>
        JSON.stringify({
          stat_status_pairs: Array.from({ length: 150 }, (_, i) => ({
            stat: {
              question__title: `题 ${i}`,
              question__title_slug: `p-${i}`,
              frontend_question_id: String(i + 1),
              total_acs: 0,
              total_submitted: 0
            },
            difficulty: { level: 2 },
            paid_only: false
          }))
        }),
      fetchTagPage: async (skip: number) => {
        calls.push(skip)
        const from = skip
        const to = Math.min(skip + LEETCODE_PAGE_SIZE, 150)
        return JSON.stringify({
          data: {
            problemsetQuestionList: {
              hasMore: to < 150,
              total: 150,
              questions: Array.from({ length: to - from }, (_, i) => ({
                titleSlug: `p-${from + i}`,
                topicTags: [{ name: 'Array', nameTranslated: '数组' }]
              }))
            }
          }
        })
      }
    }
    const r = await syncLeetcodeProblemset(repo, () => undefined, fetchers, 0)
    expect(r.totalPages).toBe(2)
    expect(calls).toEqual([0, 100])
    expect(repo.count('leetcode')).toBe(150)
    expect(repo.getById('LC150')?.tags).toEqual(['数组'])
  })
})
