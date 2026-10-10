// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { IpcChannels } from '@shared/channels'
import ProblemsPage from '@/pages/ProblemsPage.vue'
import type { ProblemRow, SkillNodeReport } from '@shared/types'

/**
 * 题库页「知识点筛选」UI 组件测试（v1.8 FR-17）：
 * 分层标签 + 掌握度色点 + 已练/已 AC 题数、多选并集筛选载荷、清空。
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

function setupApi() {
  const listPayloads: { tagsAny?: string[] }[] = []
  const api = {
    invoke: vi.fn(async (channel: string) => {
      const handlers: Record<string, () => unknown> = {
        [IpcChannels.SkillGet]: () => ({ nodes: skillNodes(), recommendedIds: ['greedy'], allDone: false }),
        [IpcChannels.ProblemsList]: (() => ({ total: 1, items: [row] })) as unknown as () => unknown,
        [IpcChannels.ProblemsTags]: () => ['greedy', 'dp'],
        [IpcChannels.ProblemsLastSync]: () => ({ cf: '2026-09-01 00:00:00', luogu: null })
      }
      // 记录 problems:list 的载荷
      const h = handlers[channel]
      if (!h) return { ok: false, error: { code: 'NO_HANDLER', message: channel } }
      return { ok: true, data: await h() }
    }),
    on: vi.fn(() => () => undefined)
  }
  // 单独包一层以捕获 problems:list 载荷
  const original = api.invoke
  api.invoke = vi.fn(async (channel: string, payload?: unknown) => {
    if (channel === IpcChannels.ProblemsList) {
      listPayloads.push(payload as { tagsAny?: string[] })
    }
    return original(channel, payload)
  }) as unknown as typeof original
  ;(window as unknown as { api: unknown }).api = api
  return { api, listPayloads }
}

/** ProblemsPage 使用 vue-router（useRoute/useRouter），测试需提供内存路由 */
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

describe('ProblemsPage 知识点筛选（v1.8 FR-17）', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    delete (window as unknown as { api?: unknown }).api
  })

  it('渲染知识点筛选区块：分层分组 + 掌握度色点 + 已练/已 AC 题数', async () => {
    const { wrapper } = await mountPage()
    const panel = wrapper.find('.kn-panel')
    expect(panel.exists()).toBe(true)
    // 展开
    await panel.find('.kn-toggle').trigger('click')
    const chips = wrapper.findAll('.kn-chip')
    expect(chips).toHaveLength(3) // 贪心 / 动态规划入门 / 综合节点
    const disabled = chips.find((c) => c.text().includes('综合模拟与比赛策略'))!
    expect(disabled.classes()).toContain('disabled')
    expect(disabled.attributes('disabled')).toBeDefined()
    const greedy = chips.find((c) => c.text().includes('贪心'))!
    expect(greedy.text()).toContain('3/2') // 已练 3 / 已 AC 2
    expect(greedy.find('.dot').exists()).toBe(true)
    // 分层标注存在（L1 / L2）
    expect(panel.text()).toContain('L1')
    expect(panel.text()).toContain('L2')
    // 题源提示：贪心同时具备 CF 与洛谷标签
    expect(greedy.attributes('title')).toContain('可筛出 Codeforces 与洛谷题')

    // 整体掌握概览（五档计数，仅渲染存在的档位）
    const summary = wrapper.find('.kn-summary')
    expect(summary.exists()).toBe(true)
    expect(summary.text()).toContain('练习中 1')
    expect(summary.text()).toContain('未开始 1')
    wrapper.unmount()
  })

  it('点击知识点 → 请求携带 tagsAny 并集；再次点击取消；清空按钮还原', async () => {
    const { wrapper, listPayloads } = await mountPage()
    await wrapper.find('.kn-panel .kn-toggle').trigger('click')
    const chips = wrapper.findAll('.kn-chip')
    const greedy = chips.find((c) => c.text().includes('贪心'))!
    const dp = chips.find((c) => c.text().includes('动态规划'))!

    await greedy.trigger('click')
    await flushPromises()
    let last = listPayloads[listPayloads.length - 1]
    expect(last.tagsAny?.sort()).toEqual(['greedy', '贪心'].sort())

    await dp.trigger('click')
    await flushPromises()
    last = listPayloads[listPayloads.length - 1]
    expect(last.tagsAny?.sort()).toEqual(['dp', 'greedy', '动态规划 DP', '贪心'].sort())

    // 顶部显示已选数量 + 清空
    expect(wrapper.find('.kn-panel').text()).toContain('已选 2 个知识点')
    const clear = wrapper.findAll('button').find((b) => b.text().includes('清空知识点'))!
    await clear.trigger('click')
    await flushPromises()
    last = listPayloads[listPayloads.length - 1]
    expect(last.tagsAny).toEqual([])
    wrapper.unmount()
  })

  it('深链 ?knowledge=… （技能树「去题库练习」跳转）：自动展开并选中对应知识点', async () => {
    const { wrapper, listPayloads } = await mountPage({ knowledge: 'greedy,dp' })
    await flushPromises()
    // 面板自动展开
    expect(wrapper.find('.kn-panel .kn-chips').exists()).toBe(true)
    // 两个知识点均处于选中态
    const onChips = wrapper.findAll('.kn-chip.on')
    expect(onChips).toHaveLength(2)
    expect(wrapper.find('.kn-panel').text()).toContain('已选 2 个知识点')
    // 请求携带并集标签（取携带非空 tagsAny 的请求，避免受并发顺序影响）
    const withTags = listPayloads.filter((x) => (x.tagsAny ?? []).length > 0)
    expect(withTags.length).toBeGreaterThan(0)
    expect(withTags[withTags.length - 1].tagsAny?.sort()).toEqual(
      ['dp', 'greedy', '动态规划 DP', '贪心'].sort()
    )
    wrapper.unmount()
  })

  it('未选中知识点时请求不带过滤（tagsAny 为空数组）', async () => {
    const { wrapper, listPayloads } = await mountPage()
    const first = listPayloads[0]
    expect(first.tagsAny).toEqual([])
    wrapper.unmount()
  })
})
