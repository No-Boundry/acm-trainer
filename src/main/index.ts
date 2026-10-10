import { app, BrowserWindow, dialog } from 'electron'
import { appendFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { initDb } from './db'
import { createRepos } from './services'
import { closeLoginWindow } from './services/web-window'
import { createWindow } from './window'
import { registerIpc } from './ipc'

/**
 * 启动期崩溃可见化：任何未捕获异常/拒绝都弹窗 + 写崩溃日志到 userData，
 * 便于在用户机器上定位启动失败原因。
 */
function crashLogPath(): string {
  return join(app.getPath('userData'), 'crash.log')
}

function reportCrash(kind: string, err: unknown): void {
  const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)
  const line = `\n[${new Date().toISOString()}] ${kind}: ${msg}\n`
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    appendFileSync(crashLogPath(), line, 'utf8')
  } catch {
    // 日志写失败不影响弹窗
  }
  try {
    dialog.showErrorBox(
      'ACM-Trainer 启动失败',
      `${kind}: ${msg}\n\n崩溃日志已写入:\n${crashLogPath()}`
    )
  } catch {
    // 弹窗失败（如无显示）时忽略
  }
}

process.on('uncaughtException', (err) => {
  reportCrash('uncaughtException', err)
  // 极端情况下（例如被以 ELECTRON_RUN_AS_NODE 启动，electron.app 不可用）不能再调 app.exit，
  // 否则会掩盖真正的首个异常；退回 process.exit 保证退出码正确。
  try {
    app.exit(1)
  } catch {
    process.exit(1)
  }
})
process.on('unhandledRejection', (reason) => {
  reportCrash('unhandledRejection', reason)
})

app.whenReady().then(() => {
  // 自动化验收/测试可指定独立 userData（避免触碰真实数据）：ACM_USER_DATA=<dir>
  const overrideUserData = process.env['ACM_USER_DATA']
  if (overrideUserData) {
    app.setPath('userData', overrideUserData)
  }

  // 初始化本地数据库（userData 目录，与 docs/03-详细设计 §1 一致）
  initDb(join(app.getPath('userData'), 'acm-trainer.db'))

  // 注册 IPC 处理器（各域按 docs/03 §3）
  registerIpc(createRepos())

  const win = createWindow()
  // 主窗口关闭时一并关闭登录窗口（避免 window-all-closed 语义被其悬挂）
  win.on('closed', () => closeLoginWindow())

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const w = createWindow()
      w.on('closed', () => closeLoginWindow())
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
