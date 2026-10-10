import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { IpcResponse } from '@shared/types'
import { AppError } from '../db/errors'

/**
 * 统一 IPC handler 注册器：自动捕获错误并包装为 IpcResponse<T>。
 * docs/03-详细设计 §3.3。
 */
export function handle<TReq, TRes>(
  channel: string,
  fn: (req: TReq, event: IpcMainInvokeEvent) => TRes | Promise<TRes>
): void {
  ipcMain.handle(channel, async (event, req: TReq): Promise<IpcResponse<TRes>> => {
    try {
      const data = await fn(req, event)
      return { ok: true, data }
    } catch (err) {
      if (err instanceof AppError) {
        return { ok: false, error: { code: err.code, message: err.message } }
      }
      console.error(`[ipc:${channel}]`, err)
      return {
        ok: false,
        error: { code: 'UNKNOWN', message: err instanceof Error ? err.message : String(err) }
      }
    }
  })
}

/** 向发起请求的窗口推送进度事件（main -> renderer） */
export function pushEvent(event: IpcMainInvokeEvent, channel: string, payload: unknown): void {
  if (!event.sender.isDestroyed()) {
    event.sender.send(channel, payload)
  }
}
