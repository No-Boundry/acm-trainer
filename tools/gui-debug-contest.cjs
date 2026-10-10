const path = require('path')
const { createRunner, seedData, launchApp, reload, gotoPage } = require('./gui-lib.cjs')

const runner = createRunner('.gui-debug')
const { log } = runner

async function main() {
  const { app, win, userDataDir } = await launchApp(path.join(runner.USER_DATA))
  seedData(userDataDir)
  await reload(win, 1600)
  await gotoPage(win, '虚拟比赛')
  await win.waitForTimeout(800)

  const name = win.locator('.create-view input.input').first()
  await name.fill('debug-contest')
  const nums = win.locator('.create-view input[type="number"]')
  log('number inputs = ' + (await nums.count()))
  for (let i = 0; i < (await nums.count()); i++) {
    log(`  nth(${i}) value="${await nums.nth(i).inputValue()}" placeholder="${await nums.nth(i).getAttribute('placeholder')}"`)
  }
  await nums.nth(0).fill('60')
  await nums.nth(1).fill('800')
  await nums.nth(2).fill('1600')
  await win.locator('button', { hasText: '生成题单' }).click()
  await win.waitForTimeout(2000)

  const rows = await win.locator('.create-view table.table tbody tr').count()
  const toasts = await win.locator('.toast').allInnerTexts()
  const createDisabled = await win.locator('button', { hasText: '创建并开始比赛' }).first().isDisabled()
  log(`生成后：表行=${rows} 创建按钮禁用=${createDisabled} toast=${JSON.stringify(toasts)}`)
  const createText = (await win.locator('.create-view').innerText()).replace(/\s+/g, ' ')
  log('create-view 文本片段: ' + createText.slice(0, 400))

  await app.close().catch(() => undefined)
}

main().catch((e) => {
  log('debug crashed: ' + (e && e.stack ? e.stack : String(e)))
  process.exit(1)
})
