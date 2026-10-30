// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { IpcChannels } from '@shared/channels'
import SkillTreePage from '@/pages/SkillTreePage.vue'
import { useProblemsStore } from '@/stores/problems'
import type { SkillNodeReport, SkillReport } from '@shared/types'

/**
 * 学习路径「单个知识点跳题库」（v1.9.1）：
 * ① 节点详情面板按钮；② 卡片悬浮 📚 快捷按钮。两者都只选中该节点。
 * 综合节点（无关联标签，如 final_sprint）不可跳转（按钮禁用 / 卡片按钮给出提示）。
 */

function node(partial: Partial<SkillNodeReport> & { id: string; name: string }): SkillNodeReport {
  return {
    layer: 1,
    tags: ['greedy', '贪心'],
    dependsOn: [],
    intro: '这是一个长度足够的节点简介，用于测试渲染，不需要真实语义。',
    stats: {
      attempted: 3,
      acProblems: 2,
      attempts: 4,
      acAttempts: 2,
      acc: 0.5,
      hardSolved: 0,
      lastActiveDays: 2
    },
    tier: 'learning',
    depsReady: true,
    ...partial
  }
}

const report: SkillReport = {
  nodes: [
    node({ id: 'greedy', name: '贪心', tags: ['greedy', '贪心'] }),
    node({ id: 'dp', name: '动态规划入门', tags: ['dp', '动态规划'], dependsOn: ['greedy'] }),
    node({ id: 'final_sprint', name: '综合模拟与比赛策略', tags: [], layer: 6, tier: 'untouched', depsReady: false })
  ],
  recommendedIds: ['greedy'],
  allDone: false
}

function setupApi() {
  const api = {
    invoke: vi.fn(async (channel: string) => {
      if (channel === IpcChannels.SkillGet) return { ok: true, data: report }
      if (channel === IpcChannels.ProblemsList) return { ok: true, data: { total: 0, items: [] } }
      if (channel === IpcChannels.ProblemsTags) return { ok: true, data: [] }
      if (channel === IpcChannels.ProblemsLastSync) return { ok: true, data: { cf: null, luogu: null, leetcode: null } }
      if (channel === IpcChannels.StatementOpen) return { ok: true, data: { ok: true, via: 'edge' } }
      if (channel === IpcChannels.StatsTagUsage)
        return {
          ok: true,
          data: [
            { tag: 'greedy', attempted: 3, acProblems: 2, lastAt: null, lastActiveDays: 2, totalProblems: 5, progress: 0.4 },
            { tag: '贪心', attempted: 1, acProblems: 1, lastAt: null, lastActiveDays: 2, totalProblems: 4, progress: 0.25 }
          ]
        }
      return { ok: false, error: { code: 'NO_HANDLER', message: channel } }
    }),
    on: vi.fn(() => () => undefined)
  }
  ;(window as unknown as { api: unknown }).api = api
  return api
}

async function mountPage() {
  setupApi()
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/problems', component: { template: '<div />' } },
      { path: '/skill', component: { template: '<div />' } }
    ]
  })
  await router.push('/skill')
  await router.isReady()
  const wrapper = mount(SkillTreePage, { global: { plugins: [pinia, router] } })
  await flushPromises()
  await flushPromises()
  return { wrapper, router, store: useProblemsStore() }
}

