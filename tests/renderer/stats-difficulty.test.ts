// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { IpcChannels } from '@shared/channels'
import StatsPage from '@/pages/StatsPage.vue'
import type { DifficultyStatsResult, StatsResult } from '@shared/types'

/**
 * 统计页「难度分布」板块（v1.9 FR-22）：
 * 三个题源分档表格 + 图表 + 默认定位到有数据的题源。
 * jsdom 无 canvas，ChartBox 用桩替换。
 */

const stats: StatsResult = {
  totalAttempts: 12,
  acCount: 11,
  accuracy: 91.7,
  distinctProblems: 11,
  practiceSeconds: 8280,
  daily: [{ date: '2026-09-20', count: 12, acCount: 11 }],
  weekly: [{ week: '2026-W38', count: 12, acCount: 11 }],
  tagStats: [{ tag: '贪心', count: 9, acCount: 9 }]
}

function bucket(key: string, label: string, attempted: number, ac: number) {
  return {
    key,
    label,
    attempted,
    ac,
    acRate: attempted > 0 ? Number(((ac / attempted) * 100).toFixed(1)) : null,
    share: attempted > 0 ? Number(((attempted / Math.max(1, attempted)) * 100).toFixed(1)) : 0
  }
}

const diff: DifficultyStatsResult = {
  cf: {
    source: 'cf',
    attempted: 3,
    ac: 2,
    buckets: [bucket('800', '800–999', 2, 2), bucket('1200', '1200–1399', 1, 0)]
  },
  luogu: {
    source: 'luogu',
    attempted: 2,
    ac: 2,
    buckets: [
      bucket('d0', '0 · 暂无评定', 0, 0),
      bucket('d1', '1 · 入门', 1, 1),
      bucket('d3', '3 · 普及/提高-', 1, 1)
    ]
  },
  leetcode: {
    source: 'leetcode',
    attempted: 5,
    ac: 4,
    buckets: [
      bucket('d1', '简单', 3, 3),
      bucket('d2', '中等', 2, 1),
      bucket('d3', '困难', 0, 0)
    ]
  }
}

function setupApi(payload: DifficultyStatsResult | null = diff) {
  const api = {
    invoke: vi.fn(async (channel: string) => {
      if (channel === IpcChannels.RecordsStats) return { ok: true, data: stats }
      if (channel === IpcChannels.StatsDifficulty) {
        if (!payload) return { ok: false, error: { code: 'X', message: 'boom' } }
        return { ok: true, data: payload }
      }
      return { ok: false, error: { code: 'NO_HANDLER', message: channel } }
    }),
    on: vi.fn(() => () => undefined)
  }
  ;(window as unknown as { api: unknown }).api = api
  return api
}

async function mountPage(payload: DifficultyStatsResult | null = diff) {
  const api = setupApi(payload)
  const wrapper = mount(StatsPage, { global: { stubs: { ChartBox: true } } })
  await flushPromises()
  await flushPromises()
  return { wrapper, api }
}

describe('StatsPage 难度分布（v1.9 FR-22）', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    delete (window as unknown as { api?: unknown }).api
  })

  it('渲染板块与三个题源标签', async () => {
    const { wrapper } = await mountPage()
    expect(wrapper.text()).toContain('难度分布（按题源）')
    const tabs = wrapper.findAll('.diff-tabs .seg')
    expect(tabs).toHaveLength(3)
    expect(tabs.map((t) => t.text()).join('|')).toContain('Codeforces（rating 分段）')
    expect(tabs.map((t) => t.text()).join('|')).toContain('洛谷（难度 0–7）')
    expect(tabs.map((t) => t.text()).join('|')).toContain('力扣（简单/中等/困难）')
  })

  it('默认定位到已练题目最多的题源（力扣 5 题）', async () => {
    const { wrapper } = await mountPage()
    const on = wrapper.findAll('.diff-tabs .seg').filter((t) => t.classes().includes('on'))
    expect(on).toHaveLength(1)
    expect(on[0].text()).toContain('力扣')
    const rows = wrapper.findAll('.diff-table tbody tr')
    expect(rows).toHaveLength(3)
    expect(rows[0].text()).toContain('简单')
    expect(rows[0].text()).toContain('100%')
  })

  it('切换题源后表格随之变化（含 0 数据档位与合计）', async () => {
    const { wrapper } = await mountPage()
    const tabs = wrapper.findAll('.diff-tabs .seg')
    await tabs[0].trigger('click') // Codeforces
    await flushPromises()
    let rows = wrapper.findAll('.diff-table tbody tr')
    expect(rows).toHaveLength(2)
    expect(rows[0].text()).toContain('800–999')
    expect(wrapper.find('.diff-table tfoot').text()).toContain('合计')

    await tabs[1].trigger('click') // 洛谷
    await flushPromises()
    rows = wrapper.findAll('.diff-table tbody tr')
    expect(rows).toHaveLength(3)
    expect(rows[0].classes()).toContain('zero')
    expect(rows[0].text()).toContain('暂无评定')
  })

  it('接口失败/无数据时给出空态提示且不崩溃', async () => {
    const { wrapper } = await mountPage(null)
    expect(wrapper.find('.diff-panel').exists()).toBe(true)
    expect(wrapper.text()).toContain('还没有练习记录')

    const { wrapper: w2 } = await mountPage({
      cf: { source: 'cf', attempted: 0, ac: 0, buckets: [] },
      luogu: { source: 'luogu', attempted: 0, ac: 0, buckets: [] },
      leetcode: { source: 'leetcode', attempted: 0, ac: 0, buckets: [] }
    })
    expect(w2.text()).toContain('还没有练习记录')
  })
})
