#!/usr/bin/env node
/**
 * 安装包自检：解出 asar，与 `out/` 逐文件比对 sha256，并抽查关键串。
 *
 * 用法：
 *   npm run verify:asar
 *   npm run verify:asar -- 1.20.0        # 显式指定版本（默认读 package.json）
 *
 * 为什么需要它：发版前必须确认「打进安装包的代码 == 刚构建出来的代码」。
 * 历史上踩过的坑：改了源码没重新 build 就打包、删了死代码但沿用了旧 asar、
 * `@electron/asar` 的 `extractFile('\\out\\main\\index.js')` 对某些 asar 会报
 * 「was not found in this archive」——所以这里统一走 `extractAll()` 再比对。
 */
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const asar = require('@electron/asar')

const ROOT = path.join(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const version = process.argv[2] || pkg.version
const DIST = path.join(ROOT, 'dist')
const INSTALLER = path.join(DIST, `ACM-Trainer-${version}-setup.exe`)
const ASAR = path.join(DIST, 'win-unpacked', 'resources', 'app.asar')

/** 发行包里必须存在的新功能关键串（每次发版补一行） */
const NEEDLES = [
  // v1.20
  'knowledgeIds',
  'ac-line',
  '排除已 AC',
  '只看已 AC',
  '确定全选',
  '取消全选',
  'KnowledgePicker',
  'kn-title',
  'graph_conn',
  '数位 DP',
  // v1.21
  'lists:archiveCatalog',
  'lists:createArchive',
  'skill:listCoverage',
  'archiveCandidates',
  '往届比赛题单',
  '仅显示题单知识点',
  // v1.21.1 掌握度广度门槛（FR-45）
  '标签覆盖',
  '掌握度广度'
]

let failed = 0
function ok(label, detail = '') {
  console.log(`PASS — ${label}${detail ? ` :: ${detail}` : ''}`)
}
function bad(label, detail = '') {
  failed += 1
  console.log(`FAIL — ${label}${detail ? ` :: ${detail}` : ''}`)
}

function sha256(file) {
  const h = crypto.createHash('sha256')
  h.update(fs.readFileSync(file))
  return h.digest('hex')
}

function walk(dir, base = dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full, base))
    else out.push(path.relative(base, full))
  }
  return out
}

function main() {
  if (!fs.existsSync(INSTALLER)) bad('安装包存在', INSTALLER)
  else {
    const mb = (fs.statSync(INSTALLER).size / 1024 / 1024).toFixed(2)
    ok('安装包存在', `${path.basename(INSTALLER)} ${mb}MB`)
  }
  if (!fs.existsSync(ASAR)) {
    bad('app.asar 存在（先跑 npm run build:win）', ASAR)
    process.exit(1)
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'asar-check-'))
  try {
    asar.extractAll(ASAR, tmp)
    const packedPkg = JSON.parse(fs.readFileSync(path.join(tmp, 'package.json'), 'utf8'))
    if (packedPkg.version === version) ok('asar 内版本号', packedPkg.version)
    else bad('asar 内版本号', `期望 ${version}，实际 ${packedPkg.version}`)

    const outDir = path.join(ROOT, 'out')
    const files = walk(outDir)
    let same = 0
    const diff = []
    for (const rel of files) {
      const a = path.join(outDir, rel)
      const b = path.join(tmp, 'out', rel)
      if (!fs.existsSync(b)) {
        diff.push(`${rel}（asar 内缺失）`)
        continue
      }
      if (sha256(a) === sha256(b)) same += 1
      else diff.push(rel)
    }
    if (diff.length === 0) ok('asar ↔ out 逐文件 sha256 一致', `${same}/${files.length}`)
    else bad('asar ↔ out 逐文件 sha256', `${same}/${files.length} 一致；不一致：${diff.join(', ')}`)

    const mainJs = fs.readFileSync(path.join(tmp, 'out', 'main', 'index.js'), 'utf8')
    const renderer = walk(path.join(tmp, 'out', 'renderer', 'assets'))
      .map((rel) => fs.readFileSync(path.join(tmp, 'out', 'renderer', 'assets', rel), 'utf8'))
      .join('\n')
    const blob = `${mainJs}\n${renderer}`
    const missing = NEEDLES.filter((n) => !blob.includes(n))
    if (missing.length === 0) ok('发行包包含本次新功能关键串', `${NEEDLES.length} 个全部命中`)
    else bad('发行包关键串', `缺失：${missing.join(', ')}`)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }

  console.log(failed === 0 ? '\nSUMMARY: 全部通过' : `\nSUMMARY: ${failed} 项失败`)
  process.exit(failed === 0 ? 0 : 1)
}

main()