describe('学习路径 → 题库（单个知识点）', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    delete (window as unknown as { api?: unknown }).api
  })

  it('详情面板：选中节点后出现「去题库练习」按钮，点击只选中该节点（v1.14 支持手动选标签）', async () => {
    const { wrapper, router, store } = await mountPage()
    await wrapper.find('.node-card[data-node="greedy"]').trigger('click')
    await flushPromises()

    const btn = wrapper.find('.go-node-problems')
    expect(btn.exists()).toBe(true)
    expect(btn.text()).toContain('📚 去题库练习')
    expect(btn.text()).toContain('选中 2 个标签')
    expect(btn.attributes('disabled')).toBeUndefined()

    await btn.trigger('click')
    await flushPromises()

    expect(store.knowledgeIds).toEqual(['greedy'])
    expect(store.knowledgeOpenRequested).toBe(true)
    expect(router.currentRoute.value.path).toBe('/problems')
    expect(router.currentRoute.value.query.knowledge).toBe('greedy')
    // 默认全选该节点的关联标签
    expect(router.currentRoute.value.query.tags).toBe('greedy,贪心')
  })

  it('切到另一个节点后按钮选中随之改变（不会保留上一个节点）', async () => {
    const { wrapper, router, store } = await mountPage()
    await wrapper.find('.node-card[data-node="greedy"]').trigger('click')
    await wrapper.find('.go-node-problems').trigger('click')
    await flushPromises()
    expect(store.knowledgeIds).toEqual(['greedy'])

    await router.push('/skill')
    await wrapper.find('.node-card[data-node="dp"]').trigger('click')
    await wrapper.find('.go-node-problems').trigger('click')
    await flushPromises()
    expect(store.knowledgeIds).toEqual(['dp'])
    expect(router.currentRoute.value.query.knowledge).toBe('dp')
  })

  it('卡片 📚 快捷按钮：不打开详情面板也能跳转', async () => {
    const { wrapper, router, store } = await mountPage()
    const go = wrapper.find('.node-card[data-node="dp"] .card-go')
    expect(go.exists()).toBe(true)

    await go.trigger('click')
    await flushPromises()

    expect(store.knowledgeIds).toEqual(['dp'])
    expect(router.currentRoute.value.query.knowledge).toBe('dp')
    // stop 生效：没有因为这次点击选中节点（详情面板不出现）
    expect(wrapper.find('.detail').exists()).toBe(false)
  })

  it('综合节点（无标签）：详情按钮禁用、卡片按钮不跳转', async () => {
    const { wrapper, router, store } = await mountPage()
    await wrapper.find('.node-card[data-node="final_sprint"]').trigger('click')
    await flushPromises()

    const btn = wrapper.find('.go-node-problems')
    expect(btn.attributes('disabled')).toBeDefined()
    expect(btn.text()).toContain('选中 0 个标签')

    await btn.trigger('click')
    await flushPromises()
    expect(store.knowledgeIds).toEqual([])
    expect(router.currentRoute.value.path).toBe('/skill')

    await wrapper.find('.node-card[data-node="final_sprint"] .card-go').trigger('click')
    await flushPromises()
    expect(store.knowledgeIds).toEqual([])
    expect(router.currentRoute.value.path).toBe('/skill')
  })

  // ===== v1.14 FR-32：详情面板手动选取关联标签 =====
  it('详情面板标签可点击取消/恢复（手动选取）', async () => {
    const { wrapper, router, store } = await mountPage()
    await wrapper.find('.node-card[data-node="greedy"]').trigger('click')
    await flushPromises()

    const chips = wrapper.findAll('.tag-pick')
    expect(chips.length).toBe(2)
    expect(chips.every((c) => c.classes().includes('on'))).toBe(true)

    // 取消勾选 '贪心'
    await wrapper.find('.tag-pick[data-tag="贪心"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('.tag-pick[data-tag="贪心"]').classes()).not.toContain('on')
    expect(wrapper.find('.go-node-problems').text()).toContain('选中 1 个标签')

    await wrapper.find('.go-node-problems').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.tags).toBe('greedy')
    expect(store.tagOverride).toEqual(['greedy'])
  })

  it('「全选默认标签」恢复该节点的全部关联标签', async () => {
    const { wrapper } = await mountPage()
    await wrapper.find('.node-card[data-node="greedy"]').trigger('click')
    await flushPromises()

    await wrapper.find('.tag-pick[data-tag="贪心"]').trigger('click')
    await wrapper.find('.tag-pick[data-tag="greedy"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('.go-node-problems').text()).toContain('选中 0 个标签')
    expect(wrapper.find('.go-node-problems').attributes('disabled')).toBeDefined()

    const reset = wrapper.findAll('button').find((b) => b.text().includes('全选默认标签'))
    await reset!.trigger('click')
    await flushPromises()
    expect(wrapper.find('.go-node-problems').text()).toContain('选中 2 个标签')
  })

  it('标签携带题库题数/已 AC 数（来自 stats:tagUsage）', async () => {
    const { wrapper } = await mountPage()
    await wrapper.find('.node-card[data-node="greedy"]').trigger('click')
    await flushPromises()
    const greedyChip = wrapper.find('.tag-pick[data-tag="greedy"]')
    expect(greedyChip.exists()).toBe(true)
    // 有 AC → 显示 ✓2；标题含题库题数与已练
    expect(greedyChip.text()).toContain('✓2')
    expect(greedyChip.classes()).toContain('done')
    expect(greedyChip.attributes('title')).toContain('题库 5 题')
  })
})
