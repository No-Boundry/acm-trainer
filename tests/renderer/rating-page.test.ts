// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { IpcChannels } from '@shared/channels'
import RatingPage from '@/pages/RatingPage.vue'
import type { RatingBreakdown, RatingSnapshot } from '@shared/types'

/**
 * 水平评估页渲染回归（v1.8.4）：
 * 历史快照的 createdAt 曾因仓库层未取别名而为 undefined，
 * 趋势图 computed 调 createdAt.slice() 抛错 → 整页空白（页面无 .rating-page）。
 * 此处锁定：有历史数据时正常渲染；即使单条数据字段异常也不抛错。
 */

const breakdown: RatingBreakdown = {
  practiceRating: 1450,
  contestRating: null,
  finalRating: 1450,
  title: '省赛候选',
  color: '#1e90ff',
  acCount: 2,
  attemptCount: 2,
  accuracy: 100,
  luogu: {
    rating: 1150,
    attemptCount: 2,
    acCount: 1,
    accuracy: 50,
    difficultyDist: [{ difficulty: 3, total: 1, ac: 1 }]
  },
  leetcode: {
    rating: 1100,
    attemptCount: 2,
    acCount: 1,
    accuracy: 50,
    difficultyDist: [
      { difficulty: 1, total: 1, ac: 1 },
      { difficulty: 2, total: 1, ac: 0 }
    ]
  }
}

/** 无力扣数据时的形态（板块显示空态提示） */
const breakdownNoLc: RatingBreakdown = {
  ...breakdown,
  leetcode: { rating: null, attemptCount: 0, acCount: 0, accuracy: null, difficultyDist: [] }
}

function snapshot(createdAt: unknown, rating = 1450): RatingSnapshot {
  return { id: 1, rating, source: 'manual', detail: null, createdAt } as unknown as RatingSnapshot
}

function setupApi(history: RatingSnapshot[], payload: RatingBreakdown = breakdown) {
  const api = {
    invoke: vi.fn(async (channel: string) => {
      if (channel === IpcChannels.RatingGet) return { ok: true, data: { ...payload, history } }
      if (channel === IpcChannels.RatingRecalc) return { ok: true, data: { ...payload, history } }
      return { ok: false, error: { code: 'NO_HANDLER', message: channel } }
    }),
    on: vi.fn(() => () => undefined)
  }
  ;(window as unknown as { api: unknown }).api = api
  return api
}

async function mountPage(history: RatingSnapshot[], payload: RatingBreakdown = breakdown) {
  const api = setupApi(history, payload)
  // jsdom 无 canvas：ChartBox 用桩替换（父组件仍会求值 trendOption → 仍覆盖崩溃路径）
  const wrapper = mount(RatingPage, { global: { stubs: { ChartBox: true } } })
  await flushPromises()
  await flushPromises()
  return { wrapper, api }
}

describe('RatingPage 水平评估页（v1.8.4 回归）', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    delete (window as unknown as { api?: unknown }).api
  })

  it('无历史：显示分值、称号与「还没有历史记录」提示', async () => {
    const { wrapper } = await mountPage([])
    expect(wrapper.find('.rating-page').exists()).toBe(true)
    expect(wrapper.find('.rating-num').text()).toBe('1450')
    expect(wrapper.text()).toContain('省赛候选')
    expect(wrapper.text()).toContain('还没有历史记录')
  })

  it('有历史：正常渲染且页面不空（v1.8.4 前此处整页空白）', async () => {
    const { wrapper } = await mountPage([
      snapshot('2026-09-20 13:32:05', 1400),
      snapshot('2026-09-21 09:00:00', 1450)
    ])
    expect(wrapper.find('.rating-page').exists()).toBe(true)
    expect(wrapper.find('.rating-num').text()).toBe('1450')
    expect(wrapper.find('.cards').exists()).toBe(true)
    expect(wrapper.text()).toContain('Rating 历史趋势')
  })

  it('单条历史字段异常（createdAt 缺失）也不抛错、页面仍渲染', async () => {
    const { wrapper } = await mountPage([snapshot(undefined)])
    expect(wrapper.find('.rating-page').exists()).toBe(true)
    expect(wrapper.find('.rating-num').text()).toBe('1450')
  })

  it('「重新计算并记录」调用 rating:recalc 并刷新数据', async () => {
    const { wrapper, api } = await mountPage([])
    await wrapper.find('button').trigger('click')
    await flushPromises()
    expect(api.invoke).toHaveBeenCalledWith(IpcChannels.RatingRecalc, { source: 'manual' })
  })

  // ============ v1.9 FR-23：力扣练习水平独立板块 ============
  it('有力扣数据：渲染独立板块、分值、难度 chips 与正确率', async () => {
    const { wrapper } = await mountPage([])
    const block = wrapper.find('.lc-block')
    expect(block.exists()).toBe(true)
    const text = block.text().replace(/\s+/g, ' ')
    expect(text).toContain('力扣练习水平')
    expect(text).toContain('不计入上方 CF 综合分')
    expect(text).toContain('1100')
    expect(text).toContain('简单 · 1/1')
    expect(text).toContain('中等 · 0/1')
    expect(text).toContain('正确率 50%')
    // 洛谷板块仍然存在（两块互不影响）
    expect(wrapper.find('.luogu-block').exists()).toBe(true)
  })

  it('无力扣数据：显示空态提示与折算说明', async () => {
    const { wrapper } = await mountPage([], breakdownNoLc)
    const text = wrapper.find('.lc-block').text().replace(/\s+/g, ' ')
    expect(text).toContain('暂无力扣练习数据')
    expect(text).toContain('可在「设置」中调整折算分值')
  })
})
