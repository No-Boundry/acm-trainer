import { IpcChannels } from '@shared/channels'
import type { Repos } from '../services'
import { SETTING_DEFAULTS } from '../db/repositories/settings'
import { handle } from './helpers'

export function registerSettingsIpc(repos: Repos): void {
  handle<{ key: string }, { value: string | null }>(IpcChannels.SettingsGet, ({ key }) => ({
    value: repos.settings.get(key)
  }))

  handle<{ key: string; value: string }, { ok: boolean }>(
    IpcChannels.SettingsSet,
    ({ key, value }) => {
      repos.settings.set(key, value)
      return { ok: true }
    }
  )

  handle<unknown, Record<string, string>>(IpcChannels.SettingsGetAll, () => {
    const current = repos.settings.getAll()
    return { ...SETTING_DEFAULTS, ...current }
  })
}
