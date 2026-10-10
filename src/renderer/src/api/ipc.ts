/** 渲染进程 IPC 调用封装：自动解包统一响应并抛错（docs/03-详细设计 §3.3） */
export class IpcError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'IpcError'
  }
}

export async function invoke<T>(channel: string, payload?: unknown): Promise<T> {
  const res = await window.api.invoke<T>(channel, payload)
  if (!res.ok) throw new IpcError(res.error.code, res.error.message)
  return res.data
}

export function on(channel: string, cb: (data: unknown) => void): () => void {
  return window.api.on(channel, cb)
}
