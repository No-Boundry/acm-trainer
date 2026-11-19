// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { IpcChannels } from '@shared/channels'
import ListsPage from '@/pages/ListsPage.vue'
import type { ArchiveKindCatalog } from '@shared/contest-archive'
import type { ProblemList, ProblemListDetail } from '@shared/types'

/**
 * 往届比赛题单弹窗（v1.21.0 FR-43）：
 * 打开时拉目录 → 手动选年份 → 地区随年份联动 → 预览题数 → 生成题单调用 lists:createArchive。
 */

const list: ProblemList = {
  id: 1,
  name: '蓝桥杯 2024 · 省 A',
  description: '',
  origin: 'archive',
  trackId: 'lanqiao',
  createdAt: '2026-11-19 08:00:00',
  updatedAt: '2026-11-19 08:00:00',
  total: 2,
  doneCount: 0,
  reviewCount: 0,
  dueCount: 0
}

const detail: ProblemListDetail = { list, items: [] }

const catalog: ArchiveKindCatalog[] = [
  {
    kind: 'lanqiao',
    label: '蓝桥杯',
    total: 4,
    years: [
      { year: 2025, count: 1, regions: [{ region: '国 A', count: 1 }] },
      { year: 2024, count: 3, regions: [{ region: '省 A', count: 2 }, { region: '省 B', count: 1 }] }
    ]
  },
  {
    kind: 'ccpc',
    label: 'CCPC',
    total: 2,
    years: [{ year: 2024, count: 2, regions: [{ region: '哈尔滨站', count: 2 }] }]
  }
]

function setupApi(archiveCatalog: ArchiveKindCatalog[] = catalog) {
  const calls: { channel: string; payload?: unknown }[] = []
  const api = {
    invoke: vi.fn(async (channel: string, payload?: unknown) => {
      calls.push({ channel, payload })
      const handlers: Record<string, () => unknown> = {
        [IpcChannels.ListsList]: () => [list],
        [IpcChannels.ListsGet]: () => detail,
        [IpcChannels.ListsDueReviews]: () => ({ today: '2026-11-19', items: [] }),
        [IpcChannels.PlansList]: () => [],
        [IpcChannels.SkillGet]: () => ({ nodes: [], recommendedIds: [], allDone: false, tracks: [] }),
        [IpcChannels.ListsArchiveCatalog]: () => archiveCatalog,
        [IpcChannels.ListsCreateArchive]: () => ({ listId: 21, picked: 2 })
      }
      const h = handlers[channel]
      if (!h) return { ok: false, error: { code: 'NO_HANDLER', message: channel } }
      return { ok: true, data: await h() }
    }),
    on: vi.fn(() => () => undefined)
  }
  ;(window as unknown as { api: unknown }).api = api
  return { api, calls }
}

async function mountPage(archiveCatalog: ArchiveKindCatalog[] = catalog) {
  const ctx = setupApi(archiveCatalog)
  const wrapper = mount(ListsPage, { global: { plugins: [createPinia()] } })
  await flushPromises()
  await flushPromises()
  return { wrapper, ...ctx }
}

async function openModal(wrapper: Awaited<ReturnType<typeof mountPage>>['wrapper']) {
  const btn = wrapper.find('.archive-entry')
  await btn.trigger('click')
  await flushPromises()
  return wrapper.find('.modal')
}

