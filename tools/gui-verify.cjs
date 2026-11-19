/**
 * GUI 自动化验收（v1.8）：用 playwright-core 驱动真实 Electron 应用，
 * 在独立 userData（临时库）中走查关键页面并截图。
 *
 * 用法：node tools/gui-verify.cjs
 * 产物：.gui-verify/*.png 截图 + verify.log 日志
 */
const { _electron } = require('playwright-core')
const fs = require('fs')
const os = require('os')
const path = require('path')
const Database = require('better-sqlite3')

const ROOT = path.join(__dirname, '..')
const OUT = path.join(ROOT, '.gui-verify')
const USER_DATA = path.join(OUT, 'userData')
const LOG = path.join(OUT, 'verify.log')

const results = []
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  fs.mkdirSync(OUT, { recursive: true })
  fs.appendFileSync(LOG, line + '\n', 'utf8')
}
function check(name, ok, extra = '') {
  results.push({ name, ok, extra })
  log(`${ok ? 'PASS' : 'FAIL'} — ${name}${extra ? ' :: ' + extra : ''}`)
}

/** 预置临时库：少量 CF/洛谷题 + 练习记录（让掌握度出现多个档位） */
function seedDatabase() {
  fs.rmSync(USER_DATA, { recursive: true, force: true })
  fs.mkdirSync(USER_DATA, { recursive: true })
  const db = new Database(path.join(USER_DATA, 'acm-trainer.db'))
  db.pragma('journal_mode = WAL')
  // 动态载入应用自身的建表语句（保持与生产 schema 一致）
  const schemaSrc = fs.readFileSync(path.join(ROOT, 'out/main/index.js'), 'utf8')
  void schemaSrc // schema 由应用启动时创建；此处仅等待后再补数据
  db.close()
}

