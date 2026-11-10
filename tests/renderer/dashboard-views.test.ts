// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createWebHashHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { IpcChannels } from '@shared/channels'
import DashboardPage from '@/pages/DashboardPage.vue'
import type { ProblemView, RecommendResult, StatsResult } from '@shared/types'

/**
 * 首页「刷题记录」（v1.19 FR-40）。
 *
 * 契约：
 * - 按打开时间倒序列出打开过的题（题号 / 题名 / 难度 / 时间）；
 * - 同一题打开多次显示「打开 N 次」；
 * - 点条目重新打开题面（statement:open）并刷新列表；
 * - 「清空记录」调用 views:clear 后回到空态；
 * - 无记录时显示引导文案。
 */

const stats: StatsResult = {
  totalAttempts: 0,
  acCount: 0,
  accuracy: 0,
  distinctProblems: 0,
  practiceSeconds: 0,
  daily: [],
  weekly: [],
  tagStats: []
}

const emptyRec: RecommendResult = {
  practiced: [],
  fresh: [],
  practicedOrder: 'forgetting',
  freshOrder: 'learning-node',
  totals: { practiced: 0, fresh: 0 },
  filterTags: []
}

function viewRow(problemId: string, extra: Partial<ProblemView> = {}): ProblemView {
  return {
    problemId,
    name: `题目 ${problemId}`,
    source: 'cf',
    rating: 1500,
    lastOpenedAt: '2026-10-05 09:30:00',
    firstOpenedAt: '2026-10-01 08:00:00',
    openCount: 1,
    ...extra
  }
}

function setupApi(rows: ProblemView[]) {
  let recorded = rows
  const calls: { channel: string; payload?: unknown }[] = []
  const api = {
    invoke: vi.fn(async (channel: string, payload?: unknown) => {
      calls.push({ channel, payload })
      switch (channel) {
        case IpcChannels.ViewsRecent:
          return { ok: true, data: recorded }
        case IpcChannels.ViewsClear:
          recorded = []
          return { ok: true, data: { ok: true } }
        case IpcChannels.StatementOpen:
          return { ok: true, data: { opened: true } }
        case IpcChannels.RecordsStats:
          return { ok: true, data: stats }
        case IpcChannels.RecordsList:
          return { ok: true, data: { total: 0, items: [] } }
        case IpcChannels.SettingsGetAll:
          return { ok: true, data: {} }
        case IpcChannels.StatsTagUsage:
          return { ok: true, data: [] }
        case IpcChannels.RecommendGet:
          return { ok: true, data: emptyRec }
        default:
          return { ok: false, error: { code: 'NO_HANDLER', message: channel } }
      }
    }),
    on: vi.fn(() => () => undefined)
  }
  ;(window as unknown as { api: unknown }).api = api
  return { api, calls, getRows: () => recorded }
}

async function settle(until: () => boolean): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await flushPromises()
    await new Promise((r) => setTimeout(r, 10))
    await flushPromises()
    if (until()) return
  }
}

async function mountPage(rows: ProblemView[]) {
  const ctx = setupApi(rows)
  const router = createRouter({
    history: createWebHashHistory(),
    routes: [{ path: '/:p(.*)*', component: { template: '<div/>' } }]
  })
  setActivePinia(createPinia())
  const wrapper = mount(DashboardPage, { global: { plugins: [router, createPinia()] } })
  // 面板是常驻的，必须等「数据到位」：有数据等出条目，无数据等空态文案
  await settle(() =>
    rows.length > 0
      ? wrapper.findAll('.view-item').length > 0
      : wrapper.find('[data-panel="views"]').text().includes('还没有打开过的题')
  )
  return { wrapper, ...ctx }
}