describe('往届比赛题单弹窗（v1.21.0 FR-43）', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    delete (window as unknown as { api?: unknown }).api
  })

  it('题单页左侧面板有入口；打开后默认选中最近一届蓝桥杯并显示题数', async () => {
    const { wrapper, calls } = await mountPage()
    const entry = wrapper.find('.archive-entry')
    expect(entry.exists()).toBe(true)
    expect(entry.text()).toContain('往届比赛题单')

    const modal = await openModal(wrapper)
    expect(modal.exists()).toBe(true)
    expect(modal.find('h3').text()).toContain('往届比赛题单')
    expect(modal.findAll('.seg').map((s) => s.text())).toEqual(['蓝桥杯', 'CCPC'])

    // 默认最近一届（2025）+ 全部组别 → 1 题
    const selects = modal.findAll('select')
    expect((selects[0].element as HTMLSelectElement).value).toBe('2025')
    const yearOptions = selects[0].findAll('option').map((o) => o.text())
    expect(yearOptions).toEqual(['2025 年（1 题）', '2024 年（3 题）'])
    expect(selects[1].findAll('option').map((o) => o.text())).toEqual(['全部组别（1 题）', '国 A（1 题）'])
    expect(modal.text()).toContain('将创建：')
    expect(modal.text()).toContain('共 1 题')

    expect(calls.some((c) => c.channel === IpcChannels.ListsArchiveCatalog)).toBe(true)
  })

  it('手动换年份：地区选项与预览题数随年份联动', async () => {
    const { wrapper } = await mountPage()
    const modal = await openModal(wrapper)
    const selects = modal.findAll('select')

    await selects[0].setValue('2024')
    await flushPromises()
    expect(selects[1].findAll('option').map((o) => o.text())).toEqual([
      '全部组别（3 题）',
      '省 A（2 题）',
      '省 B（1 题）'
    ])
    expect(modal.text()).toContain('共 3 题')

    await selects[1].setValue('省 A')
    await flushPromises()
    expect(modal.text()).toContain('蓝桥杯 2024 · 省 A')
    expect(modal.text()).toContain('共 2 题')
    expect(modal.find('.modal-actions button.primary').text()).toContain('生成题单（2 题）')
  })

  it('换年份时旧地区不存在则回到「全部」（地区随年份联动，不残留）', async () => {
    const { wrapper } = await mountPage()
    const modal = await openModal(wrapper)
    const selects = modal.findAll('select')
    await selects[1].setValue('国 A')
    await flushPromises()
    expect(modal.text()).toContain('共 1 题')

    await selects[0].setValue('2024')
    await flushPromises()
    expect((selects[1].element as HTMLSelectElement).value).toBe('')
    expect(modal.text()).toContain('共 3 题')
  })

  it('切换比赛：CCPC 只列 CCPC 年份与赛区，名称/预览跟着换', async () => {
    const { wrapper } = await mountPage()
    const modal = await openModal(wrapper)
    const ccpc = modal.findAll('.seg').find((s) => s.text() === 'CCPC')!
    await ccpc.trigger('click')
    await flushPromises()
    expect(modal.text()).toContain('CCPC 2024（全部赛区）')
    expect(modal.text()).toContain('共 2 题')
    const selects = modal.findAll('select')
    expect(selects[0].findAll('option').map((o) => o.text())).toEqual(['2024 年（2 题）'])
    expect(selects[1].findAll('option').map((o) => o.text())).toEqual(['全部赛区（2 题）', '哈尔滨站（2 题）'])
  })

  it('生成题单调用 lists:createArchive（带比赛 / 年份 / 地区），成功后关闭弹窗', async () => {
    const { wrapper, calls } = await mountPage()
    const modal = await openModal(wrapper)
    const selects = modal.findAll('select')
    await selects[0].setValue('2024')
    await flushPromises()
    await selects[1].setValue('省 A')
    await flushPromises()

    const genBtn = modal.findAll('.modal-actions button').find((b) => b.text().includes('生成题单'))!
    await genBtn.trigger('click')
    await flushPromises()

    const call = calls.find((c) => c.channel === IpcChannels.ListsCreateArchive)
    expect(call).toBeTruthy()
    expect(call!.payload).toMatchObject({ kind: 'lanqiao', year: 2024, region: '省 A' })
    expect(wrapper.find('.modal').exists()).toBe(false)
  })

  it('本地题库没有往届比赛题时给出同步引导而不是空弹窗', async () => {
    const empty: ArchiveKindCatalog[] = [
      { kind: 'lanqiao', label: '蓝桥杯', total: 0, years: [] },
      { kind: 'ccpc', label: 'CCPC', total: 0, years: [] }
    ]
    const { wrapper } = await mountPage(empty)
    const modal = await openModal(wrapper)
    expect(modal.text()).toContain('同步洛谷题库')
    expect(modal.find('.modal-actions button').exists()).toBe(true)
  })
})
