// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { IpcChannels } from '@shared/channels'
import SkillTreePage from '@/pages/SkillTreePage.vue'
import { SKILL_NODES } from '@shared/skill-tree'
import type { ListKnowledgeCoverage, MasteryTier, ProblemList, SkillNodeReport } from '@shared/types'

/**
 * 学习路径「仅显示题单知识点」（v1.21.0 FR-44）：
 * 选题单 → 勾选后只保留题单覆盖的知识点节点，连线同步收缩；取消勾选恢复全图。
 */

function nodeOf(id: string, tier: MasteryTier = 'untouched'): SkillNodeReport {
  const n = SKILL_NODES.find((x) => x.id === id)!
  return {
    id: n.id,
    name: n.name,
    layer: n.layer,
    tags: [...n.tags],
    dependsOn: [...n.dependsOn],
    intro: n.intro,
    stats: { attempted: 0, acProblems: 0, attempts: 0, acAttempts: 0, acc: null, hardSolved: 0, lastActiveDays: null, tagTotal: 1, coveredTags: 1 },
    tier,
    depsReady: n.dependsOn.length === 0
  }
}

const list: ProblemList = {
  id: 1,
  name: '蓝桥杯 2024 · 省 A',
  description: '往届比赛题单',
  origin: 'archive',
  trackId: 'lanqiao',
  createdAt: '2026-11-19 08:00:00',
  updatedAt: '2026-11-19 08:00:00',
  total: 2,
  doneCount: 0,
  reviewCount: 0,
  dueCount: 0
}

const coverage: ListKnowledgeCoverage = {
  listId: 1,
  listName: '蓝桥杯 2024 · 省 A',
  problemCount: 2,
  nodeIds: ['greedy', 'dp'],
  tags: ['贪心', '动态规划']
}

function setupApi(lists: ProblemList[] = [list], listCoverage: ListKnowledgeCoverage = coverage) {
  const calls: { channel: string; payload?: unknown }[] = []
  const nodes = SKILL_NODES.map((n) => nodeOf(n.id, n.id === 'impl' ? 'proficient' : 'untouched'))
  const api = {
    invoke: vi.fn(async (channel: string, payload?: unknown) => {
      calls.push({ channel, payload })
      const handlers: Record<string, () => unknown> = {
        [IpcChannels.SkillGet]: () => ({ nodes, recommendedIds: [], allDone: false, tracks: [] }),
        [IpcChannels.StatsTagUsage]: () => [],
        [IpcChannels.ListsList]: () => lists,
        [IpcChannels.SkillListCoverage]: () => listCoverage
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

async function mountPage(
  opts: { lists?: ProblemList[]; coverage?: ListKnowledgeCoverage } = {}
) {
  const ctx = setupApi(opts.lists, opts.coverage)
  const pinia = createPinia()
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/problems', component: { template: '<div />' } },
      { path: '/skills', component: { template: '<div />' } }
    ]
  })
  await router.push('/skills')
  await router.isReady()
  const wrapper = mount(SkillTreePage, { global: { plugins: [pinia, router] } })
  await flushPromises()
  await flushPromises()
  return { wrapper, router, ...ctx }
}

/**
 * v-show 用内联 style.display 控制显隐；jsdom 的 getComputedStyle 对切换后的元素
 * 会缓存旧值，所以直接看内联样式，与组件真实渲染一致。
 */
function isShown(w: { attributes: (name: string) => string | undefined; element: Element }) {
  return (w.element as HTMLElement).style.display !== 'none'
}

function visibleCards(wrapper: Awaited<ReturnType<typeof mountPage>>['wrapper']) {
  return wrapper.findAll('.node-card').filter(isShown)
}

describe('学习路径 · 仅显示题单知识点（v1.21.0 FR-44）', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    delete (window as unknown as { api?: unknown }).api
  })

  it('题单面板：默认不按题单过滤，列出已有题单与题数', async () => {
    const { wrapper } = await mountPage()
    const panel = wrapper.find('.list-panel')
    expect(panel.exists()).toBe(true)
    const select = panel.find('select')
    expect(select.findAll('option').map((o) => o.text())).toEqual([
      '（不按题单过滤）',
      '蓝桥杯 2024 · 省 A（2 题）'
    ])
    // 未选题单时开关不可用
    expect(panel.find('.only-track input').attributes('disabled')).toBeDefined()
    expect(visibleCards(wrapper)).toHaveLength(SKILL_NODES.length)
  })

  it('选题单 + 勾选「仅显示题单知识点」→ 只剩题单覆盖的节点，连线同步收缩', async () => {
    const { wrapper, calls } = await mountPage()
    const totalEdges = SKILL_NODES.reduce((s, n) => s + n.dependsOn.length, 0)
    expect(wrapper.findAll('.edges path')).toHaveLength(totalEdges)

    const panel = wrapper.find('.list-panel')
    await panel.find('select').setValue('1')
    await flushPromises()
    expect(panel.find('.only-track input').attributes('disabled')).toBeUndefined()
    expect(panel.text()).toContain('共 2 题')
    expect(panel.text()).toContain('覆盖')

    await panel.find('.only-track input').setValue(true)
    await flushPromises()
    await flushPromises()

    expect(calls.some((c) => c.channel === IpcChannels.SkillListCoverage)).toBe(true)
    expect(panel.text()).toContain('覆盖 2 个知识点')
    const visible = visibleCards(wrapper)
    expect(visible).toHaveLength(2)
    expect(visible.map((c) => c.attributes('data-node')).sort()).toEqual(['dp', 'greedy'])
    // 只剩 greedy → dp 这一条依赖边（dp 的其他前置被隐藏）
    expect(wrapper.findAll('.edges path')).toHaveLength(1)
    // 层标题按可见节点计数，空层隐藏
    const layerText = wrapper.findAll('.layer-head').filter(isShown).map((l) => l.text())
    expect(layerText.join('|')).toContain('（1 个知识点）')
  })

  it('取消勾选恢复全部节点与连线', async () => {
    const { wrapper } = await mountPage()
    const total = SKILL_NODES.length
    const totalEdges = SKILL_NODES.reduce((s, n) => s + n.dependsOn.length, 0)
    await wrapper.find('.list-panel select').setValue('1')
    await flushPromises()
    await wrapper.find('.list-panel .only-track input').setValue(true)
    await flushPromises()
    await flushPromises()
    expect(visibleCards(wrapper).length).toBeLessThan(total)

    await wrapper.find('.list-panel .only-track input').setValue(false)
    await flushPromises()
    await flushPromises()
    expect(visibleCards(wrapper)).toHaveLength(total)
    expect(wrapper.findAll('.edges path')).toHaveLength(totalEdges)
  })

  it('还没有题单时给出新建引导', async () => {
    const { wrapper } = await mountPage({ lists: [] })
    expect(wrapper.find('.list-panel').text()).toContain('还没有题单')
  })
})
