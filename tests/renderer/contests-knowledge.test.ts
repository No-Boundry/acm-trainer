// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { IpcChannels } from '@shared/channels'
import ContestsPage from '@/pages/ContestsPage.vue'
import type { ProblemRow, SkillNodeReport } from '@shared/types'

/**
 * 虚拟比赛创建向导的「知识点组卷」（v1.20 FR-41）。
 * 题库页的标签大类已整合进知识点，这里同步：用 KnowledgePicker 选节点 =
 * 把该节点的全部关联标签并进组卷参数（不再有大类 Tab + 裸标签列表）。
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
      lastActiveDays: 2,
      tagTotal: 1,
      coveredTags: 1
    },
    tier: 'learning',
    depsReady: true,
    ...partial
  }
}

const nodes: SkillNodeReport[] = [
  node({ id: 'greedy', name: '贪心', tags: ['greedy', '贪心'] }),
  node({ id: 'dp', name: '动态规划入门', tags: ['dp', '动态规划'], layer: 2, dependsOn: ['greedy'] })
]

const generatedRow: ProblemRow = {
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
  const calls: { channel: string; payload?: unknown }[] = []
  const api = {
    invoke: vi.fn(async (channel: string, payload?: unknown) => {
      calls.push({ channel, payload })
      const handlers: Record<string, () => unknown> = {
        [IpcChannels.SettingsGetAll]: () => ({}),
        [IpcChannels.ContestsList]: () => [],
        [IpcChannels.ProblemsTags]: () => ['greedy', 'dp'],
        [IpcChannels.SkillGet]: () => ({ nodes, recommendedIds: ['greedy'], allDone: false }),
        [IpcChannels.ContestsGenerate]: () => ['1:A'],
        [IpcChannels.ProblemsGet]: () => generatedRow
      }
      const h = handlers[channel]
      if (!h) return { ok: false, error: { code: 'NO_HANDLER', message: channel } }
      return { ok: true, data: await h() }
    }),
    on: vi.fn(() => () => undefined)
  }
  ;(window as unknown as { api: unknown }).api = api
  return { calls }
}

async function mountPage() {
  const ctx = setupApi()
  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(ContestsPage, { global: { plugins: [pinia] } })
  await flushPromises()
  await flushPromises()
  return { wrapper, ...ctx }
}

function knChip(wrapper: ReturnType<typeof mount>, name: string) {
  const chip = wrapper.findAll('.kn-chip').find((c) => c.text().includes(name))
  expect(chip, `找不到知识点 chip「${name}」`).toBeTruthy()
  return chip!
}

describe('虚拟比赛创建：知识点组卷（v1.20 FR-41）', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    delete (window as unknown as { api?: unknown }).api
  })

  it('创建向导里渲染的是知识点选择器，没有标签大类 Tab / 裸标签列表', async () => {
    const { wrapper } = await mountPage()
    expect(wrapper.find('.kn-picker').exists()).toBe(true)
    expect(wrapper.findAll('.seg-tab')).toHaveLength(0)
    expect(wrapper.find('.tag-row').exists()).toBe(false)
    // 紧凑模式：不显示掌握度概览与底部说明
    expect(wrapper.find('.kn-summary-line').exists()).toBe(false)
    expect(wrapper.find('.kn-tip').exists()).toBe(false)
  })

  it('点知识点 = 把它全部关联标签并进组卷参数，并在「已选标签」里可见', async () => {
    const { wrapper } = await mountPage()
    await knChip(wrapper, '贪心').trigger('click')
    await flushPromises()

    const chips = wrapper.findAll('.sel-line .chip').map((c) => c.text())
    expect(chips.join('|')).toContain('greedy')
    expect(chips.join('|')).toContain('贪心')
    expect(wrapper.findAll('.kn-chip.on')).toHaveLength(1)
  })

  it('生成题单时把知识点标签带给 contest:generate', async () => {
    const { wrapper, calls } = await mountPage()
    await knChip(wrapper, '贪心').trigger('click')
    await flushPromises()
    const nameInput = wrapper.find('input.input')
    await nameInput.setValue('周末模拟赛')
    await wrapper.find('.actions .btn.primary').trigger('click')
    await flushPromises()

    const gen = calls.find((c) => c.channel === IpcChannels.ContestsGenerate)
    expect(gen).toBeTruthy()
    const payload = gen!.payload as { tags: string[]; count: number }
    expect([...payload.tags].sort()).toEqual(['greedy', '贪心'].sort())
  })

  it('多个知识点叠加；「全部清空」清掉全部标签', async () => {
    const { wrapper } = await mountPage()
    await knChip(wrapper, '贪心').trigger('click')
    await flushPromises()
    await knChip(wrapper, '动态规划').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.kn-chip.on')).toHaveLength(2)
    expect(wrapper.findAll('.sel-line .chip')).toHaveLength(4)

    const clear = wrapper.findAll('button').find((b) => b.text().includes('全部清空'))!
    await clear.trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.sel-line .chip')).toHaveLength(0)
    expect(wrapper.findAll('.kn-chip.on')).toHaveLength(0)
  })

  it('再点一次同一节点取消选择', async () => {
    const { wrapper } = await mountPage()
    await knChip(wrapper, '贪心').trigger('click')
    await flushPromises()
    await knChip(wrapper, '贪心').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.kn-chip.on')).toHaveLength(0)
    expect(wrapper.find('.sel-line').exists()).toBe(false)
  })
})
