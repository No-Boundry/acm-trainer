// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { IpcChannels } from '@shared/channels'
import ProblemsPage from '@/pages/ProblemsPage.vue'
import type { ProblemRow, SkillNodeReport } from '@shared/types'

/**
 * 题库页「知识点筛选」组件测试。
 * v1.8 FR-17 知识点面板 → v1.13 并入标签分栏第一个 Tab →
 * **v1.20 FR-41 标签大类全部整合进知识点，筛选区只剩「知识点」一个维度**
 * （所以这里不再有 `.seg-tab` 标签 Tab，也不再有 `.tag-row` 裸标签列表）。
 * 选中节点 = 选中该节点的全部关联标签（与标签共用 store.filter.tags，不发 tagsAny）。
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
      // 单标签节点：用来验证「只选 1 个标签时没有命中角标」
      id: 'dsu',
      name: '并查集',
      layer: 2,
      tags: ['dsu'],
      dependsOn: ['greedy'],
      intro: '并查集简介',
      stats: stats(1, 1),
      tier: 'newbie',
      depsReady: true
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
  ac?: string
}

function setupApi(rows: ProblemRow[] = [row]) {
  const listPayloads: ListPayload[] = []
  const api = {
    invoke: vi.fn(async (channel: string) => {
      const handlers: Record<string, () => unknown> = {
        [IpcChannels.SkillGet]: () => ({ nodes: skillNodes(), recommendedIds: ['greedy'], allDone: false }),
        [IpcChannels.ProblemsList]: (() => ({ total: rows.length, items: rows })) as unknown as () => unknown,
        [IpcChannels.ProblemsTags]: () => ['greedy', 'dp'],
        [IpcChannels.ProblemsLastSync]: () => ({ cf: '2026-09-01 00:00:00', luogu: null }),
        [IpcChannels.ProblemsNote]: () => null
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

async function mountPage(query: Record<string, string> = {}, rows: ProblemRow[] = [row]) {
  const ctx = setupApi(rows)
  const router = makeRouter()
  await router.push({ path: '/problems', query })
  await router.isReady()
  const wrapper = mount(ProblemsPage, { global: { plugins: [createPinia(), router] } })
  await flushPromises()
  await flushPromises()
  return { wrapper, router, ...ctx }
}

/** 取某个知识点 chip（按名字） */
function knChip(wrapper: ReturnType<typeof mount>, name: string) {
  const chip = wrapper.findAll('.kn-chip').find((c) => c.text().includes(name))
  expect(chip, `找不到知识点 chip「${name}」`).toBeTruthy()
  return chip!
}