describe('首页刷题记录（v1.19 FR-40）', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    setActivePinia(createPinia())
    delete (window as unknown as { api?: unknown }).api
  })

  it('渲染刷题记录面板与条目', async () => {
    const { wrapper, calls } = await mountPage([
      viewRow('1:A', { rating: 800 }),
      viewRow('P1001', { name: 'A+B Problem', source: 'luogu', rating: null })
    ])
    const panel = wrapper.find('[data-panel="views"]')
    expect(panel.exists()).toBe(true)
    expect(panel.text()).toContain('刷题记录')
    expect(panel.text()).toContain('共 2 道')
    const items = panel.findAll('.view-item')
    expect(items).toHaveLength(2)
    expect(items[0].text()).toContain('1:A')
    expect(items[0].text()).toContain('题目 1:A')
    expect(items[0].text()).toContain('800')
    expect(items[1].text()).toContain('A+B Problem')
    expect(items[1].find('.rating').exists()).toBe(false)
    // 请求带上限，避免首页拉全库
    expect(calls.some((c) => c.channel === IpcChannels.ViewsRecent && JSON.stringify(c.payload ?? {}).includes('12'))).toBe(true)
  })

  it('保持后端返回的顺序（按打开时间倒序，前端不重排）', async () => {
    const { wrapper } = await mountPage([
      viewRow('P3374', { lastOpenedAt: '2026-10-09 20:00:00' }),
      viewRow('1:B', { lastOpenedAt: '2026-10-07 12:00:00' }),
      viewRow('1:A', { lastOpenedAt: '2026-10-01 08:00:00' })
    ])
    const ids = wrapper.findAll('.view-item').map((i) => i.attributes('data-view-id'))
    expect(ids).toEqual(['P3374', '1:B', '1:A'])
  })

  it('同一题打开多次显示次数标记', async () => {
    const { wrapper } = await mountPage([viewRow('1:A', { openCount: 4 })])
    const badge = wrapper.find('.view-item .open-count')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toBe('打开 4 次')
    // 只打开一次不显示次数
    const once = await mountPage([viewRow('1:B', { openCount: 1 })])
    expect(once.wrapper.find('.open-count').exists()).toBe(false)
  })

  it('时间显示为月-日 时:分（当年）', async () => {
    const year = new Date().getFullYear()
    const { wrapper } = await mountPage([viewRow('1:A', { lastOpenedAt: `${year}-10-05 09:30:00` })])
    expect(wrapper.find('.view-item').text()).toContain('10-05 09:30')
  })

  it('点条目重新打开题面并刷新列表', async () => {
    const { wrapper, calls } = await mountPage([viewRow('1:A')])
    await wrapper.find('.view-item').trigger('click')
    await flushPromises()
    const openCall = calls.filter((c) => c.channel === IpcChannels.StatementOpen)
    expect(openCall).toHaveLength(1)
    expect(openCall[0].payload).toEqual({ problemId: '1:A' })
    // 打开后重新拉一次记录（时间会更新）
    const recentCalls = calls.filter((c) => c.channel === IpcChannels.ViewsRecent)
    expect(recentCalls.length).toBeGreaterThanOrEqual(2)
  })

  it('清空记录后回到空态', async () => {
    const { wrapper, calls } = await mountPage([viewRow('1:A'), viewRow('1:B')])
    expect(wrapper.findAll('.view-item')).toHaveLength(2)
    await wrapper.find('[data-views-clear]').trigger('click')
    await flushPromises()
    await flushPromises()
    expect(calls.some((c) => c.channel === IpcChannels.ViewsClear)).toBe(true)
    expect(wrapper.findAll('.view-item')).toHaveLength(0)
    expect(wrapper.find('[data-panel="views"]').text()).toContain('还没有打开过的题')
  })

  it('无记录时显示引导文案且清空按钮禁用', async () => {
    const { wrapper } = await mountPage([])
    const panel = wrapper.find('[data-panel="views"]')
    expect(panel.text()).toContain('还没有打开过的题')
    expect(panel.text()).toContain('共 0 道')
    expect(wrapper.find('[data-views-clear]').attributes('disabled')).toBeDefined()
  })
})
