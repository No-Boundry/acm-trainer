// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { IpcChannels } from '@shared/channels'
import ProblemsPage from '@/pages/ProblemsPage.vue'
import type { ProblemRow, SkillNodeReport } from '@shared/types'

/**
 * 题库页「知识点筛选」组件测试（v1.8 FR-17 → v1.13 合并版）。
 * v1.13 起：知识点不再是独立面板，而是标签分栏里的「知识点」Tab，
 * 选中节点 = 选中该节点的全部关联标签（与标签共用 store.filter.tags，不再发送 tagsAny）。
 */

function skillNodes(): SkillNodeReport[] {
  const stats = (attempted: number, ac: number): SkillNodeReport['stats'] => ({
    attempted,
    acProblems: ac,
    attempts: attempted + 1,
    acAttempts: ac,
    acc: attempted > 0 ? ac / (attempted + 1) : null,
    hardSolved: 0,
    lastActiveDays: 2
  })
  return [
    {
      id: 'greedy',
      name: '贪心',
      layer: 1,
      tags: ['greedy', '贪心'],
      dependsOn: [],
      intro: '贪心简介',
      stats: stats(3, 2),
      tier: 'learning',
      depsReady: true
    },
    {
      id: 'dp',
      name: '动态规划入门',
      layer: 2,
      tags: ['dp', '动态规划 DP'],
      dependsOn: ['greedy'],
      intro: 'DP 简介',
      stats: stats(0, 0),
      tier: 'untouched',
      depsReady: false
    },
    {
      // 综合节点：无关联标签 → 不参与筛题（真实图谱中的 final_sprint）
      id: 'final_sprint',
      name: '综合模拟与比赛策略',
      layer: 6,
      tags: [],
      dependsOn: ['dp'],
      intro: '综合节点简介',
      stats: stats(1, 1),
      tier: 'newbie',
      depsReady: false
    }
  ]
}

const row: ProblemRow = {
  id: '1:A',
  contestId: 1,
  index: 'A',
  name: 'Greedy Easy',
  rating: 800,
  difficulty: null,
  solvedCount: 100,
  totalSubmit: 200,
  source: 'cf',
  cfUrl: 'https://codeforces.com/problemset/problem/1/A',
  fetchedAt: '2026-09-01 00:00:00',
  tags: ['greedy'],
  practiced: false,
  lastStatus: null
}

interface ListPayload {
  tags?: string[]
  tagsAny?: string[]
}

