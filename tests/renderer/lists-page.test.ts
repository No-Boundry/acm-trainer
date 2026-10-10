// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { IpcChannels } from '@shared/channels'
import ListsPage from '@/pages/ListsPage.vue'
import type { ProblemList, ProblemListDetail, TrainingPlanDetail } from '@shared/types'

/**
 * 题单/复习/训练计划页（v1.10 FR-27~FR-29）：
 * 三个 Tab、新建题单、粘贴识别、勾选完成进复习、复习反馈、计划排期与打卡。
 */

const list: ProblemList = {
  id: 1,
  name: '蓝桥杯冲刺',
  description: '',
  origin: 'manual',
  trackId: null,
  createdAt: '2026-10-05 08:00:00',
  updatedAt: '2026-10-05 08:00:00',
  total: 2,
  doneCount: 1,
  reviewCount: 1,
  dueCount: 1
}

const item = (problemId: string, done: boolean, stage: number) => ({
  id: problemId === '1741:A' ? 1 : 2,
  listId: 1,
  problemId,
  position: 0,
  done,
  doneAt: done ? '2026-10-05 09:00:00' : null,
  note: '',
  reviewStage: stage,
  reviewDue: stage > 0 ? '2026-10-05' : null,
  reviewLastAt: stage > 0 ? '2026-10-04' : null,
  reviewEase: null,
  problem: {
    id: problemId,
    contestId: 1741,
    index: 'A',
    name: problemId === '1741:A' ? 'CF 1741A' : 'CF 1741B',
    rating: 800,
    difficulty: null,
    solvedCount: 0,
    totalSubmit: 0,
    source: 'cf' as const,
    cfUrl: 'https://codeforces.com/problemset/problem/1741/A',
    fetchedAt: '2026-10-05 08:00:00',
    tags: ['贪心']
  }
})

const detail: ProblemListDetail = {
  list,
  items: [item('1741:A', true, 1), item('1741:B', false, 0)]
}

const planDetail: TrainingPlanDetail = {
  plan: {
    id: 7,
    name: '冲 1600',
    listId: 1,
    targetDate: '2026-11-01',
    dailyTarget: 2,
    ratingMin: 800,
    ratingMax: 1400,
    knowledgeIds: ['dp'],
    restWeekdays: [0],
    trackId: null,
    createdAt: '2026-10-05 08:00:00',
    updatedAt: '2026-10-05 08:00:00',
    total: 2,
    doneCount: 0,
    busyDays: []
  },
  days: [
    {
      date: '2026-10-05',
      busy: false,
      reason: '',
      tasks: [
        {
          id: 1,
          planId: 7,
          problemId: '1741:A',
          dueDate: '2026-10-05',
          status: 'pending',
          doneAt: null,
          problem: item('1741:A', false, 0).problem
        }
      ]
    }
  ]
}

