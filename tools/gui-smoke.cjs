/**
 * GUI 端到端冒烟（v1.8）：记录练习联动 / 虚拟比赛全流程 / 笔记自动保存。
 * 用法：npm run verify:smoke   （或 node tools/gui-smoke.cjs）
 */
const { createRunner, seedData, launchApp, reload, gotoPage } = require('./gui-lib.cjs')
const fs = require('fs')
const path = require('path')

const runner = createRunner('.gui-smoke')
const { OUT, USER_DATA, log, check, summary, shot } = runner

/** 备份往返测试：文件对话框由主进程测试钩子（ACM_TEST_SAVE_PATH/OPEN_PATH）绕过 */
const BACKUP_DIR = path.join(OUT, 'backup')
const BACKUP_FILE = path.join(BACKUP_DIR, 'round-trip.json')

/** 读取统计页四张总览卡（label → 数字） */
async function readStatCards(win) {
  return win.evaluate(() => {
    const out = {}
    document.querySelectorAll('.cards .card').forEach((c) => {
      const label = c.querySelector('.card-label')?.textContent?.trim() ?? ''
      const num = Number((c.querySelector('.card-num')?.textContent ?? '').replace(/[^\d.-]/g, ''))
      out[label] = num
    })
    return out
  })
}

/** 读取知识点标签文本（名称 → 「已练/已AC」） */
async function readKnowledgeChip(win, name) {
  const chip = win.locator('.kn-chip', { hasText: name }).first()
  if ((await chip.count()) === 0) return null
  return (await chip.innerText()).replace(/\s+/g, ' ').trim()
}

