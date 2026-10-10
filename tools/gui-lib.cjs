/**
 * GUI 验收共享库：日志、断言、临时库种子、应用启动（独立 userData，不动真实数据）。
 */
const { _electron } = require('playwright-core')
const fs = require('fs')
const path = require('path')
const Database = require('better-sqlite3')

const ROOT = path.join(__dirname, '..')

function createRunner(outDirName) {
  const OUT = path.join(ROOT, outDirName)
  const USER_DATA = path.join(OUT, 'userData')
  const LOG = path.join(OUT, 'verify.log')
  const results = []

  const log = (msg) => {
    const line = `[${new Date().toISOString()}] ${msg}`
    console.log(line)
    fs.mkdirSync(OUT, { recursive: true })
    fs.appendFileSync(LOG, line + '\n', 'utf8')
  }
  const check = (name, ok, extra = '') => {
    results.push({ name, ok, extra })
    log(`${ok ? 'PASS' : 'FAIL'} — ${name}${extra ? ' :: ' + extra : ''}`)
  }
  const summary = () => {
    const failed = results.filter((r) => !r.ok)
    log(`SUMMARY: ${results.length - failed.length}/${results.length} 检查通过`)
    if (failed.length) log('FAILED: ' + failed.map((f) => f.name).join('; '))
    return failed.length ? 1 : 0
  }
  const shot = async (win, name) => {
    fs.mkdirSync(OUT, { recursive: true })
    await win.screenshot({ path: path.join(OUT, name) })
  }

  return { OUT, USER_DATA, LOG, log, check, summary, shot, results }
}

/** 预置题目与练习记录（贪心 9 道不同题各 AC 一次 → 基本掌握；DP：1 AC + 1 WA → 初学） */
function seedData(userDataDir) {
  const db = new Database(path.join(userDataDir, 'acm-trainer.db'))
  const now = '2026-09-12 20:00:00'
  const insertProblem = db.prepare(
    `INSERT OR REPLACE INTO problems (id, contest_id, "index", name, rating, difficulty,
       solved_count, total_submit, source, cf_url, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)`
  )
  const insertTag = db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)')
  const getTag = db.prepare('SELECT id FROM tags WHERE name = ?')
  const linkTag = db.prepare('INSERT OR IGNORE INTO problem_tags (problem_id, tag_id) VALUES (?, ?)')
  const insertRecord = db.prepare(
    `INSERT INTO practice_records (problem_id, status, duration_seconds, note, is_mistake, created_at)
     VALUES (?, ?, 600, 'seed', 0, ?)`
  )

  const greedy = Array.from({ length: 9 }, (_, i) => [
    `80${i}:A`,
    80 + i,
    'A',
    `Greedy ${i + 1}`,
    800 + i * 50,
    null,
    'cf',
    ['greedy', 'sortings']
  ])
  const problems = [
    ...greedy,
    ['801:B', 801, 'B', 'DP Easy', 1200, null, 'cf', ['dp']],
    ['802:C', 802, 'C', 'DP Medium', 1400, null, 'cf', ['dp', 'graphs']],
    ['P1001', 0, 'P1001', 'A+B Problem', null, 1, 'luogu', ['模拟']],
    ['P3374', 0, 'P3374', '树状数组 1', null, 4, 'luogu', ['树状数组']],
    // v1.9 力扣（index = titleSlug，难度 1 简单 / 2 中等 / 3 困难）
    ['LC1', 0, 'two-sum', '两数之和', null, 1, 'leetcode', ['数组', '哈希表']],
    ['LC146', 0, 'lru-cache', 'LRU 缓存', null, 2, 'leetcode', ['设计', '哈希表', '链表']],
    ['LC23', 0, 'merge-k-sorted-lists', '合并 K 个升序链表', null, 3, 'leetcode', ['链表', '分治', '堆（优先队列）']]
  ]
  for (const [id, contestId, index, name, rating, difficulty, source, tags] of problems) {
    insertProblem.run(
      id,
      contestId,
      index,
      name,
      rating,
      difficulty,
      source,
      source === 'luogu'
        ? `https://www.luogu.com.cn/problem/${id}`
        : source === 'leetcode'
          ? `https://leetcode.cn/problems/${index}/`
          : `https://codeforces.com/problemset/problem/${contestId}/${index}`,
      now
    )
    for (const tag of tags) {
      insertTag.run(tag)
      const row = getTag.get(tag)
      linkTag.run(id, row.id)
    }
  }
  for (let i = 0; i < 9; i++) insertRecord.run(`80${i}:A`, 'AC', now)
  insertRecord.run('801:B', 'AC', now)
  insertRecord.run('802:C', 'WA', now)
  // 力扣：简单 AC、中等 AC、困难 WA → 「力扣练习水平」与「难度分布」均有数据
  insertRecord.run('LC1', 'AC', now)
  insertRecord.run('LC146', 'AC', now)
  insertRecord.run('LC23', 'WA', now)
  db.close()
}

/** 启动应用（独立 userData；表由应用启动时创建，之后调用 seedData 再 reload 即可见数据）
 *  extraEnv 用于注入测试钩子（如 ACM_TEST_SAVE_PATH / ACM_TEST_OPEN_PATH 跳过系统文件对话框） */
async function launchApp(userDataDir, extraArgs = [], extraEnv = {}) {
  // 唯一目录：避免上次异常退出后残留进程锁住同一目录（EPERM）
  const uniqueDir = `${userDataDir}-${process.pid}`
  try {
    fs.rmSync(uniqueDir, { recursive: true, force: true })
  } catch {
    // 目录被占用时忽略：改用新路径即可
  }
  const userDataDir2 = fs.existsSync(uniqueDir) ? `${uniqueDir}-${Date.now()}` : uniqueDir
  fs.mkdirSync(userDataDir2, { recursive: true })
  // ELECTRON_RUN_AS_NODE=1 会让 electron.exe 退化成纯 Node（没有 app/BrowserWindow），
  // 某些终端/工具链会注入该变量，这里显式剔除，保证启动的是真正的 GUI 进程。
  const childEnv = { ...process.env, ACM_USER_DATA: userDataDir2, ...extraEnv }
  delete childEnv.ELECTRON_RUN_AS_NODE
  const app = await _electron.launch({
    args: ['.', '--no-sandbox', ...extraArgs],
    cwd: ROOT,
    env: childEnv
  })
  const win = await app.firstWindow()
  // 自动接受 confirm/alert（例如「确定结束比赛？」），否则 Playwright 默认取消 → 流程中断
  win.on('dialog', (dialog) => {
    void dialog.accept()
  })
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1200)
  return { app, win, userDataDir: userDataDir2 }
}

/** 重新载入页面（种子数据写入后调用） */
async function reload(win, waitMs = 1200) {
  await win.reload()
  await win.waitForTimeout(waitMs)
}

async function gotoPage(win, label) {
  await win.locator('.nav-item', { hasText: label }).click()
  await win.waitForTimeout(1000)
}

module.exports = { ROOT, createRunner, seedData, launchApp, reload, gotoPage }
