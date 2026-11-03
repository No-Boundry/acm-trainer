/**
 * 标签同义映射（v1.18 FR-38）。
 *
 * 背景：同一道题在不同题源上会被打上不同拼写的标签——Codeforces 用英文
 * （greedy / dp / graphs），洛谷与力扣用中文（贪心 / 动态规划 DP / 图论）。
 * 结果是「点知识点里的 greedy 只筛出 CF 题」「已练习标签里 贪心 与 greedy
 * 分成两条」，跨源练习情况看不全。
 *
 * 方案：选定 **中文** 作为 canonical（UI 全中文，且洛谷 452 + 力扣 171 个
 * 中文标签远多于 CF 的 122 个 ASCII 标签），把别名**物化**成 canonical 写进库：
 * 写库时（ProblemsRepo.upsertMany）与旧库一次性迁移（db/index.ts）都把
 * 别名改写为 canonical，查询侧因此天然正确——同一个概念在 tags 表里只有一行，
 * `t.name IN (...)`、`GROUP BY t.id`、`COUNT(DISTINCT t.id)`（命中标签数排序）
 * 都不需要展开别名，也不会把两个拼写算成 2 个命中。
 *
 * 命名规范：canonical 取「题库里已存在且题量最大」的中文写法；没有对应中文
 * 概念的（Ad-hoc / STL / Tarjan / K-D Tree / 0-1 BFS …）保留原样，不做映射。
 * 来源 / 赛事类标签（Special Judge、ICPC、USACO、洛谷原创、各省省选…）与语言
 * 无关，一律不动。
 *
 * 维护：新增别名只需往对应 canonical 的数组里加一项；`canonicalTag()` 对
 * 大小写与连续空白不敏感（'Binary  Lifting' 也能命中）。
 */
export const TAG_ALIASES: Readonly<Record<string, readonly string[]>> = {
  // ---- Codeforces 英文 → 中文 ----
  贪心: ['greedy'],
  数学: ['math'],
  模拟: ['implementation'],
  动态规划: ['dp', '动态规划 DP'],
  数据结构: ['data structures'],
  暴力: ['brute force', 'Brute-Force Search'],
  构造: ['constructive algorithms'],
  排序: ['sortings'],
  二分: ['binary search', '二分查找'],
  深度优先搜索: ['dfs and similar', '深度优先搜索 DFS'],
  广度优先搜索: ['广度优先搜索 BFS'],
  图论: ['graphs'],
  树: ['trees'],
  字符串: ['strings'],
  数论: ['number theory'],
  组合数学: ['combinatorics'],
  计算几何: ['geometry'],
  位运算: ['bitmasks', '位掩码'],
  双指针: ['two pointers', '双指针 two-pointer'],
  并查集: ['dsu', '并查集（DSU）'],
  最短路: ['shortest paths'],
  分治: ['divide and conquer'],
  交互题: ['interactive', '交互'],
  博弈论: ['games', '博弈'],
  网络流: ['flows'],
  概率论: ['probabilities'],
  哈希: ['hashing', '哈希 hashing', '哈希函数'],
  矩阵: ['matrices'],
  三分: ['ternary search', '三分查找'],
  折半搜索: ['meet-in-the-middle', '折半搜索 meet in the middle', '中途相遇'],
  '2-SAT': ['2-sat'],
  字符串后缀结构: ['string suffix structures'],
  二分图匹配: ['graph matchings'],
  调度: ['schedules'],
  表达式解析: ['expression parsing'],
  '快速傅里叶变换 FFT': ['fft'],
  中国剩余定理: ['chinese remainder theorem', '中国剩余定理 CRT'],

  // ---- 洛谷 / 力扣的 ASCII 写法 → 中文 ----
  倍增: ['Binary Lifting'],
  笛卡尔树: ['Cartesian Tree'],
  'ST 表': ['Sparse Table'],
  李超线段树: ['Li Chao Tree'],
  平衡树: ['Splay Tree'],
  分块: ['Sqrt Decomposition'],
  启发式搜索: ['Heuristic Search'],
  舞蹈链: ['Dancing Links'],
  通信题: ['communication'],
  后缀树: ['Suffix Tree'],
  后缀自动机: ['后缀自动机 SAM', 'Suffix Automato'],
  回文自动机: ['回文自动机 PAM', 'Palindromic Tre'],
  后缀数组: ['后缀数组 SA'],

  // ---- 中文同义写法 ----
  字典树: ['字典树 Trie'],
  记忆化搜索: ['记忆化'],
  堆: ['优先队列', '堆（优先队列）']
}

/** 归一化：去首尾空白、压缩连续空白、小写（用于查找，不改写标签本身） */
function normName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

const CANONICAL_INDEX: Map<string, string> = (() => {
  const map = new Map<string, string>()
  for (const [canonical, aliases] of Object.entries(TAG_ALIASES)) {
    map.set(normName(canonical), canonical)
    for (const alias of aliases) map.set(normName(alias), canonical)
  }
  return map
})()

/** 标签别名总数（canonical + 别名），供文档与测试引用 */
export const TAG_ALIAS_TOTAL: number = Object.values(TAG_ALIASES).reduce(
  (sum, aliases) => sum + aliases.length,
  Object.keys(TAG_ALIASES).length
)

/** 别名 → canonical。未收录的标签原样返回（去掉首尾空白）。 */
export function canonicalTag(name: string): string {
  const trimmed = name.trim()
  if (trimmed === '') return trimmed
  return CANONICAL_INDEX.get(normName(trimmed)) ?? trimmed
}

/**
 * 批量 canonical 化并去重（保持首次出现的顺序）。
 * 例：['greedy', '贪心', 'dp'] → ['贪心', '动态规划']
 */
export function canonicalTags(names: readonly string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const name of names) {
    const canonical = canonicalTag(name)
    if (canonical === '' || seen.has(canonical)) continue
    seen.add(canonical)
    out.push(canonical)
  }
  return out
}
