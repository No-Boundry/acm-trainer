/**
 * 使用手册配图生成：启动真实应用（独立临时库 + 种子数据），逐页截图到 docs/images/。
 * 用法：node tools/gui-docs-shots.cjs
 */
const fs = require('fs')
const path = require('path')
const { createRunner, seedData, launchApp, reload, gotoPage, ROOT } = require('./gui-lib.cjs')

const IMAGES = path.join(ROOT, 'docs', 'images')
const runner = createRunner('.gui-docs')
const { log } = runner

async function shoot(win, name) {
  fs.mkdirSync(IMAGES, { recursive: true })
  const file = path.join(IMAGES, name)
  await win.screenshot({ path: file })
  const size = fs.statSync(file).size
  log(`shot ${name} (${Math.round(size / 1024)} KB)`)
}

/** 设置窗口尺寸（Electron 页面无法用 setViewportSize） */
async function resize(app, width, height) {
  await app.evaluate(async ({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.getTitle() !== '') ?? BrowserWindow.getAllWindows()[0]
    if (win) {
      win.setSize(size.width, size.height)
      win.center()
    }
  }, { width, height })
  await new Promise((r) => setTimeout(r, 500))
}

async function main() {
  fs.rmSync(IMAGES, { recursive: true, force: true })
  fs.mkdirSync(IMAGES, { recursive: true })

  const { app, win, userDataDir } = await launchApp(path.join(runner.USER_DATA))
  seedData(userDataDir)
  await reload(win, 1800)
  await resize(app, 1420, 900)
  await reload(win, 1500)

  // 1) 首页
  await gotoPage(win, '首页')
  await shoot(win, '01-dashboard.png')

  // 2) 题库（知识点筛选展开 + 选中一个知识点）
  await gotoPage(win, '题库')
  await win.locator('.kn-panel .kn-toggle').click()
  await win.waitForTimeout(400)
  await shoot(win, '02-problems.png')
  const greedy = win.locator('.kn-chip', { hasText: '贪心' }).first()
  if ((await greedy.count()) > 0) {
    await greedy.click()
    await win.waitForTimeout(900)
    await shoot(win, '03-problems-filtered.png')
    await win.locator('button', { hasText: '清空知识点' }).first().click()
    await win.waitForTimeout(700)
  }

  // 4) 题目详情抽屉（记录练习 / 练习记录 / 题面入口）
  const row = win.locator('table.table tbody tr').first()
  if ((await row.count()) > 0) {
    await row.locator('button', { hasText: '记录' }).first().click()
    await win.waitForTimeout(800)
    await shoot(win, '04-drawer-record.png')
    await win.locator('.drawer button', { hasText: '✕' }).first().click()
    await win.waitForTimeout(500)
  }

  // 4b) 力扣视图（v1.9 FR-21）
  await win.locator('.source-switch .seg', { hasText: '力扣' }).first().click()
  await win.waitForTimeout(1200)
  await shoot(win, '04b-leetcode-source.png')
  await win.locator('.source-switch .seg', { hasText: '全部' }).first().click()
  await win.waitForTimeout(900)

  // 5) 学习路径
  await gotoPage(win, '学习路径')
  await win.waitForTimeout(1500)
  await shoot(win, '05-skill-tree.png')
  const nodeCard = win.locator('.node-card', { hasText: '贪心' }).first()
  if ((await nodeCard.count()) > 0) {
    await nodeCard.click()
    await win.waitForTimeout(700)
    await shoot(win, '06-skill-node-detail.png')
  }

  // 5b) STL 速查（v1.8.2）
  await gotoPage(win, 'STL 速查')
  await win.waitForTimeout(1000)
  await shoot(win, '05b-stl-reference.png')

  // 5c) 技能树赛道预设（v1.10 FR-26）
  await gotoPage(win, '学习路径')
  await win.waitForTimeout(1200)
  const trackSeg = win.locator('.track-row .seg', { hasText: '蓝桥杯' })
  if ((await trackSeg.count()) > 0) {
    await trackSeg.first().click()
    await win.waitForTimeout(900)
    await shoot(win, '05c-skill-track.png')
  }

  // 5d) 题单 / 今日复习 / 训练计划（v1.10 FR-27~FR-29）
  await gotoPage(win, '题单/计划')
  await win.waitForTimeout(1200)
  const demoListName = '示例题单：蓝桥杯冲刺'
  await win.locator('.new-row input').fill(demoListName)
  await win.locator('.new-row button').click()
  await win.waitForTimeout(1200)
  await win.locator('.toolbar button', { hasText: '粘贴题号识别' }).click()
  await win.waitForTimeout(500)
  await win
    .locator('.modal textarea')
    .fill('800A 801B 802C P1001 洛谷 P3374 LC1 https://leetcode.cn/problems/lru-cache/')
  await win.locator('.modal-actions button', { hasText: '识别' }).click()
  await win.waitForTimeout(900)
  await win.locator('.modal-actions button', { hasText: '加入题单' }).click()
  await win.waitForTimeout(1400)
  await win.locator('table.table tbody tr').first().locator('input[type="checkbox"]').check()
  await win.waitForTimeout(1000)
  await shoot(win, '05d-problem-lists.png')
  await win.locator('.tabs .seg', { hasText: '今日复习' }).click()
  await win.waitForTimeout(900)
  await shoot(win, '05e-review.png')
  await win.locator('.tabs .seg', { hasText: '训练计划' }).click()
  await win.waitForTimeout(900)
  const planSel = win.locator('.form-grid select.select').first()
  const planOpts = await planSel.locator('option').allInnerTexts()
  const target = planOpts.find((o) => o.includes(demoListName))
  if (target) await planSel.selectOption({ label: target })
  await win.locator('button', { hasText: '生成并排期' }).click()
  await win.waitForTimeout(1800)
  await shoot(win, '05f-training-plan.png')

  // 6) 统计
  await gotoPage(win, '统计')
  await win.waitForTimeout(1200)
  await shoot(win, '07-stats.png')
  // 6b) 难度分布板块（v1.9 FR-22）：切到力扣一档再切回，截图包含表格与图表
  const diffPanel = win.locator('.diff-panel')
  if ((await diffPanel.count()) > 0) {
    const lcTab = win.locator('.diff-tabs .seg', { hasText: '力扣' })
    if ((await lcTab.count()) > 0) {
      await lcTab.first().click()
      await win.waitForTimeout(900)
    }
    await win.evaluate(() => {
      document.querySelector('.diff-panel')?.scrollIntoView({ block: 'center' })
    })
    await win.waitForTimeout(500)
    await shoot(win, '07b-stats-difficulty.png')
  }

  // 7) 笔记/错题
  await gotoPage(win, '笔记')
  await win.waitForTimeout(1000)
  await shoot(win, '08-notes.png')
  await win.locator('button', { hasText: '新建笔记' }).click()
  await win.waitForTimeout(500)
  await win.locator('.title-input').first().fill('示例笔记：贪心与排序')
  await win.locator('.editor textarea').first().fill(
    '# 贪心与排序\n\n- 先排序再贪心\n- 交换论证证明\n\n```cpp\nsort(a.begin(), a.end());\n```\n'
  )
  await win.waitForTimeout(1200)
  await shoot(win, '09-note-editor.png')

  // 8) 模板库
  await gotoPage(win, '模板库')
  await win.waitForTimeout(1000)
  await shoot(win, '10-templates.png')

  // 9) 虚拟比赛（创建 → 进行中 → 结果）
  await gotoPage(win, '虚拟比赛')
  await win.waitForTimeout(1200)
  await shoot(win, '11-contest-create.png')
  const nameInput = win.locator('.create-view input.input').first()
  await nameInput.fill('示例比赛')
  // .create-view 内只有两个数字输入：难度 ≥ / 难度 ≤（时长与题数是下拉框）
  const nums = win.locator('.create-view input[type="number"]')
  if ((await nums.count()) >= 2) {
    await nums.nth(0).fill('800')
    await nums.nth(1).fill('1600')
  }
  const durationSelect = win.locator('.create-view select').first()
  if ((await durationSelect.count()) > 0) {
    const options = await durationSelect.locator('option').allInnerTexts()
    const pick = options.find((o) => o.includes('60')) ?? options[0]
    await durationSelect.selectOption({ label: pick })
  }
  await win.locator('button', { hasText: '生成题单' }).click()
  await win.waitForTimeout(1500)
  const genRows = await win.locator('.create-view table.table tbody tr').count()
  log('生成题单行数 = ' + genRows)
  await shoot(win, '12-contest-generated.png')
  if (genRows === 0) throw new Error('生成题单为空，无法继续截图（检查难度区间与题库数据）')
  await win.locator('button', { hasText: '创建并开始比赛' }).click()
  await win.waitForTimeout(1200)
  const acButtons = win.locator('.running-view button', { hasText: /^AC$/ })
  if ((await acButtons.count()) > 0) await acButtons.first().click()
  await win.waitForTimeout(600)
  await shoot(win, '13-contest-running.png')
  await win.locator('.running-view button', { hasText: '结束比赛' }).click()
  await win.waitForTimeout(1400)
  await shoot(win, '14-contest-result.png')

  // 10) 水平评估（页面含洛谷 / 力扣两个独立板块，1420×900 视口内即可见）
  await gotoPage(win, '水平评估')
  await win.waitForTimeout(1200)
  await shoot(win, '15-rating.png')

  // 11) 设置
  await gotoPage(win, '设置')
  await win.waitForTimeout(1000)
  await shoot(win, '16-settings.png')
  await win.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await win.waitForTimeout(600)
  await shoot(win, '17-settings-bottom.png')

  await app.close().catch(() => undefined)
  log('全部截图完成 → docs/images/')
}

main().catch((e) => {
  log('shots crashed: ' + (e && e.stack ? e.stack : String(e)))
  process.exit(1)
})
