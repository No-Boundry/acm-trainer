# ACM-Trainer（ACM 训练助手）

[![version](https://img.shields.io/badge/version-1.10.1-blue)](https://github.com/No-Boundry/acm-trainer/releases)
[![tests](https://img.shields.io/badge/tests-375%20passed-brightgreen)](docs/04-测试规范.md)
[![gui](https://img.shields.io/badge/verify%3Agui-59%2F59-brightgreen)](docs/04-测试规范.md)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![platform](https://img.shields.io/badge/platform-Windows%2010%2F11-lightgrey)](#快速开始)

面向个人 ACM/ICPC 学习与训练的**本地桌面应用**（Electron 37 + Vue 3 + TypeScript + SQLite）。当前版本 **v1.10.1**，规格驱动开发（SDD），规格文档见 [docs/](docs/)。

- 📚 **题库**：Codeforces（约 1.1 万题）、洛谷 P 题（约 1.6 万题）与**力扣算法题（3930 道）三数据源**（合计 31,585 题），按难度/标签/状态/关键字筛选，**排序规则**（按难度按各题源自己的难度列、按题号数字序、空难度恒排最后、全部视图按题源分组）
- 🧠 **知识点筛选**：**54 个知识点**按 L0–L6 分层展示，带掌握度色点与「已练/已 AC」题数，多选并集筛题（已接入力扣中文标签）
- 🗺️ **学习路径（技能树）**：内置知识图谱（依赖连线、五档掌握度、推荐下一步），一键跳题库练习（**支持单个知识点直达**：卡片「📚」快捷按钮或详情面板按钮）；**5 个国内比赛赛道**（蓝桥杯 / 天梯赛 GPLT / ICPC·CCPC / NOIP·CSP-S / 牛客多校）—— 赛制说明、推荐难度、**必达进度条**、「按赛道去题库练习」
- 📋 **题单**：**三种建法**（题库勾选 / 粘贴题号识别 / 按知识点+难度生成），题单内记录完成状态、备注与复习进度
- 🔁 **题单内间隔复习**：**1 / 3 / 7 / 14 / 30 / 60 天**阶梯，勾选完成自动进入第 1 档；「今日复习」跨题单汇总（逾期也算），反馈 **困难退一档 / 一般进一档 / 轻松跳一档**
- 🗓️ **训练计划**：日历排期式 —— 每日题量、每周休息日、**标记「这天没空」后未完成任务自动顺延**、任务打卡、**超出目标日期的题量明确提示（不硬塞、不丢题）**
- 📝 **练习记录与统计**：结果/耗时/错题标记，ECharts 趋势与知识点分布，**难度分布（按题源）**
- 📓 **笔记与错题本**：Markdown 编辑（代码高亮、Tab 缩进、自动保存）
- 🧩 **模板库**：算法模板分类管理，一键复制
- 📘 **STL 速查**：内置 34 条竞赛 STL 参考资料（容器/算法/复杂度/坑点，可搜索、一键复制代码、跳转 cppreference）
- ⚔️ **虚拟比赛**：按难度/知识点组卷、限时训练、ACM 罚时计分、结果回看
- 🏅 **水平评估**：综合分（练习+比赛，权重可配）＋ 独立的洛谷练习水平与**力扣练习水平**，历史趋势
- 🔗 **题面**：用 **Edge 浏览器**打开原站页面（CF / 洛谷 / 力扣；v1.8 起不再内嵌网页题面）

## 快速开始

1. 安装：运行 `dist\ACM-Trainer-1.10.1-setup.exe`（或免安装版 `dist\win-unpacked\ACM-Trainer.exe`）；
2. 首次进入「题库」页依次点 **同步题库**（Codeforces，1–3 分钟）、**同步洛谷**（3–5 分钟）、**同步力扣**（约 30–40 秒）；
3. 用「知识点筛选」按知识点练题 → 点「记录」写练习记录（排序可选「按难度 / 按题号 / 按 AC 数」，默认方向自动切换）；
4. 到「学习路径」看掌握度与推荐，点「去题库练习」一键选中建议知识点，或用卡片右上角「📚」直达**单个知识点**；也可**切换国内比赛赛道**看必达进度；
5. 到「📋 题单/计划」把要练的题组成题单（题库勾选 / 粘贴题号 / 按知识点生成），用「🔁 今日复习」按间隔复习；
6. 到「🗓️ 训练计划」按每日题量排上日历，标记没空日自动顺延，做完就地打卡；
7. 到「统计 → 难度分布（按题源）」看各难度段的已练/AC 情况。

📖 **完整使用说明：[docs/09-使用手册.md](docs/09-使用手册.md)**（含 24 张真实界面截图）

## 常用命令

| 命令 | 说明 |
| ---- | ---- |
| `npm run dev` | 开发模式启动应用 |
| `npm run build` | 构建 main/preload/renderer 到 out/ |
| `npm run build:win` | 构建并打包 Windows 安装包到 dist/ |
| `npm test` | 运行全部单元/集成测试（vitest，**375 例 / 39 文件**；PowerShell 下用 `npm.cmd test`，或 `node node_modules/vitest/vitest.mjs run`） |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run verify:gui` | GUI 特性验收（playwright 驱动真实应用，**59/59 通过**：59 项断言 + 截图） |
| `npm run verify:smoke` | GUI 端到端冒烟（**33 项**断言 + 截图） |
| `npm run verify:lc` | 真实力扣同步验收（**联网**调用 leetcode.cn，约 30–40 秒，12 项断言） |
| `npm run docs:shots` | 重新生成使用手册配图（docs/images/，**24 张**） |
| `npm run docs:stl` | 从数据生成 docs/10-STL参考.md |

## 文档

| 编号 | 文档 |
| ---- | ---- |
| 00 | 项目概述 |
| 01 | 需求规格说明书（SRS） |
| 02 | 概要设计 |
| 03 | 详细设计 |
| 04 | 测试规范 |
| 05 | 任务分解与计划 |
| 06 | 用户验收指引 |
| 07 | 需求追踪矩阵 |
| 08 | 发布说明 |
| **09** | **使用手册（面向使用者）** |
| **10** | **STL 参考（速查，可由数据生成）** |

## 项目结构

```
src/
├── main/          主进程：db（schema + repositories + 迁移）、services（cf/luogu/leetcode/rating/difficulty-stats/skill/problem-list/training-plan/review…）、ipc（各域 handler）
├── preload/       contextBridge 白名单桥接（window.api）
├── shared/        跨进程类型、IPC 通道常量、技能树图谱（54 节点 + 5 个国内比赛赛道）、标签分类
└── renderer/      Vue 3 应用（11 个页面 + Pinia stores + 组件）
tests/             单元 / 集成 / 渲染组件测试（vitest，39 个文件 / 375 用例）
tools/             GUI 自动化验收（gui-verify / gui-smoke / gui-lc-sync）与手册配图脚本（playwright-core）
docs/              SDD 文档 00–08 + 使用手册 09 + STL 参考 10（含 images/ 截图 24 张）
backup/            旧版项目归档
```

## 环境备注（Windows）

- npm.ps1 被执行策略禁止时使用 `npm.cmd`；
- npm 11 首次安装需 `npm install-scripts approve better-sqlite3 electron esbuild vue-demi`；
- SQLite 使用 better-sqlite3 v13（Node-API 预编译，无需本机 C++ 工具链）；
- 题面统一由 **Edge 浏览器**打开；未检测到 Edge 时回退系统默认浏览器；
- GUI 自动化脚本启动时会剔除环境变量 `ELECTRON_RUN_AS_NODE`（该变量会让 electron.exe 退化为纯 Node，无法创建窗口）。
