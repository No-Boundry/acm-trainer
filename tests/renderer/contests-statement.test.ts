// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { IpcChannels } from '@shared/channels'
import ContestsPage from '@/pages/ContestsPage.vue'
import type { Contest, ContestListItem, Problem } from '@shared/types'

/**
 * 比赛页「题面」按钮回归测试（v1.8）：
 * v2.0 回退后按钮仍残留本地弹窗写法（只写 ref、无人渲染 → 点击无反应），
 * 现改为与题库页一致：走 statement:open（主进程用 Edge 打开）。
 */

const problem: Problem = {
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
  tags: ['greedy']
}

const runningContest: Contest = {
  id: 7,
  name: 'smoke-contest',
  durationMinutes: 120,
  status: 'running',
  startedAt: '2026-09-20 12:00:00',
  finishedAt: null,
  createdAt: '2026-09-20 11:59:00',
  problems: [{ position: 0, problem }],
  submissions: []
}

const listItem: ContestListItem = {
  id: 7,
  name: 'smoke-contest',
  durationMinutes: 120,
  status: 'running',
  startedAt: '2026-09-20 12:00:00',
  finishedAt: null,
  createdAt: '2026-09-20 11:59:00',
  problemCount: 1,
  solvedCount: 0
}

function setupApi() {
  const calls: { channel: string; payload?: unknown }[] = []
  const api = {
    invoke: vi.fn(async (channel: string, payload?: unknown) => {
      calls.push({ channel, payload })
      const handlers: Record<string, () => unknown> = {
        [IpcChannels.SettingsGetAll]: () => ({}),
        [IpcChannels.ContestsList]: () => [listItem],
        [IpcChannels.ContestsGet]: () => runningContest,
        [IpcChannels.ProblemsTags]: () => ['greedy'],
        [IpcChannels.StatementOpen]: () => ({ ok: true, via: 'edge' })
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

async function mountPage() {
  const ctx = setupApi()
  const wrapper = mount(ContestsPage, { global: { plugins: [createPinia()] } })
  await flushPromises()
  await flushPromises()
  await flushPromises()
  return { wrapper, ...ctx }
}

describe('ContestsPage 题面按钮（v1.8：Edge 打开）', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    delete (window as unknown as { api?: unknown }).api
  })

  it('进行中的比赛渲染「📖 题面」按钮', async () => {
    const { wrapper } = await mountPage()
    const btns = wrapper.findAll('button').filter((b) => b.text().includes('题面'))
    expect(btns.length).toBeGreaterThan(0)
  })

  it('点击题面按钮调用 statement:open（不再只写本地 ref）', async () => {
    const { wrapper, calls } = await mountPage()
    const btn = wrapper.findAll('button').filter((b) => b.text().includes('题面'))[0]
    expect(btn).toBeTruthy()
    await btn.trigger('click')
    await flushPromises()

    const call = calls.find((c) => c.channel === IpcChannels.StatementOpen)
    expect(call, '应调用 statement:open').toBeTruthy()
    expect(call?.payload).toMatchObject({ problemId: problem.id })
  })
})
