// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { IpcChannels } from '@shared/channels'
import { SKILL_NODES } from '@shared/skill-tree'
import SkillTreePage from '@/pages/SkillTreePage.vue'
import type { ProblemRow, SkillNodeReport, SkillReport } from '@shared/types'

/**
 * 技能树页面组件测试（v1.6 FR-9.4）：mock window.api，
 * 验证分层渲染 / 状态着色 / 锁定与推荐 / 详情面板与荐题 / 题面联动收起。
 */

function makeStats(over: Partial<SkillNodeReport['stats']> = {}): SkillNodeReport['stats'] {
  return {
    attempted: 0,
    acProblems: 0,
    attempts: 0,
    acAttempts: 0,
    acc: null,
    hardSolved: 0,
    lastActiveDays: null,
    ...over
  }
}

function node(over: Partial<SkillNodeReport> & { id: string; name: string }): SkillNodeReport {
  return {
    layer: 0,
    tags: [],
    dependsOn: [],
    intro: '该知识点的内置中文简介，说明其定位与典型应用场景。',
    stats: makeStats(),
    tier: 'untouched',
    depsReady: false,
    ...over
  }
}

function buildReport(): SkillReport {
  return {
    nodes: [
      node({
        id: 'sort',
        name: '排序',
        layer: 0,
        tags: ['sorting'],
        intro: '排序的简介：让数据有序并支撑后续算法。',
        stats: makeStats({ attempted: 3, acProblems: 2, attempts: 5, acAttempts: 3, acc: 0.6, hardSolved: 1, lastActiveDays: 2 }),
        tier: 'proficient',
        depsReady: true
      }),
      node({
        id: 'greedy',
        name: '贪心',
        layer: 1,
        tags: ['greedy'],
        dependsOn: ['sort'],
        stats: makeStats({ attempted: 1, acProblems: 0, attempts: 1, acAttempts: 0, acc: 0, lastActiveDays: 9 }),
        tier: 'newbie',
        depsReady: true
      }),
      node({
        id: 'dp',
        name: 'DP',
        layer: 2,
        tags: ['dp', '动态规划 DP'],
        dependsOn: ['greedy'],
        intro: '动态规划入门简介：用状态记录子问题答案避免重复计算。',
        stats: makeStats(),
        tier: 'untouched',
        depsReady: false
      })
    ],
    recommendedIds: ['greedy'],
    allDone: false
  }
}

function makeProblems(): ProblemRow[] {
  return [
    {
      id: '455A',
      contestId: 455,
      index: 'A',
      name: 'Boredom',
      rating: 1500,
      difficulty: null,
      solvedCount: 100,
      totalSubmit: 200,
      source: 'cf',
      cfUrl: 'https://codeforces.com/problemset/problem/455/A',
      fetchedAt: '2026-01-01T00:00:00.000Z',
      tags: ['dp']
    },
    {
      id: 'P1002',
      contestId: 0,
      index: '',
      name: '过河卒',
      rating: null,
      difficulty: 4,
      solvedCount: 50,
      totalSubmit: 80,
      source: 'luogu',
      cfUrl: '',
      fetchedAt: '2026-01-01T00:00:00.000Z',
      tags: ['dp']
    }
  ]
}

type Handler = (payload?: unknown) => unknown

