// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { IpcChannels } from '@shared/channels'
import ProblemsPage from '@/pages/ProblemsPage.vue'
import type { ProblemRow } from '@shared/types'

/**
 * 题库页「力扣」数据源（v1.9 FR-21）：
 * 源切换 → 请求带 source=leetcode、难度下拉变为 简单/中等/困难、行内展示力扣标签与难度；
 * 切回 CF/全部时难度筛选被清空。
 */

const lcRow: ProblemRow = {
  id: 'LC1',
  contestId: 0,
  index: 'two-sum',
  name: '两数之和',
  rating: null,
  difficulty: 1,
  solvedCount: 3000,
  totalSubmit: 6000,
  source: 'leetcode',
  cfUrl: 'https://leetcode.cn/problems/two-sum/',
  fetchedAt: '2026-09-20 10:00:00',
  tags: ['数组', '哈希表'],
  practiced: false,
  lastStatus: null
}

function setupApi() {
  const listPayloads: {
    source?: string
    difficulty?: number | null
    sortBy?: string
    sortDir?: string
  }[] = []
  const api = {
    invoke: vi.fn(async (channel: string, payload?: unknown) => {
      if (channel === IpcChannels.ProblemsList) {
        listPayloads.push(
          payload as { source?: string; difficulty?: number | null; sortBy?: string; sortDir?: string }
        )
        const p = payload as { source?: string }
        const items = p?.source === 'leetcode' ? [lcRow] : []
        return { ok: true, data: { total: items.length, items } }
      }
      const handlers: Record<string, () => unknown> = {
        [IpcChannels.SkillGet]: () => ({ nodes: [], recommendedIds: [], allDone: false }),
        [IpcChannels.ProblemsTags]: () => ['数组', '哈希表'],
        [IpcChannels.ProblemsLastSync]: () => ({
          cf: '2026-09-01 00:00:00',
          luogu: '2026-09-02 00:00:00',
          leetcode: '2026-09-20 10:00:00'
        }),
        [IpcChannels.RecordsList]: () => ({ total: 0, items: [] }),
        [IpcChannels.StatementOpen]: () => ({ ok: true, via: 'edge' })
      }
      const h = handlers[channel]
      if (!h) return { ok: false, error: { code: 'NO_HANDLER', message: channel } }
      return { ok: true, data: await h() }
    }),
    on: vi.fn(() => () => undefined)
  }
  ;(window as unknown as { api: unknown }).api = api
  return { api, listPayloads }
}

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/problems', component: { template: '<div />' } },
      { path: '/notes', component: { template: '<div />' } }
    ]
  })
}

async function mountPage() {
  const ctx = setupApi()
  const router = makeRouter()
  await router.push({ path: '/problems' })
  await router.isReady()
  const wrapper = mount(ProblemsPage, { global: { plugins: [createPinia(), router] } })
  await flushPromises()
  await flushPromises()
  return { wrapper, router, ...ctx }
}

