import { BrowserWindow, shell } from 'electron'
import { join } from 'path'

/**
 * 创建主窗口。
 * 安全基线（docs/02-概要设计 §6）：contextIsolation + 无 nodeIntegration + sandbox。
 */
export function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    title: 'ACM-Trainer',
    backgroundColor: '#1e1e2e',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // 关闭内置拼写检查（中英混排内容会产生无意义红色波浪线）
      spellcheck: false
    }
  })

  win.on('ready-to-show', () => win.show())

  // 新窗口一律交给系统浏览器（应用内不弹子窗口）
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  // 开发模式加载 Vite Dev Server；生产加载打包产物
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}