describe('ProblemsPage 知识点筛选（v1.20 FR-41：唯一筛选维度）', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    delete (window as unknown as { api?: unknown }).api
  })

  it('筛选区只剩知识点：没有标签大类 Tab，也没有裸标签列表', async () => {
    const { wrapper } = await mountPage()
    expect(wrapper.find('.kn-picker').exists()).toBe(true)
    // v1.20：原来的「知识点 Tab + 6 个标签大类 Tab」全部移除
    expect(wrapper.findAll('.seg-tab')).toHaveLength(0)
    expect(wrapper.find('.tag-row').exists()).toBe(false)
    expect(wrapper.find('.kn-title').text()).toContain('知识点')
    wrapper.unmount()
  })

  it('分层分组 + 掌握度色点 + 已练/已 AC 题数 + 掌握概览', async () => {
    const { wrapper } = await mountPage()
    const chips = wrapper.findAll('.kn-chip')
    expect(chips).toHaveLength(4)
    const disabled = chips.find((c) => c.text().includes('综合模拟与比赛策略'))!
    expect(disabled.classes()).toContain('disabled')
    const greedy = knChip(wrapper, '贪心')
    expect(greedy.text()).toContain('3/2')
    expect(greedy.find('.dot').exists()).toBe(true)
    expect(wrapper.text()).toContain('L1')
    expect(wrapper.text()).toContain('L2')
    expect(greedy.attributes('title')).toContain('关联标签 2 个')
    // 掌握概览：练习中 1 / 未开始 1 / 初学 2
    const summary = wrapper.find('.kn-summary-line')
    expect(summary.exists()).toBe(true)
    expect(summary.text()).toContain('练习中 1')
    expect(summary.text()).toContain('未开始 1')
    wrapper.unmount()
  })

  it('点击知识点 → 其关联标签进入统一 tags 筛选（不再发送 tagsAny）', async () => {
    const { wrapper, listPayloads } = await mountPage()

    await knChip(wrapper, '贪心').trigger('click')
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
    await knChip(wrapper, '贪心').trigger('click')
    await flushPromises()
    last = listPayloads[listPayloads.length - 1]
    expect(last.tags).toEqual([])
    expect(wrapper.findAll('.kn-chip.on')).toHaveLength(0)
    wrapper.unmount()
  })

  it('多个知识点可叠加（标签并集）；「全部清空」一次性还原', async () => {
    const { wrapper, listPayloads } = await mountPage()
    await knChip(wrapper, '贪心').trigger('click')
    await flushPromises()
    await knChip(wrapper, '动态规划').trigger('click')
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

  it('在「已选」条里移除标签 → 节点自动取消选中', async () => {
    const { wrapper, listPayloads } = await mountPage()
    await knChip(wrapper, '贪心').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.kn-chip.on')).toHaveLength(1)

    const chip = wrapper.findAll('.sel-line .chip').find((c) => c.text().includes('greedy'))!
    await chip.trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.kn-chip.on')).toHaveLength(0)
    expect(listPayloads[listPayloads.length - 1].tags).toEqual(['贪心'])
    wrapper.unmount()
  })

  it('深链 ?knowledge=…（技能树「去题库练习」跳转）：选中对应节点', async () => {
    const { wrapper, listPayloads } = await mountPage({ knowledge: 'greedy,dp' })
    await flushPromises()
    expect(wrapper.find('.kn-chips').exists()).toBe(true)
    expect(wrapper.findAll('.kn-chip.on')).toHaveLength(2)
    expect(wrapper.find('.kn-summary-line').text()).toContain('已选 2 个知识点')
    const last = listPayloads[listPayloads.length - 1]
    expect(last.tags?.sort()).toEqual(['dp', 'greedy', '动态规划 DP', '贪心'].sort())
    wrapper.unmount()
  })

  it('深链 ?ac=notac（技能树「排除已 AC」）：请求带 ac 过滤，且可一键清除', async () => {
    const { wrapper, listPayloads } = await mountPage({ knowledge: 'greedy', ac: 'notac' })
    await flushPromises()
    expect(listPayloads[listPayloads.length - 1].ac).toBe('notac')
    const line = wrapper.find('.ac-line')
    expect(line.exists()).toBe(true)
    expect(line.text()).toContain('排除已 AC')

    await wrapper.find('.ac-line .chip').trigger('click')
    await flushPromises()
    expect(listPayloads[listPayloads.length - 1].ac).toBe('all')
    expect(wrapper.find('.ac-line').exists()).toBe(false)
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

describe('ProblemsPage 标签命中数（v1.17 并集 + 按命中数排序）', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    delete (window as unknown as { api?: unknown }).api
  })

  const multiTagRow: ProblemRow = {
    ...row,
    id: '1:E',
    index: 'E',
    name: 'Greedy + DP',
    rating: 1200,
    tags: ['greedy', '贪心', 'dp']
  }

  it('命中多个标签时显示「命中 N/M」角标', async () => {
    const { wrapper } = await mountPage({}, [multiTagRow])
    await knChip(wrapper, '贪心').trigger('click')
    await flushPromises()
    // 贪心节点两个标签 greedy + 贪心，题目都命中 → 2/2
    const badge = wrapper.find('.mini-tag.match')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toBe('命中 2/2')
    expect(badge.attributes('title')).toContain('2 / 2')
    wrapper.unmount()
  })

  it('「已选」条提示并集与命中数排序', async () => {
    const { wrapper } = await mountPage({}, [multiTagRow])
    await knChip(wrapper, '贪心').trigger('click')
    await flushPromises()
    const hint = wrapper.find('.match-hint')
    expect(hint.exists()).toBe(true)
    expect(hint.text()).toContain('取并集')
    expect(hint.text()).toContain('命中标签越多越靠前')
    wrapper.unmount()
  })

  it('只选一个标签时不显示命中角标与提示（无排序意义）', async () => {
    const { wrapper } = await mountPage({}, [row])
    await knChip(wrapper, '并查集').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.sel-line .chip').length).toBe(1)
    expect(wrapper.find('.mini-tag.match').exists()).toBe(false)
    expect(wrapper.find('.match-hint').exists()).toBe(false)
    wrapper.unmount()
  })
})