function setupApi(report: SkillReport) {
  const problemsPayloads: unknown[] = []
  const recordsPayloads: unknown[] = []
  const api = {
    invoke: vi.fn(async (channel: string, payload?: unknown) => {
      // 结构化克隆回归防护（与 stores.test 一致）
      let cloned: unknown
      try {
        cloned = structuredClone(payload)
      } catch {
        return { ok: false, error: { code: 'CLONE_FAILED', message: "An object couldn't be cloned" } }
      }
      const handlers: Record<string, Handler> = {
        [IpcChannels.SkillGet]: () => report,
        [IpcChannels.ProblemsList]: (p) => {
          problemsPayloads.push(p)
          // v1.8 双源推荐：按请求 source 返回对应题源的题目
          const all = makeProblems()
          const items = p.source === 'luogu' ? all.filter((x) => x.source === 'luogu') : all.filter((x) => x.source === 'cf')
          return { total: items.length, items }
        },
        [IpcChannels.StatementGet]: () => null, // v2.0：本地题面（未抓取 → null）
        [IpcChannels.RecordsCreate]: (p) => {
          recordsPayloads.push(p)
          return { ok: true }
        }
      }
      const h = handlers[channel]
      if (!h) return { ok: false, error: { code: 'NO_HANDLER', message: `no handler: ${channel}` } }
      try {
        return { ok: true, data: await h(cloned) }
      } catch (e) {
        return { ok: false, error: { code: 'TEST', message: String(e) } }
      }
    }),
    on: vi.fn(() => () => undefined)
  }
  // jsdom 环境：保留真实 window（addEventListener 等），只注入 window.api
  ;(window as unknown as { api: unknown }).api = api
  return { api, problemsPayloads, recordsPayloads }
}

async function mountPage(
  report: SkillReport
): Promise<{
  wrapper: VueWrapper
  api: { invoke: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> }
  problemsPayloads: unknown[]
  recordsPayloads: unknown[]
}> {
  const mocks = setupApi(report)
  const wrapper = mount(SkillTreePage, {
    global: { plugins: [createPinia()] }
  })
  await flushPromises()
  await flushPromises()
  return { wrapper, ...mocks }
}

