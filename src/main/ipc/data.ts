import { BrowserWindow, dialog } from 'electron'
import { statSync, writeFileSync, readFileSync, renameSync } from 'fs'
import { join } from 'path'
import { IpcChannels } from '@shared/channels'
import { getDb } from '../db'
import { AppError } from '../db/errors'
import { exportData, importData, type ImportCount } from '../services/data'
import { handle } from './helpers'

export interface ExportResult {
  canceled: boolean
  path?: string
  counts?: ImportCount[]
}

/** 导入文件大小上限（备份为全量题库 JSON，正常远小于此值） */
const MAX_IMPORT_BYTES = 200 * 1024 * 1024

/**
 * GUI 自动化验收钩子（tools/gui-smoke.cjs）：系统文件对话框无法被自动化驱动，
 * 设置 ACM_TEST_SAVE_PATH / ACM_TEST_OPEN_PATH 时跳过对话框直接使用该路径。
 * 仅在测试进程显式注入环境变量时生效，正常启动（无该变量）行为完全不变。
 */
function testDialogPath(key: 'ACM_TEST_SAVE_PATH' | 'ACM_TEST_OPEN_PATH'): string | undefined {
  const v = process.env[key]?.trim()
  return v ? v : undefined
}

export function registerDataIpc(): void {
  handle<unknown, ExportResult>(IpcChannels.DataExport, async (_req, event) => {
    let target = testDialogPath('ACM_TEST_SAVE_PATH')
    if (!target) {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) throw new AppError('WINDOW_UNAVAILABLE', '无法获取窗口')
      const stamp = new Date().toISOString().slice(0, 10)
      const res = await dialog.showSaveDialog(win, {
        title: '导出数据备份',
        defaultPath: `acm-trainer-backup-${stamp}.json`,
        filters: [{ name: 'JSON 备份', extensions: ['json'] }]
      })
      if (res.canceled || !res.filePath) return { canceled: true }
      target = res.filePath
    }

    const payload = exportData(getDb())
    const tmp = `${target}.tmp`
    try {
      // 先写临时文件再原子替换，避免写失败残留截断文件
      writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8')
      renameSync(tmp, target)
    } catch (e) {
      throw new AppError(
        'WRITE_FAILED',
        `导出失败: ${e instanceof Error ? e.message : String(e)}`
      )
    }
    return { canceled: false, path: target }
  })

  handle<unknown, ExportResult>(IpcChannels.DataImport, async (_req, event) => {
    let filePath = testDialogPath('ACM_TEST_OPEN_PATH')
    if (!filePath) {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) throw new AppError('WINDOW_UNAVAILABLE', '无法获取窗口')
      const res = await dialog.showOpenDialog(win, {
        title: '导入数据备份',
        filters: [{ name: 'JSON 备份', extensions: ['json'] }],
        properties: ['openFile']
      })
      if (res.canceled || res.filePaths.length === 0) return { canceled: true }
      filePath = res.filePaths[0]
    }

    // 大小限制（防止巨型/恶意备份耗尽主进程内存）
    try {
      const size = statSync(filePath).size
      if (size > MAX_IMPORT_BYTES) {
        throw new AppError('VALIDATION', `备份文件过大（${Math.round(size / 1024 / 1024)}MB，上限 200MB）`)
      }
    } catch (e) {
      if (e instanceof AppError) throw e
      throw new AppError('VALIDATION', `无法读取备份文件: ${e instanceof Error ? e.message : String(e)}`)
    }

    let payload: unknown
    try {
      payload = JSON.parse(readFileSync(filePath, 'utf8'))
    } catch {
      throw new AppError('VALIDATION', '备份文件无法解析（不是有效的 JSON）')
    }
    const counts = importData(getDb(), payload)
    return { canceled: false, path: join(filePath), counts }
  })
}
