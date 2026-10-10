/**
 * 力扣题库真实同步验收（v1.9 FR-21，需要联网访问 leetcode.cn）。
 *
 * 与 verify:gui / verify:smoke 的区别：那两个用种子数据、完全离线；本脚本**真实调用**
 * leetcode.cn（GET /api/problems/algorithms/ + 40 页 GraphQL 标签），首次约 1–2 分钟。
 *
 * 用法：npm run verify:lc
 * 产物：.gui-lc/lc-sync.log + 截图
 */
const fs = require('fs')
const path = require('path')
const Database = require('better-sqlite3')
const { createRunner, launchApp, reload, gotoPage } = require('./gui-lib.cjs')

const runner = createRunner('.gui-lc')
const { USER_DATA, log, check, summary, shot } = runner

const DB_PATH = () => path.join(currentUserData, 'acm-trainer.db')

let currentUserData = ''

function readDb(fn) {
  const db = new Database(DB_PATH(), { readonly: true })
  try {
    return fn(db)
  } finally {
    db.close()
  }
}

function leetcodeCount() {
  return readDb((db) => db.prepare("SELECT COUNT(*) AS c FROM problems WHERE source='leetcode'").get().c)
}

async function waitForSync(win, timeoutMs = 300000) {
  const deadline = Date.now() + timeoutMs
  let last = 0
  while (Date.now() < deadline) {
    const n = leetcodeCount()
    if (n !== last) {
      last = n
      log(`同步中… 已入库力扣题 ${n}`)
    }
    if (n > 3900) return n
    await win.waitForTimeout(5000)
  }
  return leetcodeCount()
}

async function main() {
  const { app, win, userDataDir } = await launchApp(USER_DATA)
  currentUserData = userDataDir

  log('=== 力扣题库真实同步（leetcode.cn）===')
  await gotoPage(win, '题库')
  check('初始力扣题数 = 0（未同步）', leetcodeCount() === 0, `实际 ${leetcodeCount()}`)

  const syncBtn = win.locator('button', { hasText: '同步力扣' })
  check('题库页存在「同步力扣」按钮', (await syncBtn.count()) > 0)
  await syncBtn.first().click()
  await win.waitForTimeout(3000)
  await shot(win, '01-lc-syncing.png')
  const progressText = await win.locator('.sync-progress, .progress, .toast').first().innerText().catch(() => '')
  log(`同步进度提示: ${progressText.replace(/\s+/g, ' ').slice(0, 120)}`)

  const count = await waitForSync(win)
  check('力扣题入库数 > 3900（算法题全集）', count > 3900, `实际 ${count}`)

  const stats = readDb((db) => ({
    total: db.prepare("SELECT COUNT(*) AS c FROM problems WHERE source='leetcode'").get().c,
    withTags: db
      .prepare(
        `SELECT COUNT(*) AS c FROM problems p WHERE p.source='leetcode'
           AND EXISTS (SELECT 1 FROM problem_tags pt WHERE pt.problem_id = p.id)`
      )
      .get().c,
    byDifficulty: db
      .prepare(
        `SELECT difficulty AS d, COUNT(*) AS c FROM problems WHERE source='leetcode' GROUP BY difficulty ORDER BY d`
      )
      .all(),
    tags: db
      .prepare(
        `SELECT COUNT(DISTINCT t.name) AS c FROM tags t JOIN problem_tags pt ON pt.tag_id = t.id
           JOIN problems p ON p.id = pt.problem_id WHERE p.source='leetcode'`
      )
      .get().c,
    sample: db
      .prepare("SELECT id, name, difficulty, cf_url AS url, solved_count AS ac FROM problems WHERE id='LC1'")
      .get()
  }))

  check(
    '难度分布合理（简单/中等/困难三档均有题）',
    stats.byDifficulty.length === 3 && stats.byDifficulty.every((r) => r.c > 500),
    JSON.stringify(stats.byDifficulty)
  )
  check('标签覆盖 > 90% 力扣题', stats.withTags / stats.total > 0.9, `${stats.withTags}/${stats.total}`)
  check('力扣标签词表已入库（> 100 个）', stats.tags > 100, `实际 ${stats.tags}`)
  check(
    '样例题正确（LC1 = 两数之和 / 简单 / leetcode.cn URL）',
    stats.sample &&
      stats.sample.name === '两数之和' &&
      stats.sample.difficulty === 1 &&
      String(stats.sample.url).startsWith('https://leetcode.cn/problems/'),
    JSON.stringify(stats.sample)
  )

  // 界面：切到力扣视图，列表渲染且题数与库一致
  await reload(win, 1800)
  await gotoPage(win, '题库')
  await win.locator('.source-switch .seg', { hasText: '力扣' }).first().click()
  await win.waitForTimeout(2000)
  const meta = (await win.locator('.meta-row').first().innerText()).replace(/\s+/g, ' ')
  const listed = Number((meta.match(/共\s*(\d+)\s*题/) || [])[1] ?? -1)
  check('力扣视图题数与库内一致', listed === count, `界面 ${listed} / 库 ${count}`)
  const rows = await win.locator('table.table tbody tr').count()
  check('列表渲染出行（分页 20 行）', rows > 0, `行数=${rows}`)
  const listText = await win.locator('table.table').innerText()
  check('列表显示力扣来源标签与中文难度', /力扣/.test(listText) && /(简单|中等|困难)/.test(listText))

  // 知识点筛选对力扣题生效（动态规划入门含力扣中文标签「动态规划」）
  await win.locator('.kn-panel .kn-toggle').click()
  await win.waitForTimeout(500)
  await win.locator('.kn-chip', { hasText: '动态规划入门' }).first().click()
  await win.waitForTimeout(2000)
  const dpMeta = (await win.locator('.meta-row').first().innerText()).replace(/\s+/g, ' ')
  const dpCount = Number((dpMeta.match(/共\s*(\d+)\s*题/) || [])[1] ?? 0)
  check('力扣视图 + 知识点筛选可筛出题（动态规划入门）', dpCount > 0, dpMeta)
  await shot(win, '02-lc-synced.png')

  await app.close().catch(() => undefined)
  await new Promise((r) => setTimeout(r, 800))
  check('退出后无 crash.log', !fs.existsSync(path.join(userDataDir, 'crash.log')))

  process.exit(summary())
}

main().catch((e) => {
  log('lc-sync crashed: ' + (e && e.stack ? e.stack : String(e)))
  process.exit(2)
})
