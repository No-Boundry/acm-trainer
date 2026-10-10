/**
 * 从 src/shared/stl-reference.ts 生成 docs/10-STL参考.md（保持文档与数据同源）。
 * 用法：npm run docs:stl
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const SRC = path.join(ROOT, 'src', 'shared', 'stl-reference.ts')
const OUT = path.join(ROOT, 'docs', '10-STL参考.md')

// 以正则解析数据文件（避免引入 TS 运行时）
const src = fs.readFileSync(SRC, 'utf8')

// 分类
const cats = [...src.matchAll(/key: '([a-z]+)',\s*label: '([^']+)',\s*hint: '([^']*)'/g)].map((m) => ({
  key: m[1],
  label: m[2],
  hint: m[3]
}))

// 条目：以 `id: '...'` 为起点，逐字段抓取
const entryChunks = src.split(/\n  \{\n/).slice(1)
const entries = []
for (const chunk of entryChunks) {
  const get = (re) => {
    const m = chunk.match(re)
    return m ? m[1] : null
  }
  const id = get(/id: '([^']+)'/)
  if (!id) continue
  const unescape = (s) => (s === null ? null : s.replace(/\\`/g, '`').replace(/\\\$\{/g, '${'))
  entries.push({
    id,
    category: get(/category: '([a-z]+)'/),
    name: unescape(get(/name: '([^']*)'/)),
    summary: unescape(get(/summary: '([^']*)'/)),
    code: unescape(get(/code: `([\s\S]*?)`/)),
    complexity: unescape(get(/complexity: '([^']*)'/)),
    pitfalls: unescape(get(/pitfalls: '([^']*)'/)),
    url: get(/url: cref\('([^']+)'\)/)
  })
}

const catLabel = (k) => cats.find((c) => c.key === k)?.label ?? '其他'
const catHint = (k) => cats.find((c) => c.key === k)?.hint ?? ''

let md = `# 10 STL 参考（速查）

> 竞赛常用 STL 参考资料（C++17），共 **${entries.length}** 条。
> 本文件由 \`npm run docs:stl\` 从 \`src/shared/stl-reference.ts\` 生成，与应用内「📘 STL 速查」页面同源（修改数据后重新生成即可）。
> 应用内入口：侧边栏「STL 速查」（支持搜索与一键复制代码，跳转 cppreference）。

## 目录

`
for (const c of cats) {
  const items = entries.filter((e) => e.category === c.key)
  if (items.length === 0) continue
  md += `- [${c.label}（${items.length}）](#${c.label})\n`
}
md += `\n---\n`

for (const c of cats) {
  const items = entries.filter((e) => e.category === c.key)
  if (items.length === 0) continue
  md += `\n## ${c.label}\n\n> ${catHint(c.key)}\n`
  for (const e of items) {
    md += `\n### ${e.name}\n\n${e.summary}\n\n`
    if (e.complexity) md += `- **复杂度**：${e.complexity}\n`
    if (e.url) md += `- **官方文档**：https://en.cppreference.com/w/cpp/${e.url}\n`
    md += `\n\`\`\`cpp\n${(e.code ?? '').trim()}\n\`\`\`\n`
    if (e.pitfalls) md += `\n> ⚠️ **注意**：${e.pitfalls}\n`
  }
}

md += `
---

## 附：配套资源

| 资源 | 位置 |
| ---- | ---- |
| 应用内速查页（可搜索/复制） | 侧边栏「📘 STL 速查」 |
| 自己的代码模板 | 「模板库」页（分类管理、一键复制） |
| 按知识点练题 | 「学习路径」→「去题库练习」或题库页「知识点筛选」 |
| 使用手册 | \`docs/09-使用手册.md\` |
| 官方文档 | https://en.cppreference.com/w/cpp （页面内可跳转） |
`

fs.writeFileSync(OUT, md, 'utf8')
console.log(`生成 ${path.relative(ROOT, OUT)}：${entries.length} 条 / ${cats.length} 个分类`)
