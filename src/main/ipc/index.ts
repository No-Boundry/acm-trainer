import { ipcMain, app } from 'electron'
import { IpcChannels } from '@shared/channels'
import type { IpcResponse } from '@shared/types'
import type { Repos } from '../services'
import { registerProblemsIpc } from './problems'
import { registerRecordsIpc } from './records'
import { registerNotesIpc } from './notes'
import { registerTemplatesIpc } from './templates'
import { registerContestsIpc } from './contests'
import { registerSettingsIpc } from './settings'
import { registerRatingIpc } from './rating'
import { registerStatementIpc } from './statement'
import { registerDataIpc } from './data'
import { registerLuoguIpc } from './luogu'
import { registerLeetcodeIpc } from './leetcode'
import { registerListsIpc } from './lists'
import { registerPlansIpc } from './plans'
import { registerProfileIpc } from './profile'
import { registerSkillIpc } from './skill'

/**
 * IPC 处理器注册入口。
 * 各域 handler 均返回统一响应 IpcResponse<T>（docs/03-详细设计 §3）。
 */
export function registerIpc(repos: Repos): void {
  // 冒烟通道（版本取 package.json，避免硬编码与实际构建不一致）
  ipcMain.handle(
    IpcChannels.Ping,
    (): IpcResponse<{ pong: string; version: string }> => ({
      ok: true,
      data: {
        pong: `pong @ ${new Date().toLocaleTimeString()}`,
        version: app.getVersion()
      }
    })
  )

  registerProblemsIpc(repos)
  registerRecordsIpc(repos)
  registerNotesIpc(repos)
  registerTemplatesIpc(repos)
  registerContestsIpc(repos)
  registerSettingsIpc(repos)
  registerRatingIpc(repos)
  registerStatementIpc(repos)
  registerDataIpc()
  registerLuoguIpc(repos)
  registerLeetcodeIpc(repos)
  registerListsIpc(repos)
  registerPlansIpc(repos)
  registerProfileIpc(repos)
  registerSkillIpc(repos)
}
