import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { IpcChannels } from '@shared/channels'
import { invoke, on, IpcError } from '@/api/ipc'
import { useProblemsStore } from '@/stores/problems'
import type { ProblemRow } from '@shared/types'

/**
 * 渲染进程 store 与 IPC 封装层单测（mock window.api，无需 Electron）。
 */

type Handler = (payload?: unknown) => unknown
interface ApiMock {
  api: {
    invoke: ReturnType<typeof vi.fn>
    on: ReturnType<typeof vi.fn>
  }
  listeners: Record<string, ((data: unknown) => void)[]>
  emit: (channel: string, data: unknown) => void
}

function setupApiMock(handlers: Record<string, Handler> = {}): ApiMock {
  const listeners: Record<string, ((data: unknown) => void)[]> = {}
  const api = {
    invoke: vi.fn(async (channel: string, payload?: unknown) => {
      // 模拟 Electron IPC 的结构化克隆：Vue 响应式 Proxy 等不可克隆对象必须在此抛错，
      // 否则打包应用里会出现 "An object couldn't be cloned"（2026-09 线上缺陷回归防护）
      let cloned: unknown
      try {
        cloned = structuredClone(payload)
      } catch {
        return {
          ok: false,
          error: { code: 'CLONE_FAILED', message: "An object couldn't be cloned" }
        }
      }
      const h = handlers[channel]
      if (!h) {
        return { ok: false, error: { code: 'NO_HANDLER', message: `no handler: ${channel}` } }
      }
      try {
        return { ok: true, data: await h(cloned) }
      } catch (e) {
        return { ok: false, error: { code: 'TEST', message: String(e) } }
      }
    }),
    on: vi.fn((channel: string, cb: (d: unknown) => void) => {
      ;(listeners[channel] ??= []).push(cb)
      return () => undefined
    })
  }
  vi.stubGlobal('window', { api })
  return {
    api,
    listeners,
    emit: (channel, data) => {
      ;(listeners[channel] ?? []).forEach((cb) => cb(data))
    }
  }
}

const sampleRows: ProblemRow[] = [
  {
    id: '1741:A',
    contestId: 1741,
    index: 'A',
    name: 'Test',
    rating: 800,
    difficulty: null,
    solvedCount: 10,
    totalSubmit: 0,
    source: 'cf',
    cfUrl: '',
    fetchedAt: '2026-01-01 00:00:00',
    tags: ['implementation'],
    practiced: false,
    lastStatus: null
  }
]