function setupApi() {
  const listPayloads: ListPayload[] = []
  const api = {
    invoke: vi.fn(async (channel: string) => {
      const handlers: Record<string, () => unknown> = {
        [IpcChannels.SkillGet]: () => ({ nodes: skillNodes(), recommendedIds: ['greedy'], allDone: false }),
        [IpcChannels.ProblemsList]: (() => ({ total: 1, items: [row] })) as unknown as () => unknown,
        [IpcChannels.ProblemsTags]: () => ['greedy', 'dp'],
        [IpcChannels.ProblemsLastSync]: () => ({ cf: '2026-09-01 00:00:00', luogu: null })
      }
      const h = handlers[channel]
      if (!h) return { ok: false, error: { code: 'NO_HANDLER', message: channel } }
      return { ok: true, data: await h() }
    }),
    on: vi.fn(() => () => undefined)
  }
  const original = api.invoke
  api.invoke = vi.fn(async (channel: string, payload?: unknown) => {
    if (channel === IpcChannels.ProblemsList) listPayloads.push(payload as ListPayload)
    return original(channel, payload)
  }) as unknown as typeof original
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

async function mountPage(query: Record<string, string> = {}) {
  const ctx = setupApi()
  const router = makeRouter()
  await router.push({ path: '/problems', query })
  await router.isReady()
  const wrapper = mount(ProblemsPage, { global: { plugins: [createPinia(), router] } })
  await flushPromises()
  await flushPromises()
  return { wrapper, router, ...ctx }
}

/** 当前激活的标签分类 Tab 名 */
function activeCat(wrapper: ReturnType<typeof mount>): string {
  return wrapper.find('.seg-tab.on').text()
}

describe('ProblemsPage 知识点筛选（v1.13 并入标签分栏）', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    delete (window as unknown as { api?: unknown }).api
  })

  it('知识点是标签分栏的第一个 Tab，不再有独立面板', async () => {
    const { wrapper } = await mountPage()
    // 旧面板已移除
    expect(wrapper.find('.kn-panel').exists()).toBe(false)
    // 第一个 Tab 即「知识点」
    const tabs = wrapper.findAll('.seg-tab')
    expect(tabs.length).toBeGreaterThan(1)
    expect(tabs[0].text()).toContain('知识点')
    wrapper.unmount()
  })

  it('切到知识点 Tab：分层分组 + 掌握度色点 + 已练/已 AC 题数 + 掌握概览', async () => {
    const { wrapper } = await mountPage()
    await wrapper.findAll('.seg-tab')[0].trigger('click')
    await flushPromises()
    const chips = wrapper.findAll('.kn-chip')
    expect(chips).toHaveLength(3)
    const disabled = chips.find((c) => c.text().includes('综合模拟与比赛策略'))!
    expect(disabled.classes()).toContain('disabled')
    const greedy = chips.find((c) => c.text().includes('贪心'))!
    expect(greedy.text()).toContain('3/2')
    expect(greedy.find('.dot').exists()).toBe(true)
    expect(wrapper.text()).toContain('L1')
    expect(wrapper.text()).toContain('L2')
    expect(greedy.attributes('title')).toContain('关联标签 2 个')
    // 掌握概览：练习中 1 / 未开始 1
    const summary = wrapper.find('.kn-summary-line')
    expect(summary.exists()).toBe(true)
    expect(summary.text()).toContain('练习中 1')
    expect(summary.text()).toContain('未开始 1')
    wrapper.unmount()
  })

  it('点击知识点 → 其关联标签进入统一 tags 筛选（不再发送 tagsAny）', async () => {
    const { wrapper, listPayloads } = await mountPage()
    await wrapper.findAll('.seg-tab')[0].trigger('click')
    await flushPromises()
    const greedy = wrapper.findAll('.kn-chip').find((c) => c.text().includes('贪心'))!

    await greedy.trigger('click')
    await flushPromises()
    let last = listPayloads[listPayloads.length - 1]
    expect(last.tags?.sort()).toEqual(['greedy', '贪心'].sort())
    expect(last.tagsAny).toBeUndefined() // v1.13：合流后不再有独立通道

    // 节点呈选中态 + 已选 chips 出现这两个标签
    expect(wrapper.findAll('.kn-chip.on')).toHaveLength(1)
    const chips = wrapper.findAll('.sel-line .chip').map((c) => c.text())
    expect(chips.join('|')).toContain('greedy')
    expect(chips.join('|')).toContain('贪心')

    // 再点一次取消
    await wrapper.findAll('.kn-chip').find((c) => c.text().includes('贪心'))!.trigger('click')
    await flushPromises()
    last = listPayloads[listPayloads.length - 1]
    expect(last.tags).toEqual([])
    expect(wrapper.findAll('.kn-chip.on')).toHaveLength(0)
    wrapper.unmount()
  })

  it('多个知识点可叠加（标签并集）；「全部清空」一次性还原', async () => {
    const { wrapper, listPayloads } = await mountPage()
    await wrapper.findAll('.seg-tab')[0].trigger('click')
    await flushPromises()
    await wrapper.findAll('.kn-chip').find((c) => c.text().includes('贪心'))!.trigger('click')
    await flushPromises()
    await wrapper.findAll('.kn-chip').find((c) => c.text().includes('动态规划'))!.trigger('click')
    await flushPromises()
    const last = listPayloads[listPayloads.length - 1]
    expect(last.tags?.sort()).toEqual(['dp', 'greedy', '动态规划 DP', '贪心'].sort())
    expect(wrapper.find('.kn-summary-line').text()).toContain('已选 2 个知识点')
    expect(wrapper.findAll('.kn-chip.on')).toHaveLength(2)

    const clear = wrapper.findAll('button').find((b) => b.text().includes('全部清空'))!
    await clear.trigger('click')
    await flushPromises()
    expect(listPayloads[listPayloads.length - 1].tags).toEqual([])
    expect(wrapper.findAll('.kn-chip.on')).toHaveLength(0)
    wrapper.unmount()
  })

  it('普通标签 Tab 与知识点共用同一套选中状态（去掉标签后节点自动取消选中）', async () => {
    const { wrapper, listPayloads } = await mountPage()
    await wrapper.findAll('.seg-tab')[0].trigger('click')
    await flushPromises()
    await wrapper.findAll('.kn-chip').find((c) => c.text().includes('贪心'))!.trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.kn-chip.on')).toHaveLength(1)

    // 在「已选」条里移除标签 greedy → 节点不再完整选中
    const chip = wrapper.findAll('.sel-line .chip').find((c) => c.text().includes('greedy'))!
    await chip.trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.kn-chip.on')).toHaveLength(0)
    expect(listPayloads[listPayloads.length - 1].tags).toEqual(['贪心'])
    wrapper.unmount()
  })

  it('深链 ?knowledge=… （技能树「去题库练习」跳转）：自动切到知识点 Tab 并选中', async () => {
    const { wrapper, listPayloads } = await mountPage({ knowledge: 'greedy,dp' })
    await flushPromises()
    expect(activeCat(wrapper)).toContain('知识点')
    expect(wrapper.find('.kn-chips').exists()).toBe(true)
    expect(wrapper.findAll('.kn-chip.on')).toHaveLength(2)
    expect(wrapper.find('.kn-summary-line').text()).toContain('已选 2 个知识点')
    const last = listPayloads[listPayloads.length - 1]
    expect(last.tags?.sort()).toEqual(['dp', 'greedy', '动态规划 DP', '贪心'].sort())
    wrapper.unmount()
  })

  it('未选中任何筛选项时请求不带标签过滤', async () => {
    const { wrapper, listPayloads } = await mountPage()
    const first = listPayloads[0]
    expect(first.tags ?? []).toEqual([])
    expect(first.tagsAny).toBeUndefined()
    wrapper.unmount()
  })
})
