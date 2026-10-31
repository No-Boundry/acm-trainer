// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createWebHashHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { IpcChannels } from '@shared/channels'
import DashboardPage from '@/pages/DashboardPage.vue'
import { useProblemsStore } from '@/stores/problems'
import type { RecommendResult, RecommendedProblem, StatsResult, TagUsage } from '@shared/types'

/**
 * 首页「推荐习题」+「已练习标签」（v1.14 FR-31~FR-33）。
 *
 * 断言：
 * - 推荐分已练习 / 未练习两栏，展示排序方式文案与数量；
 * - 已练习条目显示状态徽章、理由、题单归属；
 * - 点标签可筛选（带 filterTags 重新请求）、可清空；
 * - 点条目跳到题库并带 q=题号；
 * - 设置项 recommendShowTags=false 时隐藏标签面板。
 */

const stats: StatsResult = {
  totalAttempts: 4,
  acCount: 3,
  accuracy: 75,
  distinctProblems: 3,
  practiceSeconds: 600,
  daily: [],
  weekly: [],
  tagStats: []
}

function recItem(id: string, extra: Partial<RecommendedProblem> = {}): RecommendedProblem {
  return {
    problem: {
      id,
      contestId: 1,
      index: 'A',
      name: `题目 ${id}`,
      rating: 1500,
      difficulty: null,
      solvedCount: 10,
      totalSubmit: 20,
      source: 'cf',
      url: '',
      tags: ['greedy'],
      practiced: true,
      lastStatus: 'AC'
    },
    state: 'done',
    reason: { kind: 'due-review', text: '遗忘曲线：已 40 天没碰，建议复习' },
    urgency: 0.9,
    daysSince: 40,
    knowledgeIds: ['greedy'],
    listNames: [],
    dueReview: false,
    ...extra
  }
}

function makeRec(filterTags: string[] = []): RecommendResult {
  return {
    practiced: [
      recItem('1A', { listNames: ['十月冲刺'] }),
      recItem('2B', {
        state: 'trying',
        urgency: 0.3,
        daysSince: 2,
        reason: { kind: 'weak', text: '正确率 0%，建议重做' }
      })
    ],
    fresh: [
      recItem('3C', { state: 'undone', daysSince: null, reason: { kind: 'learning-node', text: '属于「练习中」知识点' } })
    ],
    practicedOrder: 'forgetting',
    freshOrder: 'learning-node',
    totals: { practiced: 12, fresh: 300 },
    filterTags
  }
}

const tagUsage: TagUsage[] = [
  { tag: 'greedy', attempted: 5, acProblems: 3, lastAt: null, lastActiveDays: 2, totalProblems: 120, progress: 0.04 },
  { tag: 'dp', attempted: 2, acProblems: 0, lastAt: null, lastActiveDays: 5, totalProblems: 200, progress: 0.01 },
  { tag: 'graph', attempted: 0, acProblems: 0, lastAt: null, lastActiveDays: null, totalProblems: 90, progress: 0 }
]

function setupApi(settings: Record<string, string> = {}) {
  const calls: { channel: string; payload: unknown }[] = []
  const api = {
    invoke: vi.fn(async (channel: string, payload?: unknown) => {
      calls.push({ channel, payload })
      switch (channel) {
        case IpcChannels.RecordsStats:
          return { ok: true, data: stats }
        case IpcChannels.RatingGet:
          return { ok: true, data: { finalRating: 1500, title: '专家', color: '#8c8', history: [] } }
        case IpcChannels.RecordsList:
          return { ok: true, data: { total: 0, items: [] } }
        case IpcChannels.SettingsGetAll:
          return { ok: true, data: settings }
        case IpcChannels.StatsTagUsage:
          return { ok: true, data: tagUsage }
        case IpcChannels.ProblemsList:
          // v1.16：切换题源会通过共享 store 触发一次题库列表刷新
          return { ok: true, data: { total: 0, items: [] } }
        case IpcChannels.RecommendGet: {
          const p = (payload ?? {}) as { filterTags?: string[] }
          return { ok: true, data: makeRec(p.filterTags ?? []) }
        }
        default:
          return { ok: false, error: { code: 'NO_HANDLER', message: channel } }
      }
    }),
    on: vi.fn(() => () => undefined)
  }
  ;(window as unknown as { api: unknown }).api = api
  return { api, calls }
}