function setupApi() {
  const calls: { channel: string; payload?: unknown }[] = []
  const api = {
    invoke: vi.fn(async (channel: string, payload?: unknown) => {
      calls.push({ channel, payload })
      const handlers: Record<string, () => unknown> = {
        [IpcChannels.ListsList]: () => [list],
        [IpcChannels.ListsGet]: () => detail,
        [IpcChannels.ListsCreate]: () => ({ ...list, id: 9, name: '新题单' }),
        [IpcChannels.ListsAddProblems]: () => ({ added: 2 }),
        [IpcChannels.ListsSetDone]: () => item('1741:B', true, 1),
        [IpcChannels.ListsReview]: () => item('1741:A', true, 2),
        [IpcChannels.ListsParseText]: () => ({ matchedIds: ['1741:A', '1741:B'], missing: ['9999:Z'], total: 2 }),
        [IpcChannels.ListsGenerate]: () => ({ listId: 11, picked: 5, candidates: 40 }),
        [IpcChannels.ListsDueReviews]: () => ({ today: '2026-10-05', items: [] }),
        [IpcChannels.PlansList]: () => [planDetail.plan],
        [IpcChannels.PlansGet]: () => planDetail,
        [IpcChannels.PlansCreate]: () => ({ planId: 7, scheduled: 4, overflow: 0 }),
        [IpcChannels.PlansToggleTask]: () => ({ id: 1, planId: 7, problemId: '1741:A', dueDate: '2026-10-05', status: 'done', doneAt: null }),
        [IpcChannels.PlansMarkBusy]: () => planDetail.plan,
        [IpcChannels.SkillGet]: () => ({ nodes: [], recommendedIds: [], allDone: false, tracks: [] }),
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
  const wrapper = mount(ListsPage, { global: { plugins: [createPinia()] } })
  await flushPromises()
  await flushPromises()
  return { wrapper, ...ctx }
}

describe('ListsPage 题单 / 复习 / 训练计划（v1.10）', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    delete (window as unknown as { api?: unknown }).api
  })

  it('三个 Tab 与题单列表渲染，默认打开第一份题单', async () => {
    const { wrapper } = await mountPage()
    const tabs = wrapper.findAll('.tabs .seg').map((t) => t.text())
    expect(tabs.join('|')).toContain('题单')
    expect(tabs.join('|')).toContain('今日复习')
    expect(tabs.join('|')).toContain('训练计划')
    expect(wrapper.findAll('.list-item')).toHaveLength(1)
    const rows = wrapper.findAll('table.table tbody tr')
    expect(rows.length).toBeGreaterThanOrEqual(2)
    expect(wrapper.text()).toContain('CF 1741A')
    // 已进入复习的条目显示档位
    expect(wrapper.text()).toContain('第 1/6 档')
  })

  it('新建题单调用 lists:create', async () => {
    const { wrapper, calls } = await mountPage()
    await wrapper.find('.new-row input').setValue('新题单')
    await wrapper.find('.new-row button').trigger('click')
    await flushPromises()
    expect(calls.some((c) => c.channel === IpcChannels.ListsCreate && (c.payload as { name: string }).name === '新题单')).toBe(true)
  })

  it('粘贴识别：识别后确认加入调用 lists:addProblems', async () => {
    const { wrapper, calls } = await mountPage()
    await wrapper.find('.toolbar button').trigger('click') // 打开粘贴弹窗
    await flushPromises()
    const modal = wrapper.find('.modal')
    expect(modal.exists()).toBe(true)
    await modal.find('textarea').setValue('1741A 1741B 9999Z')
    const parseBtn = modal.findAll('.modal-actions button').find((b) => b.text() === '识别')!
    await parseBtn.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('命中')
    const addBtn = wrapper.findAll('.modal-actions button').find((b) => b.text().includes('加入题单'))!
    expect(addBtn.attributes('disabled')).toBeUndefined()
    await addBtn.trigger('click')
    await flushPromises()
    const added = calls.find((c) => c.channel === IpcChannels.ListsAddProblems)
    expect(added).toBeTruthy()
    expect((added!.payload as { problemIds: string[] }).problemIds).toEqual(['1741:A', '1741:B'])
  })

  it('勾选完成调用 lists:setDone；今日复习 Tab 提供困难/一般/轻松反馈', async () => {
    const { wrapper, calls } = await mountPage()
    const checkbox = wrapper.findAll('table.table tbody tr input[type="checkbox"]')[1]
    await checkbox.setValue(true)
    await flushPromises()
    const done = calls.find((c) => c.channel === IpcChannels.ListsSetDone)
    expect(done).toBeTruthy()
    expect((done!.payload as { done: boolean; problemId: string }).done).toBe(true)

    // 切到今日复习 Tab
    const reviewTab = wrapper.findAll('.tabs .seg').find((t) => t.text().includes('今日复习'))!
    await reviewTab.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('今日待复习')
  })

  it('训练计划 Tab：新建计划调用 plans:create，日历显示任务并可打卡', async () => {
    const { wrapper, calls } = await mountPage()
    const planTab = wrapper.findAll('.tabs .seg').find((t) => t.text().includes('训练计划'))!
    await planTab.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('新建训练计划')
    // 选题单 + 提交
    const select = wrapper.find('.form-grid select.select')
    await select.setValue('1')
    const createBtn = wrapper.findAll('.actions button').find((b) => b.text().includes('生成并排期'))!
    await createBtn.trigger('click')
    await flushPromises()
    const created = calls.find((c) => c.channel === IpcChannels.PlansCreate)
    expect(created).toBeTruthy()
    expect((created!.payload as { listId: number }).listId).toBe(1)

    // 日历与打卡
    expect(wrapper.find('.calendar').exists()).toBe(true)
    const taskCheckbox = wrapper.find('.calendar .task input[type="checkbox"]')
    await taskCheckbox.setValue(true)
    await flushPromises()
    expect(calls.some((c) => c.channel === IpcChannels.PlansToggleTask)).toBe(true)
  })

  it('标记没空日调用 plans:markBusy（自动顺延由主进程完成）', async () => {
    const { wrapper, calls } = await mountPage()
    const planTab = wrapper.findAll('.tabs .seg').find((t) => t.text().includes('训练计划'))!
    await planTab.trigger('click')
    await flushPromises()
    const busyRow = wrapper.find('.busy-row')
    await busyRow.findAll('input')[0].setValue('2026-10-06')
    await busyRow.findAll('input')[1].setValue('期中考试')
    const btn = busyRow.findAll('button').find((b) => b.text().includes('标记这天没空'))!
    await btn.trigger('click')
    await flushPromises()
    const call = calls.find((c) => c.channel === IpcChannels.PlansMarkBusy)
    expect(call).toBeTruthy()
    expect(call!.payload).toMatchObject({ date: '2026-10-06', reason: '期中考试' })
  })
})