beforeEach(() => {
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('api/ipc.ts 封装', () => {
  it('ok → 返回 data', async () => {
    setupApiMock({ ping: () => ({ pong: 'pong' }) })
    await expect(invoke('ping')).resolves.toEqual({ pong: 'pong' })
  })

  it('!ok → 抛出 IpcError（含 code）', async () => {
    setupApiMock({} as Record<string, Handler>) // 无 handler → NO_HANDLER
    await expect(invoke('nope')).rejects.toBeInstanceOf(IpcError)
    await expect(invoke('nope')).rejects.toMatchObject({ code: 'NO_HANDLER' })
  })

  it('handler 抛错 → IpcError(TEST)', async () => {
    setupApiMock({ boom: () => { throw new Error('x') } })
    await expect(invoke('boom')).rejects.toMatchObject({ code: 'TEST' })
  })

  it('on 订阅返回退订函数', () => {
    const { api } = setupApiMock({})
    const off = on('evt', () => undefined)
    expect(typeof off).toBe('function')
    expect(api.on).toHaveBeenCalledWith('evt', expect.any(Function))
  })
})

describe('useProblemsStore', () => {
  it('init：加载标签/最近同步/列表，进度监听只注册一次', async () => {
    const { api } = setupApiMock({
      [IpcChannels.ProblemsTags]: () => ['dp', 'graph'],
      [IpcChannels.ProblemsLastSync]: () => ({ cf: '2026-01-01 00:00:00', luogu: null }),
      [IpcChannels.ProblemsList]: () => ({ total: 1, items: sampleRows })
    })
    const store = useProblemsStore()
    store.init()
    store.init() // 重复挂载
    await vi.waitFor(() => expect(store.allTags.length).toBe(2))
    expect(store.lastSync.cf).toBe('2026-01-01 00:00:00')
    expect(store.total).toBe(1)
    expect(store.items.length).toBe(1)
    // 进度监听只注册一次（防泄漏）
    const onCalls = api.on.mock.calls.filter(([c]) => c === IpcChannels.ProblemsSyncProgress)
    expect(onCalls.length).toBe(1)
  })

  it('setFilter：合并条件并重置页码为 1，携带完整 payload 请求', async () => {
    const listPayloads: unknown[] = []
    setupApiMock({
      [IpcChannels.ProblemsTags]: () => [],
      [IpcChannels.ProblemsLastSync]: () => ({ cf: null, luogu: null }),
      [IpcChannels.ProblemsList]: (p) => {
        listPayloads.push(p)
        return { total: 0, items: [] }
      }
    })
    const store = useProblemsStore()
    store.init()
    await vi.waitFor(() => expect(listPayloads.length).toBeGreaterThan(0))
    store.setPage(3)
    store.setFilter({ ratingMin: 1200, ratingMax: 1600, tags: ['dp'], keyword: '1741' })
    await vi.waitFor(() => expect(listPayloads.length).toBeGreaterThanOrEqual(3))
    const last = listPayloads[listPayloads.length - 1] as Record<string, unknown>
    expect(last.page).toBe(1) // 筛选后回到第一页
    expect(last.ratingMin).toBe(1200)
    expect(last.tags).toEqual(['dp'])
    expect(last.pageSize).toBe(20)
    expect(last.source).toBe('all')
  })

  it('setSource：洛谷视图清 CF rating；切回 cf 清洛谷难度（防空列表）', async () => {
    const listPayloads: unknown[] = []
    setupApiMock({
      [IpcChannels.ProblemsTags]: () => [],
      [IpcChannels.ProblemsLastSync]: () => ({ cf: null, luogu: null }),
      [IpcChannels.ProblemsList]: (p) => {
        listPayloads.push(p)
        return { total: 0, items: [] }
      }
    })
    const store = useProblemsStore()
    store.init()
    await vi.waitFor(() => expect(listPayloads.length).toBeGreaterThan(0))

    store.setFilter({ ratingMin: 1200 })
    store.setSource('luogu')
    await vi.waitFor(() => expect(listPayloads.length).toBeGreaterThanOrEqual(2))
    let last = listPayloads[listPayloads.length - 1] as Record<string, unknown>
    expect(last.source).toBe('luogu')
    expect(last.ratingMin).toBeNull() // 洛谷视图清除 CF 难度区间

    // 洛谷视图下设置难度筛选，然后切回 cf —— 难度筛选必须被清掉
    store.setFilter({ difficulty: 2 })
    store.setSource('cf')
    await vi.waitFor(() => expect(listPayloads.length).toBeGreaterThanOrEqual(4))
    last = listPayloads[listPayloads.length - 1] as Record<string, unknown>
    expect(last.source).toBe('cf')
    expect(last.difficulty).toBeNull() // 否则 CF 行 difficulty=null 全被过滤 → 空列表
  })

  it('sync(cf)：成功后刷新最近同步时间与标签', async () => {
    setupApiMock({
      [IpcChannels.ProblemsTags]: () => ['dp'],
      [IpcChannels.ProblemsLastSync]: () => ({ cf: '2026-02-02 10:00:00', luogu: null }),
      [IpcChannels.ProblemsList]: () => ({ total: 0, items: [] }),
      [IpcChannels.ProblemsSync]: () => ({ added: 10, updated: 0, fetchedAt: '2026-02-02 10:00:00' })
    })
    const store = useProblemsStore()
    store.init()
    await vi.waitFor(() => expect(store.lastSync.cf).toBe('2026-02-02 10:00:00'))
    await store.sync('cf')
    expect(store.lastSync.cf).toBe('2026-02-02 10:00:00')
  })

  it('sync(luogu)：走 luogu:sync 通道并刷新洛谷同步时间', async () => {
    const { api } = setupApiMock({
      [IpcChannels.ProblemsTags]: () => [],
      [IpcChannels.ProblemsLastSync]: () => ({ cf: null, luogu: '2026-03-01 00:00:00' }),
      [IpcChannels.ProblemsList]: () => ({ total: 0, items: [] }),
      [IpcChannels.LuoguSync]: () => ({ added: 100, updated: 0, fetchedAt: '2026-03-01 00:00:00', totalPages: 3 })
    })
    const store = useProblemsStore()
    store.init()
    await vi.waitFor(() => expect(store.lastSync.luogu).toBe('2026-03-01 00:00:00'))
    await store.sync('luogu')
    expect(api.invoke.mock.calls.map((c) => c[0])).toContain(IpcChannels.LuoguSync)
    expect(store.lastSync.luogu).toBe('2026-03-01 00:00:00')
  })

  it('同步进度事件更新 syncProgress', async () => {
    const { emit } = setupApiMock({
      [IpcChannels.ProblemsTags]: () => [],
      [IpcChannels.ProblemsLastSync]: () => ({ cf: null, luogu: null }),
      [IpcChannels.ProblemsList]: () => ({ total: 0, items: [] })
    })
    const store = useProblemsStore()
    store.init()
    emit(IpcChannels.ProblemsSyncProgress, { stage: 'writing', percent: 50, message: '写入中' })
    expect(store.syncProgress).toMatchObject({ percent: 50, stage: 'writing' })
  })
})