/**
 * 首页把「推荐 / 标签」的加载推迟到 requestAnimationFrame + setTimeout 之后（先让统计卡片出画面，
 * v1.14.1 性能优化），所以测试要多等一个真实定时器周期才看得到推荐区。
 *
 * 注意：固定等 40ms 在「全量 43 个文件并行」时不够稳（机器忙时 rAF + 定时器可能延后，
 * 曾偶发 `Cannot read properties of undefined (reading 'trigger')`）。改成轮询：
 * 每轮 flush + 10ms，渲染出目标元素就提前返回，最坏 20 轮（200ms）。
 */
async function settle(until?: () => boolean): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await flushPromises()
    await new Promise((r) => setTimeout(r, 10))
    await flushPromises()
    if (until && until()) return
  }
}

async function mountPage(settings: Record<string, string> = {}, pinia = createPinia()) {
  const { api, calls } = setupApi(settings)
  const router = createRouter({ history: createWebHashHistory(), routes: [{ path: '/:p(.*)*', component: { template: '<div/>' } }] })
  // 复用同一个 pinia 实例，测试里才能观察到首页写回共享 store 的题源
  setActivePinia(pinia)
  const wrapper = mount(DashboardPage, { global: { plugins: [router, pinia] } })
  await settle(() => wrapper.findAll('.rec-item').length > 0)
  return { wrapper, api, calls, router, pinia }
}

function recCalls(calls: { channel: string; payload: unknown }[]) {
  return calls.filter((c) => c.channel === IpcChannels.RecommendGet)
}

