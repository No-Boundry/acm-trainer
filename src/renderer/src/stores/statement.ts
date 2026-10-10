import { defineStore } from 'pinia'
import { invoke } from '@/api/ipc'
import { IpcChannels } from '@shared/channels'

/**
 * 题面打开（v1.8）：统一交给 Edge 浏览器（缺失时主进程回退系统默认浏览器）。
 * 应用内不再内嵌/弹窗展示题面。
 */
export const useStatementStore = defineStore('statement', {
  state: () => ({}),
  actions: {
    async openStatement(problemId: string): Promise<'edge' | 'default-browser'> {
      const r = await invoke<{ ok: boolean; via: 'edge' | 'default-browser' }>(
        IpcChannels.StatementOpen,
        { problemId }
      )
      return r.via
    }
  }
})
