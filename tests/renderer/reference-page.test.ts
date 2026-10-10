// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { IpcChannels } from '@shared/channels'
import ReferencePage from '@/pages/ReferencePage.vue'
import { STL_ENTRIES } from '@shared/stl-reference'

/**
 * STL 速查页面组件测试（v1.8.2 FR-18）：分类过滤、搜索、复制、外链。
 */

function setupApi() {
  const calls: { channel: string; payload: unknown }[] = []
  const writeText = vi.fn(async () => undefined)
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true
  })
  const api = {
    invoke: vi.fn(async (channel: string, payload?: unknown) => {
      calls.push({ channel, payload })
      return { ok: true, data: { ok: true } }
    }),
    on: vi.fn(() => () => undefined)
  }
  ;(window as unknown as { api: unknown }).api = api
  return { api, calls, writeText }
}

async function mountPage() {
  const ctx = setupApi()
  const wrapper = mount(ReferencePage, { global: { plugins: [createPinia()] } })
  await flushPromises()
  return { wrapper, ...ctx }
}

describe('ReferencePage STL 速查', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    delete (window as unknown as { api?: unknown }).api
  })

  it('渲染全部分类与条目数量', async () => {
    const { wrapper } = await mountPage()
    expect(wrapper.findAll('.cat').length).toBeGreaterThanOrEqual(7) // 全部 + 6 分类
    expect(wrapper.findAll('.entry').length).toBe(STL_ENTRIES.length)
    expect(wrapper.text()).toContain('vector')
    wrapper.unmount()
  })

  it('点击分类只显示该类条目', async () => {
    const { wrapper } = await mountPage()
    const algoCat = wrapper.findAll('.cat').find((c) => c.text().includes('算法库'))!
    await algoCat.trigger('click')
    await flushPromises()
    const shown = wrapper.findAll('.entry').length
    const expected = STL_ENTRIES.filter((e) => e.category === 'algorithm').length
    expect(shown).toBe(expected)
    wrapper.unmount()
  })

  it('搜索过滤条目（大小写无关），重置恢复全部', async () => {
    const { wrapper } = await mountPage()
    const search = wrapper.find('input.search')
    await search.setValue('priority_queue')
    await flushPromises()
    const shown = wrapper.findAll('.entry').length
    expect(shown).toBeGreaterThan(0)
    expect(shown).toBeLessThan(STL_ENTRIES.length)
    expect(wrapper.text()).toContain('priority_queue')

    const resetBtn = wrapper.findAll('button').find((b) => b.text() === '重置')!
    await resetBtn.trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.entry').length).toBe(STL_ENTRIES.length)
    wrapper.unmount()
  })

  it('搜索无结果时给出提示', async () => {
    const { wrapper } = await mountPage()
    await wrapper.find('input.search').setValue('zzz-not-exist')
    await flushPromises()
    expect(wrapper.find('.empty').exists()).toBe(true)
    expect(wrapper.text()).toContain('没有匹配的条目')
    wrapper.unmount()
  })

  it('「复制代码」写入剪贴板并提示已复制', async () => {
    const { wrapper, writeText } = await mountPage()
    const firstCopy = wrapper.findAll('button').find((b) => b.text().includes('复制代码'))!
    await firstCopy.trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(String(writeText.mock.calls[0][0]).length).toBeGreaterThan(10)
    expect(wrapper.text()).toContain('已复制')
    wrapper.unmount()
  })

  it('「cppreference ↗」通过 app:openExternal 打开 https 链接', async () => {
    const { wrapper, calls } = await mountPage()
    const link = wrapper.findAll('button').find((b) => b.text().includes('cppreference'))!
    await link.trigger('click')
    await flushPromises()
    const call = calls.find((c) => c.channel === IpcChannels.AppOpenExternal)
    expect(call).toBeTruthy()
    expect(String((call!.payload as { url: string }).url)).toMatch(/^https:\/\//)
    wrapper.unmount()
  })
})