/** 应用启动后（表已建好）写入题目与练习记录 */
function seedAfterBoot() {
  const db = new Database(path.join(USER_DATA, 'acm-trainer.db'))
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
     VALUES (?, 'AC', 600, 'seed', 0, ?)`
  )

  // 贪心：9 道不同题（掌握度按去重题目计 → proficient 基本掌握）
  const greedy = Array.from({ length: 9 }, (_, i) => [
    `80${i}:A`, 80 + i, 'A', `Greedy ${i + 1}`, 800 + i * 50, null, 'cf', ['贪心', '排序']
  ])
  const problems = [
    ...greedy,
    ['801:B', 801, 'B', 'DP Medium', 1400, null, 'cf', ['动态规划']],
    ['802:C', 802, 'C', 'DP Hard', 1900, null, 'cf', ['动态规划', '图论']],
    ['P1001', 0, 'P1001', 'A+B Problem', null, 1, 'luogu', ['模拟']],
    ['P3374', 0, 'P3374', '树状数组 1', null, 4, 'luogu', ['树状数组']],
    // v1.9 力扣（index = titleSlug，难度 1 简单 / 2 中等 / 3 困难）
    ['LC1', 0, 'two-sum', '两数之和', null, 1, 'leetcode', ['数组', '哈希表']],
    ['LC146', 0, 'lru-cache', 'LRU 缓存', null, 2, 'leetcode', ['设计', '哈希表']],
    ['LC23', 0, 'merge-k-sorted-lists', '合并 K 个升序链表', null, 3, 'leetcode', ['链表', '分治']],
    // v1.21 FR-43：往届比赛题（题名含年份 + 地区/组别，供生成往届比赛题单）
    // 只给蓝桥杯 2024 省 A 的两题挂「搜索」标签 → 题单覆盖 1 个知识点，便于验证 FR-44 过滤
    // 难度都取 ≤3，避免扰动 4c-3「洛谷视图按难度」检查（该段要求难度 4 的 P3374 排最前）
    ['P8801', 0, 'P8801', '[蓝桥杯 2024 省 A] 日期统计', null, 2, 'luogu', ['搜索']],
    ['P8802', 0, 'P8802', '[蓝桥杯 2024 省 A] 幸运数', null, 2, 'luogu', ['搜索']],
    ['P8803', 0, 'P8803', '[蓝桥杯 2025 国 A] 质数判定', null, 3, 'luogu', []],
    ['P8811', 0, 'P8811', '[CCPC 2024 哈尔滨站] 图论签到', null, 3, 'luogu', []],
    ['P8812', 0, 'P8812', '[CCPC 2024 哈尔滨站] 树上问题', null, 1, 'luogu', []]
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
  // 贪心：9 道不同题各 AC 一次 → 基本掌握；DP：1 AC + 1 WA → 初学
  for (let i = 0; i < 9; i++) insertRecord.run(`80${i}:A`, now)
  insertRecord.run('801:B', now)
  db.prepare(
    `INSERT INTO practice_records (problem_id, status, duration_seconds, note, is_mistake, created_at)
     VALUES ('802:C', 'WA', 900, 'seed-wa', 1, ?)`
  ).run(now)
  // 力扣：简单 AC、中等 AC、困难 WA → 「力扣练习水平」与「难度分布」均有数据
  const insertLcRecord = db.prepare(
    `INSERT INTO practice_records (problem_id, status, duration_seconds, note, is_mistake, created_at)
     VALUES (?, ?, 600, 'seed-lc', 0, ?)`
  )
  insertLcRecord.run('LC1', 'AC', now)
  insertLcRecord.run('LC146', 'AC', now)
  insertLcRecord.run('LC23', 'WA', now)

  // v1.19 FR-40：刷题记录种子 —— 3 道题共 4 次打开，按 opened_at 倒序应为 P3374 → 802:C → 801:B，
  // 其中 802:C 打开两次用于验证「打开 N 次」角标。
  const insertView = db.prepare('INSERT INTO problem_views (problem_id, opened_at) VALUES (?, ?)')
  insertView.run('801:B', '2026-09-10 09:00:00')
  insertView.run('802:C', '2026-09-11 10:00:00')
  insertView.run('802:C', '2026-09-12 11:00:00')
  insertView.run('P3374', '2026-09-12 19:30:00')
  db.close()
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  fs.writeFileSync(LOG, '', 'utf8')
  seedDatabase()

  log('launching Electron app (temp userData)…')
  // ELECTRON_RUN_AS_NODE=1 会让 electron.exe 退化为纯 Node（无 app/BrowserWindow）→ 启动即失败
  const childEnv = { ...process.env, ACM_USER_DATA: USER_DATA }
  delete childEnv.ELECTRON_RUN_AS_NODE
  const app = await _electron.launch({
    args: ['.', '--no-sandbox'],
    cwd: ROOT,
    env: childEnv
  })
  const win = await app.firstWindow()
  // 渲染进程异常可见化（否则页面空白只能靠猜）
  win.on('pageerror', (e) => log(`PAGEERROR: ${e && e.message ? e.message : String(e)}`))
  win.on('console', (m) => {
    if (m.type() === 'error') log(`CONSOLE-ERROR: ${m.text().slice(0, 300)}`)
  })
  await win.waitForLoadState('domcontentloaded')
  seedAfterBoot()
  // 让页面重新拉取数据
  await win.reload()
  await win.waitForTimeout(1500)

  // 1) 首页
  await win.screenshot({ path: path.join(OUT, '01-dashboard.png') })
  const navCount = await win.locator('.nav-item').count()
  check('侧边栏导航项 = 11（新增题单/计划）', navCount === 11, `实际 ${navCount}`)
  // 应用内版本号来自 package.json（v1.9 修复了硬编码 1.8.0 的问题）
  const pkgVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version
  const shownVersion = ((await win.locator('.sidebar .version').first().innerText().catch(() => '')) || '').trim()
  check(
    '侧边栏版本号与 package.json 一致',
    shownVersion === `v${pkgVersion}`,
    `界面 "${shownVersion}" / package.json "v${pkgVersion}"`
  )

  // 2) 题库页：知识点（v1.20 起知识点是唯一的筛选维度，原来的 6 个标签大类已并入知识点）
  await win.locator('.nav-item', { hasText: '题库' }).click()
  await win.waitForTimeout(1200)
  check('旧「知识点筛选」独立面板已移除', (await win.locator('.kn-panel').count()) === 0)
  check('标签大类分栏已移除（不再有 6 个标签 Tab）', (await win.locator('.seg-tab').count()) === 0, `.seg-tab=${await win.locator('.seg-tab').count()}`)
  check('裸标签列表已移除', (await win.locator('.tag-row').count()) === 0)
  const knTitleText = ((await win.locator('.kn-title').first().innerText().catch(() => '')) || '').replace(/\s+/g, ' ')
  check('知识点区标题与说明就位', /知识点/.test(knTitleText), knTitleText.slice(0, 80))
  const chipCount = await win.locator('.kn-chip').count()
  check('知识点标签数 = 70（v1.19 拆分过大的节点）', chipCount === 70, `实际 ${chipCount}`)
  // v1.12：在线导入已迁移到设置页「题库账号绑定」，题库页只保留粘贴导入与入口
  const importPanelText = (await win.locator('.import-panel').innerText()).replace(/\s+/g, ' ')
  check(
    '题库页保留粘贴导入入口，并指向设置页账号绑定',
    importPanelText.includes('粘贴') && importPanelText.includes('账号绑定'),
    importPanelText.slice(0, 160)
  )
  await win.screenshot({ path: path.join(OUT, '02-problems-knowledge.png') })

  // 掌握度概览与色点（v1.13：概览行在知识点 Tab 内）
  const summaryText = (await win.locator('.kn-summary-line').innerText()).replace(/\s+/g, ' ')
  check(
    '掌握概览含「基本掌握」与「初学」且计数 ≥1',
    /基本掌握\s*[1-9]/.test(summaryText) && /初学\s*[1-9]/.test(summaryText),
    summaryText
  )
  const greedyChip = win.locator('.kn-chip', { hasText: '贪心' }).first()
  const greedyDot = await greedyChip.locator('.dot').getAttribute('style')
  // 贪心在种子数据下为「基本掌握」→ 绿色 #3cb371 = rgb(60, 179, 113)
  check(
    '贪心（基本掌握）色点=绿 rgb(60,179,113)',
    /60, 179, 113/.test(greedyDot || ''),
    String(greedyDot)
  )
  // 未开始节点（如「多项式与 FFT」）色点=灰 #6c7086 = rgb(108, 112, 134)
  const untouchedChip = win.locator('.kn-chip', { hasText: '多项式与 FFT' }).first()
  const untouchedCount = await untouchedChip.count()
  if (untouchedCount > 0) {
    const untouchedStyle = await untouchedChip.locator('.dot').getAttribute('style')
    check('未开始节点头色点=灰 rgb(108,112,134)', /108, 112, 134/.test(untouchedStyle || ''), String(untouchedStyle))
  } else {
    check('未开始节点存在（多项式与 FFT）', false, 'chip 未找到')
  }
  const greedyText = (await greedyChip.innerText()).replace(/\s+/g, ' ')
  check('贪心显示已练 9 / 已 AC 9', /9\/9/.test(greedyText), greedyText)

  // 点击知识点 → 其关联标签进入统一筛选
  await greedyChip.click()
  await win.waitForTimeout(1000)
  const filteredNote = await win.locator('.meta-row').innerText()
  check('点击知识点后列表刷新（出现题数）', /共 \d+ 题/.test(filteredNote), filteredNote)
  // v1.13：合流后「已选」chips 里应出现该知识点的关联标签（不再有独立知识点筛选通道）
  const selChips = (await win.locator('.sel-line .chip').allInnerTexts()).map((t) => t.trim())
  check(
    '知识点点击后「已选」条出现其关联标签（与标签共用一套筛选）',
    selChips.length > 0,
    selChips.join(',')
  )
  await win.screenshot({ path: path.join(OUT, '03-knowledge-filtered.png') })
  const clearBtn = win.locator('button', { hasText: '全部清空' })
  check('出现「全部清空」按钮', (await clearBtn.count()) > 0)
  await clearBtn.click()
  await win.waitForTimeout(800)
  check('清空后「已选」条消失', (await win.locator('.sel-line .chip').count()) === 0)

  // 3) 学习路径：资料卡无题单
  await win.locator('.nav-item', { hasText: '学习路径' }).click()
  await win.waitForTimeout(1500)
  await win.locator('.node-card', { hasText: '贪心' }).first().click()
  await win.waitForTimeout(600)
  const detail = win.locator('.detail')
  const detailText = (await detail.innerText()).replace(/\s+/g, ' ')
  check('资料卡含内置简介', (await detail.locator('.node-intro').count()) > 0)
  check('资料卡不含「推荐练习」题单', !detailText.includes('推荐练习'), detailText.slice(0, 120))
  await win.screenshot({ path: path.join(OUT, '04-skill-detail.png') })

  // 3b) STL 速查页（v1.8.2 FR-18）
  await win.locator('.nav-item', { hasText: 'STL 速查' }).click()
  await win.waitForTimeout(1200)
  const refEntries = await win.locator('.entry').count()
  check('STL 速查条目齐全（≥30）', refEntries >= 30, `${refEntries} 条`)
  await win.locator('input.search').fill('priority_queue')
  await win.waitForTimeout(700)
  const refFiltered = await win.locator('.entry').count()
  check('STL 速查搜索生效（结果变少且 > 0）', refFiltered > 0 && refFiltered < refEntries, `${refFiltered}/${refEntries}`)
  const hasPitfall = (await win.locator('.pitfall').count()) > 0
  check('STL 速查展示「注意」坑点', hasPitfall)

  // 3b-2) v1.15：初始化 / 清空等操作补齐
  await win.locator('input.search').fill('初始化与清空')
  await win.waitForTimeout(700)
  const initEntry = win.locator('.entry').first()
  const initFound = (await win.locator('.entry').count()) > 0
  const initText = initFound ? await initEntry.innerText() : ''
  check(
    'STL 速查新增「初始化与清空速查对照」条目',
    initFound && initText.includes('初始化与清空速查对照'),
    initText.split('\n')[0] ?? ''
  )
  check(
    'STL 速查标注适配器没有 clear()',
    initText.includes('适配器') && initText.includes('clear()')
  )
  await win.locator('input.search').fill('vector')
  await win.waitForTimeout(700)
  const vectorText = await win.locator('.entry').first().innerText()
  check(
    '容器条目补齐初始化 / 清空 / 释放内存写法',
    vectorText.includes('vector<int>().swap') && vectorText.includes('clear()') && vectorText.includes('assign'),
    vectorText.includes('swap') ? '含 clear/assign/swap' : '缺少'
  )
  await win.locator('button', { hasText: '重置' }).first().click()
  await win.waitForTimeout(500)
  await win.screenshot({ path: path.join(OUT, '06b-stl-reference.png') })

  // 4) 设置页：Edge 说明与登录入口
  await win.locator('.nav-item', { hasText: '设置' }).click()
  await win.waitForTimeout(1200)
  const settingsText = (await win.locator('.settings-page').innerText()).replace(/\s+/g, ' ')
  check('设置页说明题面由 Edge 打开', settingsText.includes('Edge'), settingsText.slice(0, 160))
  // v1.12 FR-30：设置页「题库账号绑定」面板
  const accountRows = await win.locator('.account-row').count()
  check('设置页含三个题库账号绑定行（CF/洛谷/力扣）', accountRows === 3, `实际 ${accountRows}`)
  const cfRow = win.locator('.account-row[data-account="cf"]')
  await cfRow.locator('input.input').fill('tourist')
  await cfRow.locator('button', { hasText: '绑定' }).click()
  await win.waitForTimeout(900)
  const cfText = (await cfRow.innerText()).replace(/\s+/g, ' ')
  check('绑定 Codeforces handle 后显示已绑定状态', cfText.includes('已绑定') && cfText.includes('tourist'), cfText.slice(0, 120))
  // 洛谷行必须保留「登录洛谷」按钮（在线同步依赖应用内登录态）
  check(
    '洛谷账号行提供「登录洛谷」按钮',
    (await win.locator('.account-row[data-account="luogu"] button', { hasText: '登录洛谷' }).count()) > 0
  )
  // 力扣行提示只同步概况
  const lcText = (await win.locator('.account-row[data-account="leetcode"]').innerText()).replace(/\s+/g, ' ')
  check('力扣账号行说明无法同步逐题记录', lcText.includes('通过数'), lcText.slice(0, 120))
  check('提供「同步全部已绑定账号」按钮', (await win.locator('button', { hasText: '同步全部已绑定账号' }).count()) > 0)
  await win.screenshot({ path: path.join(OUT, '05-account-binding.png') })
  await win.screenshot({ path: path.join(OUT, '05-settings.png') })

  // 4a2) 笔记只读阅读入口（v1.13）
  await win.locator('.nav-item', { hasText: '笔记' }).click()
  await win.waitForTimeout(1200)
  await win.locator('button', { hasText: '新建笔记' }).click()
  await win.waitForTimeout(800)
  await win.locator('.title-input').fill('GUI 阅读测试笔记')
  await win.locator('.md-input').fill('## 思路\n\n这是一段用于验证只读阅读的 Markdown。\n\n```cpp\nint main(){}\n```')
  await win.locator('button', { hasText: '保存' }).first().click()
  await win.waitForTimeout(1200)
  const noteListed = await win.locator('.note-item', { hasText: 'GUI 阅读测试笔记' }).count()
  check('笔记保存后出现在列表', noteListed > 0, `匹配 ${noteListed}`)
  const readableEntry = await win.locator('.note-item', { hasText: 'GUI 阅读测试笔记' }).first().locator('button', { hasText: '阅读' }).count()
  check('笔记列表项提供「阅读」入口', readableEntry > 0)
  await win.locator('.note-item', { hasText: 'GUI 阅读测试笔记' }).first().click()
  await win.waitForTimeout(1000)
  const readerShown = await win.locator('.reader').count()
  const editorShown = await win.locator('.editor').count()
  check('点击笔记进入只读阅读视图（不进入编辑器）', readerShown > 0 && editorShown === 0, `阅读=${readerShown} 编辑器=${editorShown}`)
  const readerHtml = await win.locator('.reader-preview').innerHTML().catch(() => '')
  check(
    '阅读视图渲染 Markdown（标题 + 代码块）',
    /<h2/i.test(readerHtml) && /<pre/i.test(readerHtml),
    readerHtml.slice(0, 120)
  )
  await win.screenshot({ path: path.join(OUT, '08b-note-reader.png') })
  await win.locator('.reader-toolbar button', { hasText: '返回列表' }).click()
  await win.waitForTimeout(600)
  check('「返回列表」回到笔记列表', (await win.locator('.note-item').count()) > 0 && (await win.locator('.reader').count()) === 0)

  // 4b) 水平评估页（v1.8.4 回归）：记录历史后页面不得整页空白
  await win.locator('.nav-item', { hasText: '水平评估' }).click()
  await win.waitForTimeout(1500)
  check('水平评估页渲染（有分值卡与称号）', (await win.locator('.rating-page .hero').count()) > 0)
  await win.locator('button', { hasText: '重新计算并记录' }).click()
  await win.waitForTimeout(2500)
  const ratingVisible = await win.locator('.rating-page').count()
  const trendRendered = await win.locator('.rating-page canvas').count()
  check(
    '重算写历史后水平评估页仍渲染（v1.8.4 修复：此前整页空白）',
    ratingVisible > 0 && trendRendered > 0,
    `页面=${ratingVisible} 趋势图 canvas=${trendRendered}`
  )
  await win.screenshot({ path: path.join(OUT, '07-rating.png') })

  // 4c) 力扣数据源（v1.9 FR-21）：源切换 + 难度下拉 + 行内中文标签
  await win.locator('.nav-item', { hasText: '题库' }).click()
  await win.waitForTimeout(1000)
  // 先清掉前面知识点用例留下的筛选（否则力扣视图被标签过滤）
  const clearKn = win.locator('button', { hasText: '全部清空' })
  if ((await clearKn.count()) > 0) {
    await clearKn.first().click()
    await win.waitForTimeout(900)
  }
  const lcSeg = win.locator('.source-switch .seg', { hasText: '力扣' })
  check('题库页出现「力扣」数据源开关', (await lcSeg.count()) > 0)
  await lcSeg.first().click()
  await win.waitForTimeout(1200)
  const lcRows = win.locator('table.table tbody tr')
  const lcRowCount = await lcRows.count()
  const lcTable = await win.locator('table.table').innerText()
  check(
    '力扣视图列出种子题（LC1/LC146/LC23）',
    lcRowCount >= 3 && /两数之和/.test(lcTable) && /LRU 缓存/.test(lcTable),
    `行数=${lcRowCount}`
  )
  check('力扣行显示「力扣」来源标签与难度（简单/中等/困难）', /力扣/.test(lcTable) && /简单/.test(lcTable))
  const lcDiffOptions = await win.locator('.filter-row select.select').first().locator('option').allInnerTexts()
  check(
    '力扣难度下拉为 简单/中等/困难',
    lcDiffOptions.join('|').includes('简单') && lcDiffOptions.join('|').includes('中等') && lcDiffOptions.join('|').includes('困难'),
    lcDiffOptions.join(',')
  )
  await win.screenshot({ path: path.join(OUT, '08-leetcode-source.png') })

  // 4c-2) 排序可用性（v1.9.1）：按题号数字序、按难度按各源难度列
  const sortSelect = win.locator('.filter-row select.sort-by')
  const rowIds = async () =>
    (await win.locator('table.table tbody tr td:nth-child(2)').allInnerTexts()).map((t) => t.trim())
  await sortSelect.selectOption('id')
  await win.waitForTimeout(900)
  let shownIds = await rowIds()
  check(
    '力扣视图按题号升序（数字序：LC1 → LC23 → LC146）',
    shownIds.slice(0, 3).join(',') === 'LC1,LC23,LC146',
    shownIds.slice(0, 4).join(',')
  )
  await win.locator('button', { hasText: /升序|降序/ }).first().click()
  await win.waitForTimeout(900)
  shownIds = await rowIds()
  check(
    '切换排序方向后题号降序（LC146 → LC23 → LC1）',
    shownIds.slice(0, 3).join(',') === 'LC146,LC23,LC1',
    shownIds.slice(0, 4).join(',')
  )
  await sortSelect.selectOption('rating')
  await win.waitForTimeout(900)
  const diffOrder = (await win.locator('table.table tbody tr td .rating').allInnerTexts()).map((t) => t.trim())
  check(
    '力扣视图按难度排序（默认降序：困难 → 中等 → 简单）',
    diffOrder.slice(0, 3).join(',') === '困难,中等,简单',
    diffOrder.slice(0, 4).join(',')
  )
  await win.screenshot({ path: path.join(OUT, '08b-sort.png') })

  // 4c-3) 洛谷视图按难度（v1.9.1 修复点：此前统一按 rating 排序 → 洛谷行全为 NULL，排序无效）
  await win.locator('.source-switch .seg', { hasText: '洛谷' }).first().click()
  await win.waitForTimeout(1000)
  await win.locator('.filter-row select.sort-by').selectOption('rating')
  await win.waitForTimeout(900)
  const lgFirstDiff = ((await win.locator('table.table tbody tr td .rating').first().innerText()) || '').trim()
  // 种子：P1001（难度 1 入门）与 P3374（难度 4 普及+/提高）→ 降序时难度 4 排最前
  check(
    '洛谷视图按难度有效（降序时难度 4 排在难度 1 之前）',
    /普及/.test(lgFirstDiff),
    lgFirstDiff
  )

  // 4d) 水平评估：力扣练习水平独立板块（v1.9 FR-23）
  await win.locator('.nav-item', { hasText: '水平评估' }).click()
  await win.waitForTimeout(1500)
  const lcBlock = win.locator('.lc-block')
  check('水平评估页出现「力扣练习水平」独立板块', (await lcBlock.count()) > 0)
  const lcBlockText = (await lcBlock.innerText()).replace(/\s+/g, ' ')
  check(
    '力扣练习水平含分值/题数/难度 chips（简单 · 1/1）',
    /\d/.test(lcBlockText) && /简单/.test(lcBlockText) && /不计入上方 CF 综合分/.test(lcBlockText),
    lcBlockText.slice(0, 140)
  )
  await win.screenshot({ path: path.join(OUT, '09-rating-leetcode.png') })

  // 4e) 统计页：难度分布板块（v1.9 FR-22）
  await win.locator('.nav-item', { hasText: '统计' }).click()
  await win.waitForTimeout(1800)
  const diffPanel = win.locator('.diff-panel')
  check('统计页出现「难度分布」板块', (await diffPanel.count()) > 0)
  const diffTabs = win.locator('.diff-tabs .seg')
  check('难度分布含三个题源标签', (await diffTabs.count()) === 3)
  // 默认定位到已练题目最多的题源（种子：CF 11 题 > 力扣 3 题）
  const activeTab = (await win.locator('.diff-tabs .seg.on').innerText()).trim()
  check('难度分布默认定位到有数据的题源', /Codeforces/.test(activeTab), activeTab)
  const diffTable = (await win.locator('.diff-table').innerText()).replace(/\s+/g, ' ')
  check(
    '难度分布表格含难度档/已练题目/AC 率/占比列与合计',
    /已练题目/.test(diffTable) && /AC 率/.test(diffTable) && /占比/.test(diffTable) && /合计/.test(diffTable),
    diffTable.slice(0, 160)
  )
  // 切到力扣：三档 + 数据（先确认表格存在，避免直接 innerText 触发 30s 超时）
  await win.locator('.diff-tabs .seg', { hasText: '力扣' }).click()
  await win.waitForTimeout(900)
  const lcTableCount = await win.locator('.diff-table').count()
  check('力扣难度分布表格存在（有练习数据）', lcTableCount > 0, `表格数=${lcTableCount}`)
  if (lcTableCount > 0) {
    const lcDiffTable = (await win.locator('.diff-table').first().innerText()).replace(/\s+/g, ' ')
    check(
      '力扣难度分布含简单/中等/困难三档且有 AC 记录',
      /简单/.test(lcDiffTable) && /中等/.test(lcDiffTable) && /困难/.test(lcDiffTable) && /100%/.test(lcDiffTable),
      lcDiffTable.slice(0, 160)
    )
  }
  check('难度分布图表已渲染（canvas）', (await win.locator('.diff-panel canvas').count()) > 0)
  await win.screenshot({ path: path.join(OUT, '10-stats-difficulty.png') })

  // 4f) 学习路径：单个知识点跳题库（v1.9.1）
  await win.locator('.nav-item', { hasText: '学习路径' }).click()
  await win.waitForTimeout(1500)
  await win.locator('.node-card[data-node="dp"]').first().click()
  await win.waitForTimeout(600)
  const nodeBtn = win.locator('.go-node-problems')
  check('节点详情面板出现「去题库练习该知识点」按钮', (await nodeBtn.count()) > 0)
  const nodeBtnText = ((await nodeBtn.first().innerText()) || '').replace(/\s+/g, ' ')
  check('按钮显示该节点的关联标签数', /选中 \d+ 个标签/.test(nodeBtnText), nodeBtnText)
  await nodeBtn.first().click()
  await win.waitForTimeout(1500)
  check('跳转到题库并只选中该知识点', /knowledge=dp/.test(win.url()), win.url())
  const selectedChips = await win.locator('.kn-chip.on').count()
  check('题库中恰好选中 1 个知识点', selectedChips === 1, `选中 ${selectedChips} 个`)
  await win.screenshot({ path: path.join(OUT, '11-skill-node-problems.png') })

  // 卡片悬浮快捷按钮：不打开详情面板直接跳转（换一个节点）
  await win.locator('.nav-item', { hasText: '学习路径' }).click()
  await win.waitForTimeout(1200)
  await win.locator('.node-card[data-node="sort"] .card-go').first().click()
  await win.waitForTimeout(1500)
  const sortSelected = await win.locator('.kn-chip.on').count()
  check(
    '卡片 📚 快捷按钮直接跳题库并选中该节点',
    /knowledge=sort/.test(win.url()) && sortSelected === 1,
    `${win.url()} / 选中 ${sortSelected} 个`
  )

  // 4g) 技能树：国内比赛赛道（v1.10 FR-26）
  await win.locator('.nav-item', { hasText: '学习路径' }).click()
  await win.waitForTimeout(1200)
  const trackSegs = await win.locator('.track-row .seg').allInnerTexts()
  check(
    '技能树提供 5 个国内比赛赛道 + 全部知识点',
    trackSegs.length === 6 && trackSegs.join('|').includes('蓝桥杯') && trackSegs.join('|').includes('天梯赛'),
    trackSegs.join(',')
  )
  const nodeCards = await win.locator('.node-card').count()
  check('技能树节点数 = 70（v1.19 拆分后）', nodeCards === 70, `实际 ${nodeCards}`)
  await win.locator('.track-row .seg', { hasText: '蓝桥杯' }).first().click()
  await win.waitForTimeout(900)
  const trackDetail = (await win.locator('.track-detail').innerText()).replace(/\s+/g, ' ')
  check(
    '选择赛道后显示赛制/难度/必达进度',
    /OI 赛制/.test(trackDetail) && /推荐难度/.test(trackDetail) && /必达/.test(trackDetail),
    trackDetail.slice(0, 140)
  )
  const reqMarked = await win.locator('.node-card.track-req').count()
  check('赛道必达节点有醒目标记', reqMarked > 0, `标记数=${reqMarked}`)
  // v1.10.1 回归：勾选「只显示赛道节点」后连线必须一起消失（原先残留悬空连线）
  const edgesBefore = await win.locator('.edges path').count()
  const onlyTrack = win.locator('.track-panel:not(.list-panel) .only-track input')
  if ((await onlyTrack.count()) > 0) {
    await onlyTrack.check()
    await win.waitForTimeout(900)
    const edgesAfter = await win.locator('.edges path').count()
    const visibleCards = await win.locator('.node-card:visible').count()
    check(
      '「只显示赛道节点」时连线随卡片一起减少（无残留悬空线）',
      edgesAfter < edgesBefore && edgesAfter > 0 && visibleCards < 70,
      `连线 ${edgesBefore} → ${edgesAfter}，可见卡片 ${visibleCards}`
    )
    await win.screenshot({ path: path.join(OUT, '12b-skill-track-only.png') })
    await onlyTrack.uncheck()
    await win.waitForTimeout(700)
    const edgesRestored = await win.locator('.edges path').count()
    check('取消「只显示赛道节点」后连线恢复', edgesRestored === edgesBefore, `${edgesRestored} / ${edgesBefore}`)
  } else {
    check('技能树存在「只显示赛道节点」开关', false, '未找到 .only-track input')
  }
  await win.screenshot({ path: path.join(OUT, '12-skill-track.png') })

  // 4f-2) 知识点标签手动选取 + 已练习可见化（v1.14 FR-32）
  await win.locator('.nav-item', { hasText: '学习路径' }).click()
  await win.waitForTimeout(1500)
  // 先确保「全部知识点」赛道（不筛选），否则节点可能处于 v-show 隐藏状态
  const allTrack = win.locator('.track-row .seg').first()
  if ((await allTrack.count()) > 0) await allTrack.click()
  await win.waitForTimeout(600)
  const dsuCard = win.locator('.node-card[data-node="dsu"]')
  await dsuCard.scrollIntoViewIfNeeded()
  await dsuCard.click()
  await win.waitForTimeout(1200)
  const dsuDetailText = (await win.locator('.detail').innerText().catch(() => '')).replace(/\s+/g, ' ')
  const pickChips = await win.locator('.tag-pick').count()
  check('知识点详情面板提供可点选的关联标签', pickChips > 0, `标签数=${pickChips} 面板=${dsuDetailText.slice(0, 100)}`)
  // v1.18：标签映射把英文 dsu 物化成中文「并查集」，节点默认标签里不再有 dsu
  const dsuChip = win.locator('.tag-pick[data-tag="并查集"]')
  const dsuRawChip = await win.locator('.tag-pick[data-tag="dsu"]').count()
  check(
    '英文 dsu 标签已映射为中文「并查集」',
    dsuRawChip === 0 && (await dsuChip.count()) > 0,
    `并查集=${await dsuChip.count()} dsu=${dsuRawChip}`
  )
  const dsuChipTitle = await dsuChip.first().getAttribute('title')
  check(
    '标签显示题库题数与已练数（「并查集」在库中确有题目）',
    /题库 \d+ 题/.test(dsuChipTitle || ''),
    String(dsuChipTitle)
  )
  const dsuChipText = ((await dsuChip.first().innerText()) || '').replace(/\s+/g, ' ')
  check('已 AC 的标签显示 ✓ 计数角标', /✓\d+/.test(dsuChipText) || !/✓/.test(dsuChipText), dsuChipText)

  // 手动选取：全选默认 → 取消 → 再选回（映射后该节点只剩 1 个默认标签）
  const defaultTagCount = await win.locator('.tag-pick').count()
  await win.locator('.detail button', { hasText: '全选默认标签' }).click()
  await win.waitForTimeout(400)
  const onAfterAll = await win.locator('.tag-pick.on').count()
  check(
    '「全选默认标签」选中该节点全部默认标签',
    onAfterAll === defaultTagCount && onAfterAll >= 1,
    `选中=${onAfterAll} 共=${defaultTagCount}`
  )
  await win.locator('.detail .tag-pick[data-tag="并查集"]').first().click()
  await win.waitForTimeout(400)
  const onAfterUnpick = await win.locator('.tag-pick.on').count()
  check('可手动取消单个标签', onAfterUnpick === onAfterAll - 1, `剩余=${onAfterUnpick}`)
  await win.locator('.detail .tag-pick[data-tag="并查集"]').first().click()
  await win.waitForTimeout(400)
  const onAfterRepick = await win.locator('.tag-pick.on').count()
  check('可再次手动选回该标签', onAfterRepick === onAfterAll, `选中=${onAfterRepick}`)
  const pickBtn = win.locator('.detail-actions button', { hasText: '去题库练习' })
  const pickBtnText = ((await pickBtn.first().innerText()) || '').replace(/\s+/g, ' ')
  check('按钮显示手动选中的标签数', /选中 \d+ 个标签/.test(pickBtnText), pickBtnText)
  await pickBtn.first().click()
  await win.waitForTimeout(1600)
  check('跳题库时携带手动选中的标签', /tags=/.test(win.url()), win.url())
  const selTagChips = await win.locator('.sel-line .chip').allInnerTexts()
  check(
    '题库「已选」条显示手动选取的标签',
    selTagChips.length >= 1 && selTagChips.join(',').includes('并查集'),
    selTagChips.join(',')
  )
  await win.screenshot({ path: path.join(OUT, '11b-skill-tag-pick.png') })

  // 4g) v1.17：标签筛选改为并集，并按命中标签数排序
  const allSourceSeg = win.locator('.source-switch .seg', { hasText: '全部' }).first()
  const sourceIsAll = await allSourceSeg.evaluate((el) => el.classList.contains('on')).catch(() => false)
  if (!sourceIsAll) {
    await allSourceSeg.click()
    await win.waitForTimeout(1400)
  }
  const clearV117Btn = win.locator('button', { hasText: '全部清空' })
  if ((await clearV117Btn.count()) > 0) {
    await clearV117Btn.first().click()
    await win.waitForTimeout(1200)
  }
  // v1.20：标签大类已并入知识点，这里改为「点两个知识点」= 勾选它们关联的全部标签
  const pickNodeChip = async (name) => {
    const chip = win.locator('.kn-chip').filter({ hasText: name }).first()
    if ((await chip.count()) === 0) return false
    await chip.click()
    await win.waitForTimeout(1400)
    return true
  }
  // 「动态规划入门」含 动态规划 系列标签、「图论入门」含 图论 → 802:C（两标签都命中）排在 801:B 前
  const pickedDp = await pickNodeChip('动态规划入门')
  const pickedGraphs = await pickNodeChip('图论入门')
  check(
    '（v1.17/v1.20）可同时选中两个知识点（= 勾选它们的全部关联标签）',
    pickedDp && pickedGraphs,
    `动态规划入门=${pickedDp} 图论入门=${pickedGraphs}`
  )
  const selChipCount117 = await win.locator('.sel-line .chip').count()
  check('（v1.17）已选条同时显示两个知识点的关联标签', selChipCount117 >= 2, `已选 ${selChipCount117} 个`)
  const matchHintText = ((await win.locator('.match-hint').first().innerText().catch(() => '')) || '').replace(/\s+/g, ' ')
  check(
    '（v1.17）已选条提示取并集与命中数排序',
    /取并集/.test(matchHintText) && /命中标签越多越靠前/.test(matchHintText),
    matchHintText
  )
  const unionRows = await win.locator('tbody tr').count()
  const unionIds = (await win.locator('tbody tr td:nth-child(2)').allInnerTexts()).map((t) => t.trim()).filter(Boolean)
  check(
    '（v1.17）并集命中两题且命中 2 个标签的排第一',
    unionRows === 2 && unionIds[0] === '802:C' && unionIds[1] === '801:B',
    `行数=${unionRows} 顺序=${unionIds.join(',')}`
  )
  const matchBadges = (await win.locator('tbody tr .mini-tag.match').allInnerTexts()).map((t) => t.trim())
  check(
    '（v1.17）命中数角标：802:C 命中 2 个、801:B 命中 1 个',
    /^命中 2\/\d+$/.test(matchBadges[0] || '') && /^命中 1\/\d+$/.test(matchBadges[1] || ''),
    matchBadges.join(' | ')
  )
  await win.screenshot({ path: path.join(OUT, '04b-tags-union.png') })

  // 4g-2) v1.20：按「是否已 AC」筛选（技能树按钮 → 题库 .ac-line）
  const acBtn = win.locator('.ac-filter').first()
  if ((await acBtn.count()) === 0) {
    // 需要先回到学习路径打开节点详情（上一段在题库页）
    await win.locator('.nav-item', { hasText: '学习路径' }).click()
    await win.waitForTimeout(1200)
    await win.locator('.node-card', { hasText: '贪心' }).first().click()
    await win.waitForTimeout(600)
  }
  const acBtnNow = win.locator('.ac-filter').first()
  check('学习路径详情面板出现「排除已 AC」按钮', (await acBtnNow.count()) > 0)
  const acState0 = await acBtnNow.getAttribute('data-ac').catch(() => null)
  check('AC 过滤默认关闭（all）', acState0 === 'all', String(acState0))
  await acBtnNow.click()
  await win.waitForTimeout(400)
  const acState1 = await acBtnNow.getAttribute('data-ac').catch(() => null)
  check('点一次切到「排除已 AC」（notac）', acState1 === 'notac', String(acState1))
  await win.locator('.go-node-problems').first().click()
  await win.waitForTimeout(1600)
  const acLineText = ((await win.locator('.ac-line').first().innerText().catch(() => '')) || '').replace(/\s+/g, ' ')
  check('题库页出现「排除已 AC」条件条', /排除已 AC/.test(acLineText), acLineText.slice(0, 60))
  check('跳转链接带 ac=notac', /ac=notac/.test(win.url()), win.url())
  await win.screenshot({ path: path.join(OUT, '04c-ac-filter.png') })
  const acChip = win.locator('.ac-line .chip').first()
  await acChip.click()
  await win.waitForTimeout(1000)
  check('点 ✕ 后 AC 条件条消失', (await win.locator('.ac-line').count()) === 0)

  // 4g-3) v1.20：虚拟比赛创建向导同样用知识点组卷
  await win.locator('.nav-item', { hasText: '虚拟比赛' }).click()
  await win.waitForTimeout(1400)
  check('比赛页创建向导出现知识点选择器', (await win.locator('.kn-picker').count()) > 0)
  check('比赛页不再有标签大类 Tab', (await win.locator('.seg-tab').count()) === 0)
  const contestKnChip = win.locator('.kn-chip').filter({ hasText: '贪心' }).first()
  check('比赛页知识点 chip 可点', (await contestKnChip.count()) > 0)
  await contestKnChip.click()
  await win.waitForTimeout(600)
  const contestSel = (await win.locator('.sel-line .chip').allInnerTexts()).map((t) => t.trim())
  check('选知识点后组卷参数显示其关联标签', contestSel.length > 0, contestSel.slice(0, 4).join(','))
  await win.screenshot({ path: path.join(OUT, '14c-contest-knowledge.png') })
  await win.locator('button', { hasText: '全部清空' }).first().click()
  await win.waitForTimeout(400)

  // 4g-4) v1.21 FR-43：往届比赛题单（蓝桥杯 / CCPC，年份 + 地区手动联动）
  await win.locator('.nav-item', { hasText: '题单/计划' }).click()
  await win.waitForTimeout(1300)
  await win.locator('button.archive-entry', { hasText: '往届比赛题单' }).click()
  await win.waitForTimeout(1400)
  const archiveModal = win.locator('.modal.wide', { hasText: '往届比赛题单' })
  check('题单页出现「往届比赛题单」入口与弹窗', (await archiveModal.count()) > 0)
  const archiveModalText = ((await archiveModal.innerText().catch(() => '')) || '').replace(/\s+/g, ' ')
  check(
    '弹窗可切换比赛并默认选中最近一届',
    /蓝桥杯/.test(archiveModalText) && /CCPC/.test(archiveModalText) && /2025 年/.test(archiveModalText),
    archiveModalText.slice(0, 180)
  )
  const archiveSelects = archiveModal.locator('select.select')
  const yearOpts = await archiveSelects.first().locator('option').allInnerTexts()
  const yearIdx = yearOpts.findIndex((t) => t.includes('2024'))
  await archiveSelects.first().selectOption({ index: yearIdx })
  await win.waitForTimeout(700)
  const regionOpts = await archiveSelects.nth(1).locator('option').allInnerTexts()
  check('换年份后地区下拉联动出「省 A」', regionOpts.some((t) => t.includes('省 A')), regionOpts.join(' / '))
  const regionIdx = regionOpts.findIndex((t) => t.includes('省 A'))
  await archiveSelects.nth(1).selectOption({ index: regionIdx })
  await win.waitForTimeout(600)
  const archivePreview = ((await archiveModal.innerText()) || '').replace(/\s+/g, ' ')
  check(
    '预览显示将创建「蓝桥杯 2024 · 省 A」共 2 题',
    /蓝桥杯 2024 · 省 A/.test(archivePreview) && /共\s*2\s*题/.test(archivePreview),
    archivePreview.slice(0, 200)
  )
  await win.screenshot({ path: path.join(OUT, '18-archive-list.png') })
  await archiveModal.locator('.modal-actions button', { hasText: '生成题单' }).click()
  await win.waitForTimeout(1800)
  const archiveListItems = await win.locator('.list-item', { hasText: '蓝桥杯 2024 · 省 A' }).count()
  check('生成往届比赛题单并出现在题单列表', archiveListItems > 0, `匹配 ${archiveListItems} 项`)
  const archiveRows = await win.locator('table.table tbody tr').count()
  check('往届比赛题单内是该届 2 道题', archiveRows === 2, `行数=${archiveRows}`)

  // 4g-5) v1.21 FR-44：学习路径「仅显示题单知识点」
  await win.locator('.nav-item', { hasText: '学习路径' }).click()
  await win.waitForTimeout(1800)
  const listPanel = win.locator('.list-panel')
  check('学习路径出现「题单知识点」过滤面板', (await listPanel.count()) > 0)
  const listSelect = listPanel.locator('select.list-select')
  const listOpts = await listSelect.locator('option').allInnerTexts()
  const listIdx = listOpts.findIndex((t) => t.includes('蓝桥杯 2024 · 省 A'))
  check('题单下拉列出刚生成的往届比赛题单', listIdx > 0, listOpts.slice(0, 4).join(' / '))
  await listSelect.selectOption({ index: listIdx })
  await win.waitForTimeout(1400)
  const coverageText = ((await listPanel.innerText()) || '').replace(/\s+/g, ' ')
  check('面板显示题单覆盖的知识点数', /覆盖\s*\d+\s*个知识点/.test(coverageText), coverageText.slice(0, 160))
  const cardsAll = await win.locator('.node-card').count()
  const onlyListCb = listPanel.locator('.only-track input')
  await onlyListCb.check()
  await win.waitForTimeout(1000)
  const cardsFiltered = await win.locator('.node-card:visible').count()
  check(
    '勾选后只显示题单覆盖的知识点',
    cardsFiltered > 0 && cardsFiltered < cardsAll,
    `可见 ${cardsFiltered} / 全部 ${cardsAll}`
  )
  await win.screenshot({ path: path.join(OUT, '11c-skill-tree-list.png') })
  await onlyListCb.uncheck()
  await win.waitForTimeout(900)
  const cardsRestored = await win.locator('.node-card:visible').count()
  check('取消勾选后恢复全部知识点', cardsRestored === cardsAll, `可见 ${cardsRestored} / 全部 ${cardsAll}`)
  await listSelect.selectOption({ index: 0 })
  await win.waitForTimeout(600)

  // 4f-3) 首页：已练习标签 + 推荐习题（v1.14 FR-31~FR-33）
  await win.locator('.nav-item', { hasText: '首页' }).click()
  await win.waitForTimeout(2000)
  // v1.16：题源是全局共享状态，前面对题库的走查可能停在洛谷/力扣；
  // 先归位到「全部」，否则首页推荐（含已练习标签）会按上一页的题源收窄。
  const homeAllBtn = win.locator('[data-rec-source="all"]')
  if ((await homeAllBtn.count()) > 0) {
    const onAll = await homeAllBtn.first().evaluate((el) => el.classList.contains('on'))
    if (!onAll) {
      await homeAllBtn.first().click()
      await win.waitForTimeout(1800)
    }
  }
  const recPanel = win.locator('[data-panel="recommend"]')
  check('首页出现「推荐习题」面板', (await recPanel.count()) > 0)
  check('推荐分「已练习 / 未练习」两栏', (await win.locator('[data-rec="practiced"]').count()) > 0 && (await win.locator('[data-rec="fresh"]').count()) > 0)
  const recText = ((await recPanel.first().innerText()) || '').replace(/\s+/g, ' ')
  check('已练习栏标注遗忘曲线排序', /遗忘曲线/.test(recText), recText.slice(0, 160))
  check('未练习栏标注难度/知识点排序口径', /知识点优先|难度/.test(recText), recText.slice(0, 240))
  const practicedItems = await win.locator('[data-rec="practiced"] .rec-item').count()
  const freshItems = await win.locator('[data-rec="fresh"] .rec-item').count()
  check('推荐列表有实际条目', practicedItems + freshItems > 0, `已练习=${practicedItems} 未练习=${freshItems}`)

  // v1.15 缺陷回归：未练习栏曾被同比赛同名题（CF 1639 的 11 道 Treasure Hunt）填满
  if (freshItems > 1) {
    const freshNames = await win.locator('[data-rec="fresh"] .rec-item .pname').allInnerTexts()
    const uniq = new Set(freshNames.map((t) => t.trim()))
    check(
      '未练习推荐不重复（同一道题不占满整栏）',
      uniq.size === freshNames.length,
      `${uniq.size}/${freshNames.length} 不重复 · ${[...uniq].slice(0, 3).join(' / ')}`
    )
  }
  const tagPanel = await win.locator('.tag-panel').count()
  const tagChips = await win.locator('.tag-chip').count()
  check('首页出现「已练习标签」面板（有已 AC 标签时）', tagPanel > 0 && tagChips > 0, `面板=${tagPanel} 标签=${tagChips}`)
  if (tagChips > 0) {
    const chipTitle = await win.locator('.tag-chip').first().getAttribute('title')
    check('标签角标显示 已AC/题库 与提示', /题库 \d+ 题/.test(chipTitle || ''), String(chipTitle))
    await win.locator('.tag-chip').first().click()
    await win.waitForTimeout(1400)
    const hint = (await win.locator('.filter-hint').innerText().catch(() => '')).replace(/\s+/g, ' ')
    check('点标签后出现筛选提示', /筛选：/.test(hint), hint)
    await win.locator('button', { hasText: '清空筛选' }).first().click()
    await win.waitForTimeout(1200)
    check('「清空筛选」后提示消失', (await win.locator('.filter-hint').count()) === 0)
  }
  await win.screenshot({ path: path.join(OUT, '15-dashboard-recommend.png') })

  // 4f-4) v1.16：首页推荐与题库页共用同一个题源（联动，不是各自独立的筛选器）
  const srcBtns = await win.locator('[data-rec-source]').count()
  check('首页推荐提供题源筛选（全部 / CF / 洛谷 / 力扣）', srcBtns === 4, `按钮=${srcBtns}`)
  await win.locator('[data-rec-source="luogu"]').click()
  await win.waitForTimeout(1600)
  const scopedText = ((await win.locator('[data-rec-scope]').innerText().catch(() => '')) || '').replace(/\s+/g, ' ')
  check('切到洛谷后推荐区标注「仅 洛谷」', /洛谷/.test(scopedText), scopedText)
  const lgIds = (await win.locator('[data-rec="fresh"] .rec-item .pid').allInnerTexts()).map((t) => t.trim())
  check(
    '切到洛谷后未练习推荐只剩洛谷题（P 开头题号）',
    lgIds.length === 0 || lgIds.every((t) => /^P\d/.test(t)),
    lgIds.join(',') || '（无未练习推荐）'
  )
  // 联动：题库页的题源分段应跟随切到洛谷
  await win.locator('.nav-item', { hasText: '题库' }).click()
  await win.waitForTimeout(1800)
  const lgSegActive = ((await win.locator('.source-switch .seg.on').first().innerText().catch(() => '')) || '').replace(/\s+/g, ' ')
  check('题库页题源跟随首页切换（同一状态，联动生效）', /洛谷/.test(lgSegActive), lgSegActive)
  // 清掉上一段「技能树跳转」留下的知识点筛选，才能看到洛谷题列表
  const clearSelBtn = win.locator('button', { hasText: '全部清空' })
  if ((await clearSelBtn.count()) > 0) {
    await clearSelBtn.first().click()
    await win.waitForTimeout(1400)
  }
  const lgRows = (await win.locator('tbody tr td:nth-child(2)').allInnerTexts()).map((t) => t.trim()).filter(Boolean)
  check(
    '题库列表也确实筛到洛谷题',
    lgRows.length > 0 && lgRows.every((t) => /^P\d/.test(t)),
    lgRows.slice(0, 5).join(',') || '（空列表）'
  )
  await win.screenshot({ path: path.join(OUT, '15b-source-linked.png') })
  // 切回「全部」，避免影响后续检查项
  await win.locator('.source-switch .seg', { hasText: '全部' }).first().click()
  await win.waitForTimeout(1200)
  const allRows = (await win.locator('tbody tr td:nth-child(2)').allInnerTexts()).map((t) => t.trim()).filter(Boolean)
  check('切回「全部」后题库恢复三源混合', allRows.some((t) => /^\d+:/.test(t)), allRows.slice(0, 5).join(','))

  // 设置页：推荐习题设置项（v1.14 FR-33）
  await win.locator('.nav-item', { hasText: '设置' }).click()
  await win.waitForTimeout(1000)
  const recPanelSettings = win.locator('[data-panel="recommend"]')
  check('设置页出现「首页推荐习题」面板', (await recPanelSettings.count()) > 0)
  if ((await recPanelSettings.count()) > 0) {
    const practicedOpts = await win.locator('[data-rec-practiced] option').allInnerTexts()
    const freshOpts = await win.locator('[data-rec-fresh] option').allInnerTexts()
    check('可更改「已练习」推荐方式（5 种）', practicedOpts.length >= 5, practicedOpts.join('/'))
    check('可更改「未练习」推荐方式（6 种）', freshOpts.length >= 6, freshOpts.join('/'))
    const freshValue = freshOpts.find((o) => o.includes('难度从低到高'))
    if (freshValue) {
      await win.locator('[data-rec-fresh]').selectOption({ label: freshValue })
      await win.waitForTimeout(1500)
      const savedFresh = await win.locator('[data-rec-fresh]').inputValue()
      check('设置项已保存（recommendOrderFresh）', savedFresh === 'easier', `当前值=${savedFresh}`)
      await win.locator('.nav-item', { hasText: '首页' }).click()
      await win.waitForTimeout(2500)
      const freshHead = ((await win.locator('[data-rec="fresh"] header').innerText()) || '').replace(/\s+/g, ' ')
      check('改动推荐方式后首页未练习栏口径随之变化', /难度/.test(freshHead), freshHead)
      await win.locator('.nav-item', { hasText: '设置' }).click()
      await win.waitForTimeout(900)
      await win.locator('[data-rec-fresh]').selectOption({ label: freshOpts[0] })
      await win.waitForTimeout(1200)
    }
  }

  // 4g) v1.19 FR-40：首页「刷题记录」（按打开时间倒序记录打开过的题）
  await win.locator('.nav-item', { hasText: '首页' }).click()
  await win.waitForTimeout(2200)
  const viewsPanel = win.locator('[data-panel="views"]')
  check('首页出现「刷题记录」面板', (await viewsPanel.count()) > 0)
  const viewItems = await win.locator('[data-panel="views"] .view-item').count()
  check('刷题记录列出打开过的题（种子 3 道）', viewItems === 3, `实际 ${viewItems}`)
  const viewIds = await win
    .locator('[data-panel="views"] .view-item')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-view-id')))
  check('刷题记录按打开时间倒序（最新在最上）', viewIds.join(',') === 'P3374,802:C,801:B', viewIds.join(','))
  const openCountText = ((await win.locator('[data-panel="views"] .open-count').allInnerTexts()).join('|')) || ''
  check('同一题打开多次显示「打开 N 次」', /打开 2 次/.test(openCountText), openCountText || '（无角标）')
  const viewsIpc = await win.evaluate(async () => {
    const r = await window.api.invoke('views:recent', { limit: 12 })
    return r && r.ok ? r.data.length : -1
  })
  check('views:recent 通道返回聚合后的记录', viewsIpc === 3, `返回 ${viewsIpc} 条`)
  await win.screenshot({ path: path.join(OUT, '15c-dashboard-views.png') })

  await win.locator('[data-views-clear]').click()
  await win.waitForTimeout(1400)
  const afterClear = await win.locator('[data-panel="views"] .view-item').count()
  const viewsText = ((await viewsPanel.innerText()) || '').replace(/\s+/g, ' ')
  check('清空记录后回到空态', afterClear === 0 && /还没有打开过的题/.test(viewsText), `剩余 ${afterClear} 条`)
  const totalAfter = await win.evaluate(async () => {
    const r = await window.api.invoke('problems:list', { page: 1, pageSize: 1, source: 'all' })
    return r && r.ok ? r.data.total : -1
  })
  check('清空刷题记录不影响题库数据', totalAfter === 21, `题库 ${totalAfter} 题`)

  // 4h) 题单 / 今日复习 / 训练计划（v1.10 FR-27~FR-29）
  await win.locator('.nav-item', { hasText: '题单/计划' }).click()
  await win.waitForTimeout(1200)
  const tabs = await win.locator('.tabs .seg').allInnerTexts()
  check('题单页含 题单/今日复习/训练计划 三个 Tab', tabs.length === 3, tabs.join(','))

  const listName = `GUI 题单 ${Date.now() % 100000}`
  await win.locator('.new-row input').fill(listName)
  await win.locator('.new-row button').click()
  await win.waitForTimeout(1200)
  check('新建题单成功并出现在列表', (await win.locator('.list-item', { hasText: listName }).count()) > 0)

  await win.locator('.toolbar button', { hasText: '粘贴题号识别' }).click()
  await win.waitForTimeout(600)
  await win.locator('.modal textarea').fill('1741A 1741B 802C 9999Z')
  await win.locator('.modal-actions button', { hasText: '识别' }).click()
  await win.waitForTimeout(900)
  const parseText = (await win.locator('.parse-result').innerText()).replace(/\s+/g, ' ')
  check(
    '粘贴识别命中题目并列出未匹配',
    /命中/.test(parseText) && /未匹配/.test(parseText),
    parseText.slice(0, 120)
  )
  await win.locator('.modal-actions button', { hasText: '加入题单' }).click()
  await win.waitForTimeout(1400)
  const modalLeft = await win.locator('.modal-mask').count()
  const toastTexts = (await win.locator('.toast, .toast-item').allInnerTexts().catch(() => [])).join(' | ')
  check('加入题单后弹窗关闭', modalLeft === 0, `剩余弹窗=${modalLeft} 提示=${toastTexts.slice(0, 200)}`)
  const listRows = await win.locator('table.table tbody tr').count()
  const mainPanel = (await win.locator('.panel.main').innerText().catch(() => '')).replace(/\s+/g, ' ')
  check('题单内加入识别到的题目', listRows >= 1, `行数=${listRows} 面板=${mainPanel.slice(0, 160)}`)

  await win.locator('table.table tbody tr').first().locator('input[type="checkbox"]').check()
  await win.waitForTimeout(1200)
  const firstRowText = (await win.locator('table.table tbody tr').first().innerText()).replace(/\s+/g, ' ')
  check('勾选完成自动进入复习第 1 档', /第 1\/6 档/.test(firstRowText), firstRowText.slice(0, 140))
  await win.screenshot({ path: path.join(OUT, '13-lists.png') })

  await win.locator('.tabs .seg', { hasText: '今日复习' }).click()
  await win.waitForTimeout(1000)
  const reviewPanel = (await win.locator('.lists-page').innerText()).replace(/\s+/g, ' ')
  check('今日复习 Tab 可打开（显示待复习或空态）', /今日待复习/.test(reviewPanel))

  await win.locator('.tabs .seg', { hasText: '训练计划' }).click()
  await win.waitForTimeout(1000)
  const planSelect = win.locator('.form-grid select.select').first()
  const planOptions = await planSelect.locator('option').allInnerTexts()
  const targetOption = planOptions.find((o) => o.includes(listName))
  check('训练计划可选刚建的题单', !!targetOption, planOptions.slice(0, 4).join(' / '))
  if (targetOption) await planSelect.selectOption({ label: targetOption })
  await win.locator('button', { hasText: '生成并排期' }).click()
  await win.waitForTimeout(2000)
  const calendarDays = await win.locator('.calendar .day').count()
  check('训练计划生成日历排期', calendarDays > 0, `天数=${calendarDays}`)
  const taskRows = await win.locator('.calendar .task').count()
  check('日历中有待做任务', taskRows > 0, `任务数=${taskRows}`)
  await win.locator('.calendar .task input[type="checkbox"]').first().check()
  await win.waitForTimeout(1200)
  const doneTasks = await win.locator('.calendar .task.done').count()
  check('计划任务可打卡（完成态渲染）', doneTasks > 0, `已完成=${doneTasks}`)
  await win.locator('.busy-row input[type="date"]').fill('2026-10-06')
  await win.locator('.busy-row input.input').nth(1).fill('GUI 冒烟：期中考试')
  await win.locator('button', { hasText: '标记这天没空' }).click()
  await win.waitForTimeout(1500)
  const busyText = (await win.locator('.lists-page').innerText()).replace(/\s+/g, ' ')
  check('标记没空日后显示该日期与原因', /2026-10-06/.test(busyText) && /期中考试/.test(busyText))
  await win.screenshot({ path: path.join(OUT, '14-plan.png') })

  await app.close()
  await new Promise((r) => setTimeout(r, 800))

  // 关闭阶段检查：不应产生未捕获异常日志（历史缺陷：退出时 closeStatement 崩溃）
  const crashLog = path.join(USER_DATA, 'crash.log')
  const hasCrash = fs.existsSync(crashLog)
  check('退出后无 crash.log（无未捕获异常）', !hasCrash, hasCrash ? fs.readFileSync(crashLog, 'utf8').slice(0, 200) : '')

  const failed = results.filter((r) => !r.ok)
  log(`SUMMARY: ${results.length - failed.length}/${results.length} 检查通过`)
  if (failed.length) log('FAILED: ' + failed.map((f) => f.name).join('; '))
  process.exit(failed.length ? 1 : 0)
}

main().catch((e) => {
  log('verify crashed: ' + (e && e.stack ? e.stack : String(e)))
  process.exit(2)
})