async function main() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true })
  fs.rmSync(BACKUP_FILE, { force: true })
  const { app, win, userDataDir } = await launchApp(USER_DATA, [], {
    ACM_TEST_SAVE_PATH: BACKUP_FILE,
    ACM_TEST_OPEN_PATH: BACKUP_FILE
  })
  seedData(userDataDir)
  await reload(win, 1600)

  // ================= 场景 1：记录练习 → 掌握度与统计联动 =================
  log('=== 场景 1：记录练习联动 ===')
  await gotoPage(win, '题库')
  // 展开知识点筛选，记录「动态规划入门」初始计数
  await win.locator('.kn-panel .kn-toggle').click()
  await win.waitForTimeout(300)
  const dpBefore = await readKnowledgeChip(win, '动态规划入门')
  check('知识点「动态规划入门」标签可读', !!dpBefore, String(dpBefore))

  // 定位 DP Medium（种子中为 WA）并打开记录抽屉
  await win.locator('.filter-row input.input, .filter-row .input').first().fill('DP Medium')
  await win.waitForTimeout(900)
  const row = win.locator('table.table tbody tr', { hasText: 'DP Medium' }).first()
  check('按关键字找到目标题目行', (await row.count()) > 0)
  await row.locator('button', { hasText: '记录' }).first().click()
  await win.waitForTimeout(600)
  const drawer = win.locator('.drawer')
  check('记录抽屉已打开', (await drawer.count()) > 0)
  const durationInput = drawer.locator('input[type="number"]').first()
  const durationDefault = await durationInput.inputValue()
  check('耗时输入默认为空（不再从 0 开始）', durationDefault === '', `实际值 "${durationDefault}"`)
  await shot(win, '10-record-drawer.png')

  // 提交 AC 记录
  await drawer.locator('select.select').first().selectOption('AC')
  await drawer.locator('input[type="number"]').first().fill('30')
  await drawer.locator('input.input').last().fill('smoke-AC')
  await drawer.locator('button', { hasText: '提交记录' }).click()
  await win.waitForTimeout(1200)
  const recText = (await drawer.locator('.rec-list, .section').allInnerTexts()).join(' ')
  check('抽屉内出现刚提交的记录', /AC/.test(recText), recText.replace(/\s+/g, ' ').slice(0, 120))
  await shot(win, '11-record-submitted.png')
  await drawer.locator('button', { hasText: '✕' }).first().click()
  await win.waitForTimeout(800)

  // 掌握度联动（v1.8.1：记录后自动刷新，无需重新进入页面）：DP 由 2/1 → 2/2
  await win.waitForTimeout(800)
  const dpAfter = await readKnowledgeChip(win, '动态规划入门')
  check(
    '记录后知识点题数即时联动（动态规划入门 2/1 → 2/2）',
    !!dpAfter && /2\/2/.test(dpAfter),
    `${dpBefore} → ${dpAfter}`
  )

  // 统计联动：总览数字增加
  await gotoPage(win, '统计')
  const statsAfter = await readStatCards(win)
  check('统计页总览卡可读且含练习相关数字', Object.keys(statsAfter).length > 0, JSON.stringify(statsAfter))
  await shot(win, '12-stats.png')

  // ================= 场景 2：虚拟比赛全流程 =================
  log('=== 场景 2：虚拟比赛全流程 ===')
  await gotoPage(win, '虚拟比赛')
  const nameInput = win.locator('.create-view input.input').first()
  await nameInput.fill('smoke-contest')
  // .create-view 仅两个数字输入：难度 ≥ / 难度 ≤（时长与题数为下拉框）
  const ratingInputs = win.locator('.create-view input[type="number"]')
  const ratingCount = await ratingInputs.count()
  check('创建向导含难度区间输入', ratingCount >= 2, `${ratingCount} 个数字输入`)
  if (ratingCount >= 2) {
    await ratingInputs.nth(0).fill('800')
    await ratingInputs.nth(1).fill('1400')
  }
  await win.locator('button', { hasText: '生成题单' }).click()
  await win.waitForTimeout(1500)
  const generatedRows = await win.locator('.create-view table.table tbody tr').count()
  check('生成题单成功（列出候选题）', generatedRows > 0, `${generatedRows} 行`)
  await win.locator('button', { hasText: '创建并开始比赛' }).click()
  await win.waitForTimeout(1500)
  const running = win.locator('.running-view')
  check('进入比赛进行界面', (await running.count()) > 0)
  await shot(win, '20-contest-running.png')

  const acButtons = running.locator('button', { hasText: /^AC$/ })
  const waButtons = running.locator('button', { hasText: /^WA$/ })
  const acCount = await acButtons.count()
  check('比赛题目带 AC/WA 记录按钮', acCount > 0, `AC 按钮 ${acCount} 个`)
  if (acCount > 0) await acButtons.first().click()
  if ((await waButtons.count()) > 0) await waButtons.first().click()
  await win.waitForTimeout(1200)
  await shot(win, '21-contest-marked.png')

  await running.locator('button', { hasText: '结束比赛' }).click()
  await win.waitForTimeout(1500)
  const resultView = win.locator('.result-view')
  check('结束后进入结果视图', (await resultView.count()) > 0)
  const resultText = (await resultView.innerText()).replace(/\s+/g, ' ')
  check('结果包含 AC 数与罚时信息', /AC/.test(resultText) && /罚时|罚/.test(resultText), resultText.slice(0, 160))
  await shot(win, '22-contest-result.png')

  // ================= 场景 3：笔记自动保存 =================
  log('=== 场景 3：笔记自动保存 ===')
  await gotoPage(win, '笔记')
  await win.locator('button', { hasText: '新建笔记' }).click()
  await win.waitForTimeout(600)
  const titleInput = win.locator('.title-input').first()
  await titleInput.fill('smoke-note')
  const contentArea = win.locator('.editor textarea').first()
  await contentArea.fill('# 冒烟测试\n\n自动保存内容 markdown')
  await win.waitForTimeout(4000) // 等待自动保存（默认间隔 + 余量）
  await shot(win, '30-note-editing.png')

  await reload(win, 1500)
  await gotoPage(win, '笔记')
  const noteItems = win.locator('.note-item')
  const noteTexts = await noteItems.allInnerTexts()
  check(
    '刷新后笔记仍在（自动保存生效）',
    noteTexts.some((t) => t.includes('smoke-note')),
    noteTexts.join(' | ').slice(0, 160)
  )
  await shot(win, '31-note-persisted.png')

  // ================= 场景 4：学习路径 →「去题库练习」一键选中建议知识点 =================
  log('=== 场景 4：建议优先学习一键跳题库 ===')
  await gotoPage(win, '学习路径')
  await win.waitForTimeout(1500)
  const goBtn = win.locator('button', { hasText: '去题库练习' })
  check('学习路径存在「去题库练习」按钮', (await goBtn.count()) > 0)
  const goText = ((await goBtn.first().innerText()) || '').replace(/\s+/g, ' ')
  const expectCount = Number((goText.match(/(\d+)\s*个知识点/) || [])[1] ?? 0)
  check('按钮显示将选中的知识点数量', expectCount > 0, goText)
  await shot(win, '40-skill-go-problems.png')

  await goBtn.first().click()
  await win.waitForTimeout(1500)
  check('已跳转到题库页', /#\/problems/.test(win.url()), win.url())
  check('URL 携带 knowledge 参数', /knowledge=/.test(win.url()), win.url())

  const panelOpen = await win.locator('.kn-panel .kn-chips').count()
  check('知识点面板自动展开', panelOpen > 0)
  const selectedChips = await win.locator('.kn-chip.on').count()
  check(
    '建议学习的知识点已全部选中',
    selectedChips > 0 && selectedChips === expectCount,
    `选中 ${selectedChips} 个 / 期望 ${expectCount} 个`
  )
  const listNote = (await win.locator('.meta-row').innerText()).replace(/\s+/g, ' ')
  check('列表按所选知识点筛出题目', /共 \d+ 题/.test(listNote), listNote)
  await shot(win, '41-problems-from-skill.png')

  // ================= 场景 5：备份导出 → 数据变更 → 导入还原（往返） =================
  log('=== 场景 5：备份导出/导入往返 ===')
  await gotoPage(win, '设置')
  const exportBtn = win.locator('button', { hasText: '导出备份' })
  check('设置页存在「导出备份」按钮', (await exportBtn.count()) > 0)
  await exportBtn.first().click()
  await win.waitForTimeout(2500)

  check('导出生成备份文件', fs.existsSync(BACKUP_FILE), BACKUP_FILE)
  let payload = null
  try {
    payload = JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf8'))
  } catch {
    payload = null
  }
  check(
    '备份为可解析 JSON 且含数据表',
    !!payload && Array.isArray(payload.problems) && Array.isArray(payload.notes) && Array.isArray(payload.practice_records),
    payload ? `version=${payload.version} problems=${payload.problems.length} records=${payload.practice_records.length} notes=${payload.notes.length}` : '解析失败'
  )
  check(
    '备份含此前产生的笔记内容',
    !!payload && JSON.stringify(payload.notes).includes('smoke-note')
  )
  const backupRecordCount = payload?.practice_records?.length ?? 0
  check('备份含练习记录行', backupRecordCount > 0, `practice_records=${backupRecordCount}`)
  const lastBackupRow = win.locator('.settings-page p', { hasText: '最近导出' })
  const lastBackupText =
    (await lastBackupRow.count()) > 0 ? (await lastBackupRow.first().innerText()).trim() : ''
  check('设置页回显最近导出路径', lastBackupText.includes('round-trip.json'), lastBackupText)
  await shot(win, '50-backup-exported.png')

  await gotoPage(win, '统计')
  await win.waitForTimeout(1200)
  const statsAfterExport = await readStatCards(win)

  // 变更数据：新增一条导出后才存在的笔记（导入后应被备份数据覆盖而消失）
  await gotoPage(win, '笔记')
  await win.locator('button', { hasText: '新建笔记' }).click()
  await win.waitForTimeout(600)
  await win.locator('.title-input').first().fill('smoke-temp-note')
  await win.locator('.editor textarea').first().fill('导入前新增，导入后应被覆盖')
  await win.waitForTimeout(4000)
  // 编辑态下列表不渲染，先刷新确认这条笔记确实已落库（否则后面的覆盖断言无意义）
  await reload(win, 1600)
  await gotoPage(win, '笔记')
  let roundTripTexts = await win.locator('.note-item').allInnerTexts()
  check(
    '导入前数据已变更（新增笔记已落库）',
    roundTripTexts.some((t) => t.includes('smoke-temp-note')),
    roundTripTexts.join(' | ').slice(0, 140)
  )

  // 导入备份（覆盖确认框由 GUI harness 自动接受）
  await gotoPage(win, '设置')
  await win.locator('button', { hasText: '导入备份' }).first().click()
  await win.waitForTimeout(3500)
  await reload(win, 1800)

  await gotoPage(win, '笔记')
  roundTripTexts = await win.locator('.note-item').allInnerTexts()
  check(
    '导入后备份内笔记仍在（smoke-note）',
    roundTripTexts.some((t) => t.includes('smoke-note')),
    roundTripTexts.join(' | ').slice(0, 140)
  )
  check(
    '导入后导出后新增的数据被覆盖（smoke-temp-note 消失）',
    !roundTripTexts.some((t) => t.includes('smoke-temp-note')),
    roundTripTexts.join(' | ').slice(0, 140)
  )
  await shot(win, '51-backup-imported.png')

  await gotoPage(win, '题库')
  await win.waitForTimeout(1000)
  const listNoteAfterImport = (await win.locator('.meta-row').first().innerText()).replace(/\s+/g, ' ')
  const listedProblems = Number((listNoteAfterImport.match(/共\s*(\d+)\s*题/) || [])[1] ?? -1)
  check(
    '导入后题库题数与备份一致（题表整体还原）',
    listedProblems === payload.problems.length,
    `备份 ${payload.problems.length} 题 / 导入后列出 ${listedProblems} 题`
  )

  await gotoPage(win, '统计')
  await win.waitForTimeout(1200)
  const statsAfterImport = await readStatCards(win)
  const statsSame = JSON.stringify(statsAfterExport) === JSON.stringify(statsAfterImport)
  check(
    '导入后统计数据与导出时一致（全量还原）',
    statsSame && (statsAfterImport['总提交次数'] ?? 0) > 0,
    `导出时 ${JSON.stringify(statsAfterExport)} → 导入后 ${JSON.stringify(statsAfterImport)}`
  )

  await app.close().catch(() => undefined)
  await new Promise((r) => setTimeout(r, 800))
  const crashLogPath = path.join(userDataDir, 'crash.log')
  check('退出后无 crash.log（无未捕获异常）', !fs.existsSync(crashLogPath))
  const code = summary()
  process.exit(code)
}

main().catch((e) => {
  log('smoke crashed: ' + (e && e.stack ? e.stack : String(e)))
  process.exit(2)
})