describe('SkillTreePage 技能树页面', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    delete (window as unknown as { api?: unknown }).api
  })

  it('分层渲染：自下而上（L2→L0），图例与推荐提示条存在', async () => {
    const { wrapper } = await mountPage(buildReport())
    const layerNames = wrapper.findAll('.layer-name').map((n) => n.text())
    expect(layerNames).toHaveLength(3)
    expect(layerNames[0]).toContain('L2')
    expect(layerNames[2]).toContain('L0')
    expect(wrapper.find('.head').text()).toContain('未开始')
    expect(wrapper.findAll('.node-card')).toHaveLength(3)
    wrapper.unmount()
  })

  it('依赖连线：树渲染完成后 SVG 路径数与依赖边一致（回归：测量须在 loading=false 之后）', async () => {
    const { wrapper } = await mountPage(buildReport())
    // fixture 依赖边：greedy→sort、dp→greedy，共 2 条
    const paths = wrapper.findAll('.edges path')
    expect(paths).toHaveLength(2)
    expect(paths[0].attributes('d')).toBeTruthy()
    expect(paths[1].attributes('d')).toBeTruthy()
    wrapper.unmount()
  })

  it('状态着色类与推荐星标：done / locked / recommended 正确', async () => {
    const { wrapper } = await mountPage(buildReport())
    const byNode = (id: string) => wrapper.find(`[data-node="${id}"]`)
    expect(byNode('sort').classes()).toContain('done')
    expect(byNode('sort').classes()).not.toContain('locked')
    expect(byNode('dp').classes()).toContain('locked')
    expect(byNode('greedy').classes()).toContain('recommended')
    expect(byNode('greedy').find('.star').exists()).toBe(true)
    expect(byNode('sort').find('.lock').exists()).toBe(false)
    expect(wrapper.findAll('.rec-pill').map((p) => p.text())).toEqual(['贪心'])
    wrapper.unmount()
  })

  it('点击节点打开资料卡：简介 + 构成统计 + 锁定提示（v1.8：不再含题单）', async () => {
    const { wrapper } = await mountPage(buildReport())
    await wrapper.find('[data-node="dp"]').trigger('click')
    await flushPromises()
    const detail = wrapper.find('.detail')
    expect(detail.exists()).toBe(true)
    expect(detail.text()).toContain('DP')
    // v1.7 FR-11：顶部内置简介
    const intro = detail.find('.node-intro')
    expect(intro.exists()).toBe(true)
    expect(intro.text()).toContain('动态规划入门简介')
    expect(detail.text()).toContain('前置未达标')
    // v1.8：资料卡移除推荐练习题单
    expect(detail.find('.rec-problems').exists()).toBe(false)
    expect(detail.text()).not.toContain('推荐练习')
    wrapper.unmount()
  })

  it('全部达标（allDone）→ 提示语且无推荐条', async () => {
    const allDone = buildReport()
    allDone.allDone = true
    allDone.recommendedIds = []
    const { wrapper } = await mountPage(allDone)
    expect(wrapper.find('.head').text()).toContain('全部知识点已达标')
    expect(wrapper.findAll('.rec-pill')).toHaveLength(0)
    wrapper.unmount()
  })

  it('skill:get 失败 → 无树渲染、不崩溃', async () => {
    const mocks = setupApi(buildReport())
    mocks.api.invoke.mockImplementationOnce(async (channel: string) => {
      if (channel === IpcChannels.SkillGet) {
        return { ok: false, error: { code: 'SKILL_FAIL', message: '统计失败' } }
      }
      return { ok: false, error: { code: 'NO_HANDLER', message: 'x' } }
    })
    const wrapper = mount(SkillTreePage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(wrapper.find('.layer').exists()).toBe(false)
    expect(wrapper.find('.detail').exists()).toBe(false)
    expect(mocks.api.invoke).toHaveBeenCalledWith(IpcChannels.SkillGet, undefined)
    wrapper.unmount()
  })

  it('真实规模（内置图谱全部节点）：7 面板 L6→L0、卡片数 = 节点数、连线数 = 依赖边数', async () => {
    // 用真实内置图谱构造全量报告（全未开始：L0 可学，其余前置未达标）
    const realNodes: SkillNodeReport[] = SKILL_NODES.map((n) => ({
      id: n.id,
      name: n.name,
      layer: n.layer,
      tags: [...n.tags],
      dependsOn: [...n.dependsOn],
      intro: n.intro,
      stats: makeStats(),
      tier: 'untouched',
      depsReady: n.dependsOn.length === 0
    }))
    const totalEdges = realNodes.reduce((s, n) => s + n.dependsOn.length, 0)
    const { wrapper } = await mountPage({
      nodes: realNodes,
      recommendedIds: [],
      allDone: false
    })
    const layerNames = wrapper.findAll('.layer-name').map((x) => x.text())
    expect(layerNames).toHaveLength(7)
    expect(layerNames[0]).toContain('L6')
    expect(layerNames[6]).toContain('L0')
    expect(wrapper.findAll('.node-card')).toHaveLength(SKILL_NODES.length)
    // 全未开始时：L0 五节点不应带锁，其余全部锁定
    expect(wrapper.findAll('.node-card.locked')).toHaveLength(SKILL_NODES.length - 5)
    expect(wrapper.findAll('.edges path')).toHaveLength(totalEdges)
    wrapper.unmount()
  })

  it('焦点高亮：悬停节点只点亮直连依赖线（fixture 边：greedy→sort、dp→greedy）', async () => {
    const { wrapper } = await mountPage(buildReport())
    const paths = wrapper.findAll('.edges path')
    expect(paths).toHaveLength(2)
    // 无焦点：全部普通态
    expect(paths[0].classes()).not.toContain('active')
    expect(paths[1].classes()).not.toContain('active')
    // 悬停 dp：dp→greedy 点亮，greedy→sort 仍普通
    await wrapper.find('[data-node="dp"]').trigger('mouseenter')
    expect(paths[0].classes()).not.toContain('active')
    expect(paths[1].classes()).toContain('active')
    // 移出后熄灭
    await wrapper.find('[data-node="dp"]').trigger('mouseleave')
    expect(paths[1].classes()).not.toContain('active')
    // 点击选中 greedy：greedy→sort 点亮（详情面板打开，连线仍可追踪）
    await wrapper.find('[data-node="greedy"]').trigger('click')
    await flushPromises()
    expect(paths[0].classes()).toContain('active')
    expect(wrapper.find('.detail').exists()).toBe(true)
    wrapper.unmount()
  })
})
