/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}

import type { IpcResponse } from '@shared/types'

declare global {
  interface Window {
    api: {
      invoke: <T = unknown>(channel: string, payload?: unknown) => Promise<IpcResponse<T>>
      on: (channel: string, cb: (data: unknown) => void) => () => void
    }
  }
}

export {}
