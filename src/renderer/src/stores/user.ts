import { defineStore } from 'pinia'
import { invoke } from '@/api/ipc'
import { IpcChannels } from '@shared/channels'

interface PickAvatarResult {
  canceled: boolean
  fileName?: string
  dataUrl?: string
}

/**
 * 个人资料（v1.4：用户名与头像）。
 * 数据存 settings（userName/avatarFile + userData/avatar.*），头像以 dataURL 供 <img> 展示。
 */
export const useUserStore = defineStore('user', {
  state: () => ({
    name: '',
    avatarUrl: null as string | null,
    loaded: false
  }),
  actions: {
    async load(): Promise<void> {
      try {
        const all = await invoke<Record<string, string>>(IpcChannels.SettingsGetAll)
        this.name = all.userName ?? ''
        const r = await invoke<{ dataUrl: string | null }>(IpcChannels.ProfileReadAvatar)
        this.avatarUrl = r.dataUrl
      } catch {
        // 保持现状
      } finally {
        this.loaded = true
      }
    },
    async saveName(name: string): Promise<void> {
      this.name = name
      await invoke(IpcChannels.SettingsSet, { key: 'userName', value: name })
    },
    async pickAvatar(): Promise<void> {
      const r = await invoke<PickAvatarResult>(IpcChannels.ProfilePickAvatar)
      if (r.canceled) return
      this.avatarUrl = r.dataUrl ?? null
    },
    async clearAvatar(): Promise<void> {
      await invoke(IpcChannels.SettingsSet, { key: 'avatarFile', value: '' })
      this.avatarUrl = null
    }
  }
})