describe('首页推荐习题（v1.14 FR-31~FR-33）', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    setActivePinia(createPinia())
    delete (window as unknown as { api?: unknown }).api
  })

  it('渲染「推荐习题」面板，分为已练习与未练习两栏', async () => {
    const { wrapper } = await mountPage()
    const panel = wrapper.find('[data-panel="recommend"]')
    expect(panel.exists()).toBe(true)
    expect(panel.text()).toContain('推荐习题')
    expect(wrapper.find('[data-rec="practiced"]').text()).toContain('已练习')
    expect(wrapper.find('[data-rec="fresh"]').text()).toContain('未练习')
  })

  it('展示排序方式与总数（默认遗忘曲线 / 练习中知识点优先）', async () => {
    const { wrapper } = await mountPage()
    const practiced = wrapper.find('[data-rec="practiced"]')
    const fresh = wrapper.find('[data-rec="fresh"]')
    expect(practiced.text()).toContain('遗忘曲线')
    expect(practiced.text()).toContain('12 道可复习')
    expect(fresh.text()).toContain('知识点优先')
    expect(fresh.text()).toContain('300 道待练')
  })

  it('已练习条目带状态徽章、理由与题单归属标记', async () => {
    const { wrapper } = await mountPage()
    const items = wrapper.findAll('[data-rec="practiced"] .rec-item')
    expect(items).toHaveLength(2)
    expect(items[0].text()).toContain('1A')
    expect(items[0].find('.state').text()).toBe('已 AC')
    expect(items[0].find('.state').classes()).toContain('st-done')
    expect(items[0].text()).toContain('建议复习')
    expect(items[0].find('.reason').classes()).toContain('urgent')
    expect(items[0].find('.in-list').exists()).toBe(true)
    expect(items[1].find('.state').text()).toBe('未通过')
  })

  it('未练习条目展示推荐理由（练习中知识点）', async () => {
    const { wrapper } = await mountPage()
    const fresh = wrapper.findAll('[data-rec="fresh"] .rec-item')
    expect(fresh).toHaveLength(1)
    expect(fresh[0].text()).toContain('属于「练习中」知识点')
  })

  it('点条目跳转到题库并带题号', async () => {
    const { wrapper, router } = await mountPage()
    await wrapper.findAll('[data-rec="practiced"] .rec-item')[0].trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/problems')
    expect(router.currentRoute.value.query.q).toBe('1A')
  })

  it('已练习标签面板：只显示已 AC 的标签，并给出 已AC/题库 计数', async () => {
    const { wrapper } = await mountPage()
    const chips = wrapper.findAll('.tag-chip')
    expect(chips).toHaveLength(1) // greedy 已 AC 3；dp 练习过但未 AC 归入提示
    expect(chips[0].attributes('data-tag')).toBe('greedy')
    expect(chips[0].text()).toContain('3/120')
    expect(chips[0].attributes('title')).toContain('题库 120 题')
    expect(wrapper.find('.untouched').text()).toContain('1 个标签练习过但未 AC')
  })

  it('点标签筛选推荐（带 filterTags 重新请求），再点取消', async () => {
    const { wrapper, calls } = await mountPage()
    const chip = wrapper.find('.tag-chip')
    await chip.trigger('click')
    await flushPromises()
    const after = recCalls(calls)
    expect(after.length).toBe(2)
    // v1.16：请求体始终带当前题源（默认全部）
    expect(after[1].payload).toEqual({ filterTags: ['greedy'], source: 'all' })
    expect(wrapper.find('.tag-chip').classes()).toContain('on')
    expect(wrapper.find('.filter-hint').text()).toContain('greedy')

    await wrapper.find('.tag-chip').trigger('click')
    await flushPromises()
    expect(recCalls(calls)[2].payload).toEqual({ filterTags: [], source: 'all' })
  })

  it('「清空筛选」按钮清除已选标签', async () => {
    const { wrapper, calls } = await mountPage()
    await wrapper.find('.tag-chip').trigger('click')
    await flushPromises()
    const clearBtn = wrapper.findAll('button').find((b) => b.text().includes('清空筛选'))
    expect(clearBtn).toBeTruthy()
    await clearBtn!.trigger('click')
    await flushPromises()
    expect(wrapper.find('.filter-hint').exists()).toBe(false)
    expect(recCalls(calls).at(-1)!.payload).toEqual({ filterTags: [], source: 'all' })
  })

  it('设置里关闭「显示已练习标签」后不渲染标签面板', async () => {
    const { wrapper } = await mountPage({ recommendShowTags: 'false' })
    expect(wrapper.find('.tag-panel').exists()).toBe(false)
    expect(wrapper.find('[data-panel="recommend"]').exists()).toBe(true)
  })

  it('推荐接口失败时给出空态，不崩溃', async () => {
    const api = {
      invoke: vi.fn(async (channel: string) => {
        if (channel === IpcChannels.RecommendGet) return { ok: false, error: { code: 'X', message: 'boom' } }
        if (channel === IpcChannels.RecordsStats) return { ok: true, data: stats }
        if (channel === IpcChannels.RatingGet) return { ok: false, error: { code: 'X', message: 'no' } }
        if (channel === IpcChannels.RecordsList) return { ok: true, data: { total: 0, items: [] } }
        if (channel === IpcChannels.StatsTagUsage) return { ok: true, data: [] }
        return { ok: true, data: {} }
      }),
      on: vi.fn(() => () => undefined)
    }
    ;(window as unknown as { api: unknown }).api = api
    const wrapper = mount(DashboardPage, { global: { plugins: [createPinia()], stubs: { ChartBox: true } } })
    await settle()
    expect(wrapper.text()).toContain('暂无推荐数据')
    expect(wrapper.find('[data-panel="recommend"]').exists()).toBe(true)
  })
})

/**
 * v1.16：首页推荐与题库页共用同一个题源状态。
 * 关键行为：在任一页切题源，另一页跟着变（不是各自独立的筛选器）。
 */