describe('ProblemsPage 力扣数据源（v1.9 FR-21）', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    delete (window as unknown as { api?: unknown }).api
  })

  it('数据源开关含「力扣」，最近同步显示力扣时间', async () => {
    const { wrapper } = await mountPage()
    const segs = wrapper.findAll('.source-switch .seg')
    expect(segs.map((s) => s.text()).join('|')).toBe('全部|Codeforces|洛谷|力扣')
    expect(wrapper.text()).toContain('力扣 2026-09-20 10:00')
    expect(wrapper.findAll('button').some((b) => b.text().includes('同步力扣'))).toBe(true)
  })

  it('切到力扣：请求 source=leetcode，展示力扣行与难度下拉', async () => {
    const { wrapper, listPayloads } = await mountPage()
    const lcSeg = wrapper.findAll('.source-switch .seg').find((s) => s.text() === '力扣')!
    await lcSeg.trigger('click')
    await flushPromises()

    expect(listPayloads.at(-1)).toMatchObject({ source: 'leetcode', difficulty: null })
    const rows = wrapper.findAll('table.table tbody tr')
    expect(rows).toHaveLength(1)
    expect(rows[0].text()).toContain('LC1')
    expect(rows[0].text()).toContain('两数之和')
    expect(rows[0].text()).toContain('力扣')
    expect(rows[0].text()).toContain('简单')

    const select = wrapper.find('.filter-row select.select')
    const options = select.findAll('option').map((o) => o.text())
    expect(options).toEqual(['力扣难度：全部', '简单', '中等', '困难'])
  })

  it('力扣难度筛选请求携带 difficulty；切到全部时清空难度', async () => {
    const { wrapper, listPayloads } = await mountPage()
    const lcSeg = wrapper.findAll('.source-switch .seg').find((s) => s.text() === '力扣')!
    await lcSeg.trigger('click')
    await flushPromises()

    const select = wrapper.find('.filter-row select.select')
    await select.setValue('2')
    await flushPromises()
    expect(listPayloads.at(-1)).toMatchObject({ source: 'leetcode', difficulty: 2 })

    const allSeg = wrapper.findAll('.source-switch .seg').find((s) => s.text() === '全部')!
    await allSeg.trigger('click')
    await flushPromises()
    expect(listPayloads.at(-1)).toMatchObject({ source: 'all', difficulty: null })
  })

  it('洛谷视图仍为洛谷难度下拉（不受力扣影响）', async () => {
    const { wrapper } = await mountPage()
    const lgSeg = wrapper.findAll('.source-switch .seg').find((s) => s.text() === '洛谷')!
    await lgSeg.trigger('click')
    await flushPromises()
    const options = wrapper.find('.filter-row select.select').findAll('option').map((o) => o.text())
    expect(options[0]).toBe('洛谷难度：全部')
    expect(options).toHaveLength(9) // 全部 + 难度 0–7
  })

  // ============ v1.9.1：排序可用性与默认方向 ============

  it('切源不再强制改成「按题号」（按难度现在对各源都有效）且清空难度筛选', async () => {
    const { wrapper, listPayloads } = await mountPage()
    // 先选一个洛谷难度，再切到力扣：难度筛选必须被清空（两源难度量纲不同）
    const lgSeg = wrapper.findAll('.source-switch .seg').find((s) => s.text() === '洛谷')!
    await lgSeg.trigger('click')
    await flushPromises()
    await wrapper.find('.filter-row select.select').setValue('3')
    await flushPromises()
    expect(listPayloads.at(-1)).toMatchObject({ source: 'luogu', difficulty: 3 })

    const lcSeg = wrapper.findAll('.source-switch .seg').find((s) => s.text() === '力扣')!
    await lcSeg.trigger('click')
    await flushPromises()
    const last = listPayloads.at(-1)!
    expect(last).toMatchObject({ source: 'leetcode', difficulty: null })
    expect(last.sortBy).toBe('rating') // 仍为「按难度」（v1.9.1 起洛谷/力扣按各自 difficulty 排序）
  })

  it('选择「按题号」→ 请求 sortBy=id 且默认升序', async () => {
    const { wrapper, listPayloads } = await mountPage()
    await wrapper.find('select.sort-by').setValue('id')
    await flushPromises()
    expect(listPayloads.at(-1)).toMatchObject({ sortBy: 'id', sortDir: 'asc' })
  })

  it('选择「按难度」→ 降序；「按 AC 数」→ 降序', async () => {
    const { wrapper, listPayloads } = await mountPage()
    await wrapper.find('select.sort-by').setValue('id')
    await flushPromises()
    await wrapper.find('select.sort-by').setValue('solvedCount')
    await flushPromises()
    expect(listPayloads.at(-1)).toMatchObject({ sortBy: 'solvedCount', sortDir: 'desc' })
    await wrapper.find('select.sort-by').setValue('rating')
    await flushPromises()
    expect(listPayloads.at(-1)).toMatchObject({ sortBy: 'rating', sortDir: 'desc' })
  })
})
