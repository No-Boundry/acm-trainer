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
    `80${i}:A`, 80 + i, 'A', `Greedy ${i + 1}`, 800 + i * 50, null, 'cf', ['greedy', 'sortings']
  ])
  const problems = [
    ...greedy,
    ['801:B', 801, 'B', 'DP Medium', 1400, null, 'cf', ['dp']],
    ['802:C', 802, 'C', 'DP Hard', 1900, null, 'cf', ['dp', 'graphs']],
    ['P1001', 0, 'P1001', 'A+B Problem', null, 1, 'luogu', ['模拟']],
    ['P3374', 0, 'P3374', '树状数组 1', null, 4, 'luogu', ['树状数组']],
    // v1.9 力扣（index = titleSlug，难度 1 简单 / 2 中等 / 3 困难）
    ['LC1', 0, 'two-sum', '两数之和', null, 1, 'leetcode', ['数组', '哈希表']],
    ['LC146', 0, 'lru-cache', 'LRU 缓存', null, 2, 'leetcode', ['设计', '哈希表']],
    ['LC23', 0, 'merge-k-sorted-lists', '合并 K 个升序链表', null, 3, 'leetcode', ['链表', '分治']]
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

  // 2) 题库页：知识点筛选
  await win.locator('.nav-item', { hasText: '题库' }).click()
  await win.waitForTimeout(1200)
  const panel = win.locator('.kn-panel')
  check('知识点筛选区块存在', (await panel.count()) > 0)
  await panel.locator('.kn-toggle').click()
  await win.waitForTimeout(400)
  const chipCount = await win.locator('.kn-chip').count()
  check('知识点标签数 = 54（v1.10 新增国内比赛节点）', chipCount === 54, `实际 ${chipCount}`)
  await win.screenshot({ path: path.join(OUT, '02-problems-knowledge.png') })

  // 掌握度概览与色点
  const summaryText = (await panel.locator('.kn-summary').innerText()).replace(/\s+/g, ' ')
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

  // 点击知识点 → 并集筛选
  await greedyChip.click()
  await win.waitForTimeout(1000)
  const filteredNote = await win.locator('.meta-row').innerText()
  check('点击知识点后列表刷新（出现题数）', /共 \d+ 题/.test(filteredNote), filteredNote)
  await win.screenshot({ path: path.join(OUT, '03-knowledge-filtered.png') })
  const clearBtn = win.locator('button', { hasText: '清空知识点' })
  check('出现「清空知识点」按钮', (await clearBtn.count()) > 0)

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
  await win.locator('button', { hasText: '重置' }).first().click()
  await win.waitForTimeout(500)
  await win.screenshot({ path: path.join(OUT, '06b-stl-reference.png') })

  // 4) 设置页：Edge 说明与登录入口
  await win.locator('.nav-item', { hasText: '设置' }).click()
  await win.waitForTimeout(1200)
  const settingsText = (await win.locator('.settings-page').innerText()).replace(/\s+/g, ' ')
  check('设置页说明题面由 Edge 打开', settingsText.includes('Edge'), settingsText.slice(0, 160))
  await win.screenshot({ path: path.join(OUT, '05-settings.png') })

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
  // 先清掉前面知识点用例留下的筛选（否则力扣视图被并集标签过滤）
  const clearKn = win.locator('button', { hasText: '清空知识点' })
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
  check('按钮显示该节点的关联标签数', /个关联标签/.test(nodeBtnText), nodeBtnText)
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
  check('技能树节点数 = 54（含 v1.10 新增节点）', nodeCards === 54, `实际 ${nodeCards}`)
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
  const onlyTrack = win.locator('.only-track input')
  if ((await onlyTrack.count()) > 0) {
    await onlyTrack.check()
    await win.waitForTimeout(900)
    const edgesAfter = await win.locator('.edges path').count()
    const visibleCards = await win.locator('.node-card:visible').count()
    check(
      '「只显示赛道节点」时连线随卡片一起减少（无残留悬空线）',
      edgesAfter < edgesBefore && edgesAfter > 0 && visibleCards < 54,
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
