/**
 * 性能自查：在「真实题库规模」下测量启动、页面切换与关键 IPC 的耗时（`npm run verify:perf`）。
 *
 * 做法：把 `%APPDATA%\acm-trainer\acm-trainer.db` 用 better-sqlite3 的 backup() 复制到临时目录，
 * 再用 ACM_USER_DATA 指向副本启动 —— 既拿到真实数据量，又不会写坏用户的库。
 *
 * 不用 gui-lib.launchApp，因为它会给目录加 pid 后缀并强制清空，没法预置数据。
 *
 * 参考值（真实库 3.17 万题 / 94 条提交记录，Windows 本机）：
 *   v1.14.0 优化前：首页统计卡片 13984 ms、recommend:get 12498 ms
 *   v1.14.1 优化后：首页统计卡片   787 ms、recommend:get    33 ms
 */
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const Database = require('better-sqlite3')
const { _electron } = require('playwright-core')

const ROOT = path.join(__dirname, '..')
const SRC = path.join(process.env.APPDATA || '', 'acm-trainer', 'acm-trainer.db')

const time = async (label, fn) => {
  const s = Date.now()
  const r = await fn()
  console.log(`  ${label.padEnd(42)} ${String(Date.now() - s).padStart(7)} ms`)
  return r
}

async function launchOn(dbDir) {
  const env = { ...process.env, ACM_USER_DATA: dbDir }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await _electron.launch({ args: ['.', '--no-sandbox'], cwd: ROOT, env })
  const win = await app.firstWindow()
  win.on('dialog', (d) => void d.accept())
  await win.waitForLoadState('domcontentloaded')
  return { app, win }
}

;(async () => {
  const base = path.join(os.tmpdir(), `acm-perf-${Date.now()}`)
  const dbDir = path.join(base, 'userdata')
  fs.mkdirSync(dbDir, { recursive: true })
  const src = new Database(SRC, { readonly: true })
  await src.backup(path.join(dbDir, 'acm-trainer.db'))
  src.close()
  const mb = (fs.statSync(path.join(dbDir, 'acm-trainer.db')).size / 1048576).toFixed(1)
  console.log(`真实库副本 ${mb} MB\n`)

  let app
  try {
    const t0 = Date.now()
    const launched = await launchOn(dbDir)
    app = launched.app
    const win = launched.win
    console.log(`冷启动到 DOMContentLoaded ${Date.now() - t0} ms`)

    await time('首页统计卡片可见', () => win.locator('.cards .card').first().waitFor({ timeout: 30000 }))
    await time('首页推荐区出现条目', () => win.locator('.rec-item').first().waitFor({ timeout: 60000 }))
    console.log(
      `  推荐条目 ${await win.locator('.rec-item').count()} 条，标签 ${await win.locator('.tag-chip').count()} 个`
    )

    console.log('\n[页面切换：导航点击 → 目标内容可见]')
    await time('首页 → 题库（表格首行）', async () => {
      await win.locator('.nav-item', { hasText: '题库' }).click()
      await win.locator('table tbody tr').first().waitFor({ timeout: 30000 })
    })
    await time('题库 → 首页（统计卡片）', async () => {
      await win.locator('.nav-item', { hasText: '首页' }).click()
      await win.locator('.cards .card').first().waitFor({ timeout: 30000 })
    })
    await time('首页 → 题库 第二次', async () => {
      await win.locator('.nav-item', { hasText: '题库' }).click()
      await win.locator('table tbody tr').first().waitFor({ timeout: 30000 })
    })
    await time('首页 → 学习路径（节点卡片）', async () => {
      await win.locator('.nav-item', { hasText: '学习路径' }).click()
      await win.locator('.node-card, .skill-node, .card').first().waitFor({ timeout: 30000 })
    })

    console.log('\n[IPC 直接计时]')
    for (const [ch, arg] of [
      ['problems:list', { page: 1, pageSize: 50, source: 'all' }],
      ['skill:get', { trackId: 'all' }],
      ['stats:tagUsage', {}],
      ['recommend:get', {}],
      ['recommend:get', {}]
    ]) {
      await time(`invoke ${ch}`, () =>
        win.evaluate(
          ([c, a]) => window.api.invoke(c, a).then((r) => (r.ok ? 1 : Promise.reject(new Error(r.error)))),
          [ch, arg]
        )
      )
    }

    await win.screenshot({ path: path.join(ROOT, '.gui-verify', 'perf-dashboard.png') })
  } finally {
    if (app) await app.close()
    fs.rmSync(base, { recursive: true, force: true })
  }
})().catch((e) => {
  console.error('FAILED:', e.message)
  process.exit(1)
})
