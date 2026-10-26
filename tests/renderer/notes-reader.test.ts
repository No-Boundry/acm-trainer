// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { IpcChannels } from '@shared/channels'
import NotesPage from '@/pages/NotesPage.vue'

/**
 * 笔记「只读阅读」入口（v1.13）：
 * 点击列表项进入阅读视图（不进入编辑器、不触发自动保存），阅读页可「编辑」再进编辑器。
 */

const note = {
  id: 1,
  title: '线段树合并',
  content: '## 思路\n\n用 `merge` 递归合并。\n\n```cpp\nint merge(int a,int b){};\n```',
  tags: ['数据结构'],
  problemId: 'P3374',
  createdAt: '2026-10-01 10:00:00',
  updatedAt: '2026-10-02 11:30:00'
}

function setupApi() {
  const calls: string[] = []
  const api = {
    invoke: vi.fn(async (channel: string) => {
      calls.push(channel)
      const handlers: Record<string, () => unknown> = {
        [IpcChannels.NotesList]: () => [note],
        [IpcChannels.NotesGet]: () => note,
        [IpcChannels.RecordsList]: () => ({ total: 0, items: [] }),
        [IpcChannels.SettingsGetAll]: () => ({ noteAutoSaveMs: '2000', editorIndent: 'tab' })
      }
      const h = handlers[channel]
      if (!h) return { ok: true, data: null }
      return { ok: true, data: h() }
    }),
    on: vi.fn(() => () => undefined)
  }
  ;(window as unknown as { api: unknown }).api = api
  return { api, calls }
}

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/notes', component: { template: '<div />' } },
      { path: '/problems', component: { template: '<div />' } }
    ]
  })
}

async function mountPage() {
  const ctx = setupApi()
  const router = makeRouter()
  await router.push('/notes')
  await router.isReady()
  const wrapper = mount(NotesPage, { global: { plugins: [createPinia(), router] } })
  await flushPromises()
  await flushPromises()
  return { wrapper, router, ...ctx }
}

describe('NotesPage 只读阅读入口（v1.13）', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    delete (window as unknown as { api?: unknown }).api
  })

  it('列表项提供「阅读」与「编辑」两个入口', async () => {
    const { wrapper } = await mountPage()
    const item = wrapper.find('.note-item')
    expect(item.exists()).toBe(true)
    const btns = item.findAll('button').map((b) => b.text())
    expect(btns).toContain('阅读')
    expect(btns).toContain('编辑')
    wrapper.unmount()
  })

  it('点击列表项 → 进入只读阅读视图（渲染 Markdown，不出现编辑器）', async () => {
    const { wrapper } = await mountPage()
    await wrapper.find('.note-item').trigger('click')
    await flushPromises()

    expect(wrapper.find('.reader').exists()).toBe(true)
    expect(wrapper.find('.editor').exists()).toBe(false)
    expect(wrapper.find('.md-input').exists()).toBe(false)
    // 标题与元信息
    expect(wrapper.find('.reader-title').text()).toBe('线段树合并')
    expect(wrapper.text()).toContain('P3374')
    // Markdown 渲染：h2 + 代码块
    const html = wrapper.find('.reader-preview').html()
    expect(html).toContain('<h2')
    expect(html).toContain('<pre')
    wrapper.unmount()
  })

  it('阅读页「← 返回列表」回到列表；「✎ 编辑」进入编辑器', async () => {
    const { wrapper } = await mountPage()
    await wrapper.find('.note-item').trigger('click')
    await flushPromises()

    // 返回列表
    await wrapper.findAll('.reader-toolbar button').find((b) => b.text().includes('返回列表'))!.trigger('click')
    await flushPromises()
    expect(wrapper.find('.reader').exists()).toBe(false)
    expect(wrapper.find('.note-item').exists()).toBe(true)

    // 再进阅读 → 编辑
    await wrapper.find('.note-item').trigger('click')
    await flushPromises()
    await wrapper.findAll('.reader-toolbar button').find((b) => b.text().includes('编辑'))!.trigger('click')
    await flushPromises()
    expect(wrapper.find('.editor').exists()).toBe(true)
    expect(wrapper.find('.reader').exists()).toBe(false)
    expect((wrapper.find('.title-input').element as HTMLInputElement).value).toBe('线段树合并')
    wrapper.unmount()
  })

  it('点击「编辑」按钮不会先进入阅读视图', async () => {
    const { wrapper } = await mountPage()
    await wrapper.find('.note-item').findAll('button').find((b) => b.text() === '编辑')!.trigger('click')
    await flushPromises()
    expect(wrapper.find('.reader').exists()).toBe(false)
    expect(wrapper.find('.editor').exists()).toBe(true)
    wrapper.unmount()
  })
})
