import { app, BrowserWindow, dialog } from 'electron'
import { copyFileSync, existsSync, readFileSync, statSync } from 'fs'
import { extname, join } from 'path'
import { IpcChannels } from '@shared/channels'
import type { Repos } from '../services'
import { AppError } from '../db/errors'
import { handle } from './helpers'

/**
 * 个人资料（v1.4：用户名存 settings.userName；头像文件拷贝到 userData，settings.avatarFile 记文件名）。
 */

const ALLOWED_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
}
const MAX_AVATAR_BYTES = 5 * 1024 * 1024

export interface PickAvatarResult {
  canceled: boolean
  fileName?: string
  dataUrl?: string
}

function avatarPath(fileName: string): string {
  return join(app.getPath('userData'), fileName)
}

export function registerProfileIpc(repos: Repos): void {
  handle<unknown, PickAvatarResult>(IpcChannels.ProfilePickAvatar, async (_req, event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) throw new AppError('WINDOW_UNAVAILABLE', '无法获取窗口')
    const res = await dialog.showOpenDialog(win, {
      title: '选择头像图片',
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
      properties: ['openFile']
    })
    if (res.canceled || res.filePaths.length === 0) return { canceled: true }
    const src = res.filePaths[0]
    const ext = extname(src).toLowerCase()
    if (!ALLOWED_EXT[ext]) throw new AppError('VALIDATION', '仅支持 png/jpg/webp/gif 图片')
    const size = statSync(src).size
    if (size > MAX_AVATAR_BYTES) throw new AppError('VALIDATION', '头像图片不能超过 5MB')

    // 拷贝到 userData（覆盖旧头像），文件名固定 avatar<ext>
    const fileName = `avatar${ext}`
    copyFileSync(src, avatarPath(fileName))
    repos.settings.set('avatarFile', fileName)

    const dataUrl = readAvatarDataUrl(fileName)
    return { canceled: false, fileName, dataUrl: dataUrl ?? undefined }
  })

  handle<unknown, { dataUrl: string | null }>(IpcChannels.ProfileReadAvatar, () => {
    const fileName = repos.settings.get('avatarFile')
    if (!fileName) return { dataUrl: null }
    return { dataUrl: readAvatarDataUrl(fileName) }
  })
}

function readAvatarDataUrl(fileName: string): string | null {
  const p = avatarPath(fileName)
  if (!existsSync(p)) return null
  const ext = extname(p).toLowerCase()
  const mime = ALLOWED_EXT[ext]
  if (!mime) return null
  const buf = readFileSync(p)
  return `data:${mime};base64,${buf.toString('base64')}`
}
