import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { EVENT_CHANNELS, INVOKE_CHANNELS } from '../shared/channels'
import type { IpcResponse } from '../shared/types'

/**
 * 渲染进程白名单桥接（window.api）。
 * - invoke：仅允许 channels.ts 中 INVOKE_CHANNELS 声明的通道；
 * - on：仅允许 EVENT_CHANNELS 事件通道。
 * 渲染进程无 Node 能力（contextIsolation + sandbox，docs/02-概要设计 §3/§6）。
 */

const INVOKE_ALLOWED: ReadonlySet<string> = new Set(INVOKE_CHANNELS)
const EVENT_ALLOWED: ReadonlySet<string> = new Set(EVENT_CHANNELS)

const api = {
  invoke: <T = unknown>(channel: string, payload?: unknown): Promise<IpcResponse<T>> => {
    if (!INVOKE_ALLOWED.has(channel)) {
      return Promise.resolve({
        ok: false,
        error: { code: 'FORBIDDEN', message: `通道未授权: ${channel}` }
      })
    }
    return ipcRenderer.invoke(channel, payload)
  },
  on: (channel: string, cb: (data: unknown) => void): (() => void) => {
    if (!EVENT_ALLOWED.has(channel)) return () => undefined
    const listener = (_e: IpcRendererEvent, data: unknown): void => cb(data)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
