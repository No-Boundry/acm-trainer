/**
 * Electron GUI 探针（诊断用）：
 * 1) 记录版本/路径诊断到文件（即使崩溃也能留下线索）
 * 2) 创建窗口加载内联 HTML，2 秒后截图 PNG 到工作区
 * 3) 退出并写成功标记
 */
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const OUT_DIR = path.join(__dirname, '..', '.gui-probe')
const LOG = path.join(OUT_DIR, 'probe.log')
const SHOT = path.join(OUT_DIR, 'shot.png')

function log(msg) {
  try {
    fs.mkdirSync(OUT_DIR, { recursive: true })
    fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${msg}\n`, 'utf8')
  } catch {
    // ignore
  }
}

log(`start pid=${process.pid} cwd=${process.cwd()}`)
log(`process.versions=${JSON.stringify(process.versions)}`)
log(`argv=${JSON.stringify(process.argv)}`)

process.on('uncaughtException', (e) => log(`uncaughtException: ${e.stack || e}`))
process.on('unhandledRejection', (e) => log(`unhandledRejection: ${e}`))

app.setPath('userData', path.join(OUT_DIR, 'userData'))

app.whenReady().then(async () => {
  log('app.whenReady OK')
  try {
    const win = new BrowserWindow({
      width: 900,
      height: 640,
      show: true,
      title: 'ACM-Trainer GUI 探针',
      backgroundColor: '#1e1e2e',
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    log('BrowserWindow created')
    const html = `<!DOCTYPE html><html><body style="background:#1e1e2e;color:#cdd6f4;font-family:Segoe UI">
      <h1 style="color:#4f9cf9">GUI 探针 OK</h1>
      <p>Electron ${process.versions.electron} · Chromium ${process.versions.chrome}</p>
      <p id="t"></p><script>document.getElementById('t').textContent='渲染时间 '+new Date().toLocaleTimeString()</script>
    </body></html>`
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    log('loadURL OK, waiting 2000ms for paint')
    await new Promise((r) => setTimeout(r, 2000))
    const img = await win.webContents.capturePage()
    fs.writeFileSync(SHOT, img.toPNG())
    log(`capturePage OK -> ${SHOT} (${fs.statSync(SHOT).size} bytes)`)
    log('PROBE_SUCCESS')
    app.exit(0)
  } catch (e) {
    log(`probe failed: ${e.stack || e}`)
    app.exit(2)
  }
})

setTimeout(() => {
  log('PROBE_TIMEOUT (no whenReady within 15s)')
  app.exit(3)
}, 15000)
