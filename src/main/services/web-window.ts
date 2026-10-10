import { BrowserWindow, shell } from 'electron'

/**
 * 内部浏览器窗口（v2.0 FR-14.1：不再用于「打开题面」）。
 * 仅用于：① 洛谷登录（获取登录态 cookie，供题库页「UID 在线导入」使用）；
 * ② 在页面上下文内发起 fetch（携带登录 cookie，规避跨分区 cookie 不确定性）。
 * 安全：沙箱 + contextIsolation + 白名单域名导航 + 新窗口走系统浏览器 + 禁下载。
 */

const ALLOWED_HOSTS = [
  'codeforces.com',
  'cdn.codeforces.com',
  'luogu.com.cn',
  'www.luogu.com.cn',
  'cdn.luogu.com.cn',
  'fecdn.luogu.com.cn'
]

let loginWindow: BrowserWindow | null = null

/** 共享分区 session 的禁下载监听只挂一次（窗口重建复用同一 session，避免监听累积） */
const downloadGuarded = new WeakSet<Electron.Session>()

function guardDownloads(session: Electron.Session): void {
  if (!downloadGuarded.has(session)) {
    session.on('will-download', (event) => event.preventDefault())
    downloadGuarded.add(session)
  }
}

export function isAllowedHostUrl(url: string): boolean {
  if (!url.startsWith('https://')) return false
  try {
    const host = new URL(url).hostname
    return ALLOWED_HOSTS.includes(host) || host.endsWith('.codeforces.com')
  } catch {
    return false
  }
}

export function isLoginWindowOpen(): boolean {
  return loginWindow !== null && !loginWindow.isDestroyed()
}

function applyGuards(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) shell.openExternal(url)
    return { action: 'deny' }
  })
  const guard = (url: string): void => {
    if (!isAllowedHostUrl(url) && (url.startsWith('http://') || url.startsWith('https://'))) {
      shell.openExternal(url)
    }
  }
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedHostUrl(url)) {
      event.preventDefault()
      guard(url)
    }
  })
  win.webContents.on('will-redirect', (event, url) => {
    if (!isAllowedHostUrl(url)) {
      event.preventDefault()
      guard(url)
    }
  })
  guardDownloads(win.webContents.session)
}

/**
 * 打开（或复用）洛谷登录窗口。
 * @param url 目标地址（默认洛谷登录页）
 */
export function openLoginWindow(url = 'https://www.luogu.com.cn/auth/login'): void {
  if (!isAllowedHostUrl(url)) {
    shell.openExternal(url)
    return
  }
  if (isLoginWindowOpen() && loginWindow) {
    void loginWindow.webContents.loadURL(url)
    loginWindow.focus()
    return
  }
  const win = new BrowserWindow({
    width: 900,
    height: 760,
    minWidth: 640,
    minHeight: 520,
    title: '登录洛谷（用于题库页 UID 在线导入）',
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      partition: 'persist:statement' // 沿用既有分区，保留历史登录态
    }
  })
  win.on('closed', () => {
    if (loginWindow === win) loginWindow = null
  })
  applyGuards(win)
  loginWindow = win
  void win.loadURL(url)
}

/** 关闭登录窗口（主窗口关闭时兜底） */
export function closeLoginWindow(): void {
  if (!loginWindow || loginWindow.isDestroyed()) {
    loginWindow = null
    return
  }
  const w = loginWindow
  loginWindow = null
  w.close()
}

/** 登录窗口当前页面是否位于给定域名后缀（判断同源 fetch 前提） */
export function loginWindowHostIs(hostSuffix: string): boolean {
  if (!isLoginWindowOpen() || !loginWindow) return false
  try {
    return new URL(loginWindow.webContents.getURL()).hostname.endsWith(hostSuffix)
  } catch {
    return false
  }
}

/** 导航登录窗口并等待加载完成（登录态 cookie 保留；超时 20s） */
export async function navigateLoginWindowAndWait(url: string): Promise<void> {
  if (!isLoginWindowOpen() || !loginWindow) {
    throw new Error('登录窗口不可用')
  }
  const wc = loginWindow.webContents
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`窗口加载超时：${url}`))
    }, 20000)
    const onFinish = (): void => {
      cleanup()
      resolve()
    }
    const onFail = (_e: Electron.Event, code: number, desc: string): void => {
      cleanup()
      reject(new Error(`窗口加载失败(${code})：${desc}`))
    }
    const cleanup = (): void => {
      clearTimeout(timer)
      wc.removeListener('did-finish-load', onFinish)
      wc.removeListener('did-fail-load', onFail)
    }
    wc.once('did-finish-load', onFinish)
    wc.once('did-fail-load', onFail)
    void wc.loadURL(url)
  })
}

/**
 * 在登录窗口页面上下文内执行 fetch（同源请求自动携带该窗口登录 cookie）。
 * @returns 响应文本；窗口不可用时返回 null
 */
export async function fetchInLoginWindow(url: string, initJson?: string): Promise<string | null> {
  if (!isLoginWindowOpen() || !loginWindow) return null
  try {
    const js = `(async () => {
      try {
        const resp = await fetch(${JSON.stringify(url)}, ${initJson ?? 'undefined'});
        if (!resp.ok) return 'FETCH_ERR:HTTP ' + resp.status;
        return await resp.text();
      } catch (e) {
        return 'FETCH_ERR:' + String(e && e.message ? e.message : e);
      }
    })()`
    const result = await loginWindow.webContents.executeJavaScript(js, true)
    if (typeof result === 'string' && result.startsWith('FETCH_ERR:')) {
      throw new Error(result.slice('FETCH_ERR:'.length))
    }
    return typeof result === 'string' ? result : null
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(`窗口内请求失败：${msg}`)
  }
}