describe('题源筛选（与题库页联动，v1.16）', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    setActivePinia(createPinia())
    delete (window as unknown as { api?: unknown }).api
  })

  it('默认「全部」，四个题源按钮齐全且全部高亮', async () => {
    const { wrapper } = await mountPage()
    const btns = wrapper.findAll('[data-rec-source]')
    expect(btns.map((b) => b.attributes('data-rec-source'))).toEqual([
      'all',
      'cf',
      'luogu',
      'leetcode'
    ])
    expect(btns[0].classes()).toContain('on')
    expect(wrapper.find('[data-lib-filter]').text()).toContain('当前推荐全部平台')
    // 未筛题源时不显示「仅 xxx」范围提示
    expect(wrapper.find('[data-rec-scope]').exists()).toBe(false)
  })

  it('切到洛谷：推荐与标签统计都带 source=luogu 重新请求', async () => {
    const { wrapper, calls } = await mountPage()
    await wrapper.find('[data-rec-source="luogu"]').trigger('click')
    await settle(() => recCalls(calls).length > 1)

    expect(recCalls(calls).at(-1)!.payload).toEqual({ filterTags: [], source: 'luogu' })
    const tagCall = calls.filter((c) => c.channel === IpcChannels.StatsTagUsage).at(-1)!
    expect(tagCall.payload).toEqual({ source: 'luogu' })
    expect(wrapper.find('[data-rec-source="luogu"]').classes()).toContain('on')
    expect(wrapper.find('[data-rec-source="all"]').classes()).not.toContain('on')
    expect(wrapper.find('[data-rec-scope]').text()).toContain('洛谷')
    expect(wrapper.find('[data-lib-filter]').text()).toContain('当前只推荐 洛谷')
  })

  it('切换题源写回共享 store（题库页读到同一个值）', async () => {
    const { wrapper } = await mountPage()
    const problems = useProblemsStore()
    expect(problems.filter.source).toBe('all')

    await wrapper.find('[data-rec-source="cf"]').trigger('click')
    await flushPromises()

    expect(problems.filter.source).toBe('cf')
    // 沿用题库页既有规则：切源时清掉与源无关的难度筛选
    expect(problems.filter.difficulty ?? null).toBe(null)
  })

  it('题库页先切到洛谷，首页推荐直接按洛谷请求', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    useProblemsStore().filter.source = 'luogu'

    const { wrapper, calls } = await mountPage({}, pinia)
    expect(recCalls(calls)[0].payload).toEqual({ filterTags: [], source: 'luogu' })
    expect(calls.filter((c) => c.channel === IpcChannels.StatsTagUsage)[0].payload).toEqual({
      source: 'luogu'
    })
    expect(wrapper.find('[data-rec-source="luogu"]').classes()).toContain('on')
  })

  it('未练习空态按当前题源给出提示文案', async () => {
    const { wrapper, api } = await mountPage()
    // 让推荐返回空列表 + 已切到力扣
    await wrapper.find('[data-rec-source="leetcode"]').trigger('click')
    await settle()
    api.invoke.mockImplementation(async (channel: string) => {
      if (channel === IpcChannels.RecommendGet) {
        const empty = makeRec()
        empty.fresh = []
        empty.practiced = []
        return { ok: true, data: empty }
      }
      if (channel === IpcChannels.StatsTagUsage) return { ok: true, data: [] }
      if (channel === IpcChannels.RecordsStats) return { ok: true, data: stats }
      if (channel === IpcChannels.RecordsList) return { ok: true, data: { total: 0, items: [] } }
      if (channel === IpcChannels.ProblemsList) return { ok: true, data: { total: 0, items: [] } }
      return { ok: true, data: {} }
    })
    await wrapper.findAll('button').find((b) => b.text().includes('换一批'))!.trigger('click')
    await settle()
    expect(wrapper.find('[data-rec="fresh"]').text()).toContain('力扣中没有符合条件的未练习题目')
  })
})
