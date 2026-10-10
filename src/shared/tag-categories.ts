/**
 * 题库标签分类（v1.2 FR-8.8）。
 * 跨源统一大类：Codeforces 英文标签与洛谷中文标签归入同一批中文大类。
 * 纯数据+纯函数，主进程/渲染进程共享；规则可维护（增删映射即可）。
 * 匹配顺序：精确等值（exact，大小写不敏感）→ 关键词子串（keywords）→ '其他'。
 * 注意：子串关键词必须避开跨类误伤词（如 '二分' 会命中 '二分图'、'树' 会命中 '树状数组'）。
 */

export interface TagCategoryDef {
  name: string
  /** 精确匹配（官方标签名，大小写不敏感） */
  exact: string[]
  /** 关键词子串匹配（用于中文标签等） */
  keywords: string[]
}

/** 内置大类（顺序即展示顺序；未命中落入最后兜底类） */
export const TAG_CATEGORIES: TagCategoryDef[] = [
  {
    name: '算法基础',
    exact: [
      // Codeforces
      'implementation',
      'brute force',
      'greedy',
      'constructive algorithms',
      'sortings',
      'binary search',
      'bitmasks',
      'expression parsing',
      'schedules',
      'two pointers',
      'divide and conquer',
      // 洛谷基础/语言类（精确等值，避免子串误伤）
      '二分',
      '模拟',
      '枚举',
      '贪心',
      '构造',
      '排序',
      '高精度',
      '递推',
      '进制转换',
      '进制',
      '顺序结构',
      '分支结构',
      '循环结构',
      '数组',
      '结构体',
      '链表',
      '函数与递归',
      '递归',
      '栈',
      '队列',
      '位运算',
      '差分',
      '前缀和',
      '离散化',
      '倍增',
      'STL',
      '整体二分',
      'Ad-hoc'
    ],
    keywords: [
      '模拟',
      '枚举',
      '贪心',
      '构造',
      '排序',
      '高精度',
      '递推',
      '语言入门',
      '暴力',
      '双指针',
      '分治',
      '倍增',
      '基础算法',
      '位运算'
    ]
  },
  {
    name: '动态规划',
    exact: ['dp', '动态规划 DP', '背包 DP', '区间 DP', '动态 DP', '线性 DP', 'DP 套 DP'],
    keywords: [
      '动态规划',
      '状态压缩',
      '状压',
      '数位',
      'dp',
      '背包',
      '斜率',
      '决策单调',
      '四边形不等式',
      'wqs',
      '轮廓线',
      '状态合并',
      '转移'
    ]
  },
  {
    name: '图论',
    exact: [
      // Codeforces
      'graphs',
      'graph matchings',
      'trees',
      'shortest paths',
      'flows',
      '2-sat',
      'differential constraints',
      'dsu',
      // 洛谷
      '二分图',
      '树论',
      '树套树',
      '最小环',
      'Kruskal 重构树',
      '最近公共祖先 LCA',
      'Floyd 算法',
      '图遍历',
      '负权环'
    ],
    keywords: [
      '图论',
      '最短路',
      '最小生成树',
      '生成树',
      '网络流',
      '费用流',
      '最小割',
      '拓扑',
      'tarjan',
      '差分约束',
      '欧拉回路',
      '连通',
      '分量',
      '仙人掌',
      '圆方树',
      '基环树',
      '弦图',
      '平面图',
      '匹配',
      '树论',
      '树套树',
      'lca',
      'floyd',
      '树的',
      '直径',
      '重心',
      'kruskal',
      '遍历',
      '串并联'
    ]
  },
  {
    name: '数学',
    exact: [
      // Codeforces
      'math',
      'number theory',
      'combinatorics',
      'probabilities',
      'games',
      'matrices',
      'geometry',
      'fft',
      'chinese remainder theorem'
    ],
    keywords: [
      '数学',
      '数论',
      '组合',
      '概率',
      '期望',
      '博弈',
      '矩阵',
      '线性代数',
      '高斯消元',
      'ntt',
      'fwt',
      '多项式',
      '生成函数',
      '容斥',
      '莫比乌斯',
      '斯特林',
      '卡特兰',
      '欧拉',
      '计算几何',
      '凸包',
      '旋转卡壳',
      '半平面交',
      'simpson',
      '拉格朗日',
      '斐波那契',
      'fibonacci',
      'catalan',
      'stirling',
      '素数',
      '质数',
      'gcd',
      '欧几里',
      '逆元',
      '剩余定理',
      'crt',
      'lucas',
      '原根',
      '线性基',
      '线性筛',
      '杜教筛',
      '二次剩余',
      'bsgs',
      '大步小步',
      '群论',
      '置换',
      'polya',
      'pólya',
      'dilworth',
      '康托',
      '鸽笼',
      '抽屉',
      '二项式',
      '组合数',
      '行列式',
      '微积分',
      '导数',
      '积分',
      '级数',
      '向量',
      '叉积',
      '线段相交',
      '平面几何',
      '闵可夫斯基',
      '类欧几里',
      'berlekamp',
      '调和级数',
      'nim',
      'sg 函数',
      '随机游走',
      '鞅',
      '特征值',
      '单位根反演',
      '分数规划',
      '整数规划',
      '线性规划',
      '保序回归',
      '近似算法',
      '梯度下降',
      '随机化',
      '亚线性',
      '信息论',
      'lgv',
      '杨表',
      'prüfer',
      'stern',
      '拟阵',
      '对偶',
      '不定方程',
      'dirichlet',
      'bézout',
      'hall 定理',
      '快速傅里叶',
      '鞅'
    ]
  },
  {
    name: '数据结构',
    exact: ['data structures', '暴力数据结构', 'ST 表', 'K-D Tree', '全局平衡二叉树', '堆', '可并堆', '优先队列'],
    keywords: [
      '数据结构',
      '线段树',
      '树状数组',
      '并查集',
      '平衡树',
      '堆',
      'st表',
      '可持久化',
      '主席树',
      '树链剖分',
      'lct',
      '虚树',
      '分块',
      '莫队',
      '扫描线',
      '单调栈',
      '单调队列',
      '字典树',
      '树形',
      '笛卡尔树',
      '珂朵莉',
      '霍夫曼',
      '离线',
      '启发式合并',
      '树套树',
      'bitset',
      'kinetic'
    ]
  },
  {
    name: '字符串',
    exact: ['strings', 'string suffix structures', 'hashing', '后缀树', '回文自动机 PAM'],
    keywords: [
      '字符串',
      'kmp',
      '哈希',
      'ac 自动机',
      '后缀自动机',
      '后缀数组',
      'manacher',
      'z 函数',
      'lyndon',
      '最小表示'
    ]
  },
  {
    name: '搜索',
    exact: ['dfs and similar', 'meet-in-the-middle', 'ternary search', 'interactive', '三分', 'A* 算法'],
    keywords: ['搜索', 'dfs', 'bfs', '回溯', '剪枝', '折半', 'dancing', '爬山算法', '模拟退火', '遗传算法', '随机', 'a*']
  },
  {
    name: '其他',
    exact: [],
    keywords: []
  }
]

const EXACT_INDEX: { lower: string; category: string }[] = []
for (const c of TAG_CATEGORIES) {
  for (const t of c.exact) {
    EXACT_INDEX.push({ lower: t.toLowerCase(), category: c.name })
  }
}

/** 将标签名归入大类（未命中 → '其他'） */
export function categorizeTag(tag: string): string {
  const lower = tag.trim().toLowerCase()
  // 1) 精确匹配
  const hit = EXACT_INDEX.find((e) => e.lower === lower)
  if (hit) return hit.category
  // 2) 关键词子串匹配（跳过兜底类自身）
  for (const c of TAG_CATEGORIES) {
    if (c.name === '其他') continue
    for (const kw of c.keywords) {
      const k = kw.toLowerCase()
      if (k.length > 1 && lower.includes(k)) return c.name
    }
  }
  return '其他'
}

/** 将标签列表分组：{ 分类名: [标签...] }，保持分类顺序 */
export function groupTagsByCategory(tags: string[]): { category: string; tags: string[] }[] {
  const groups = new Map<string, string[]>()
  for (const c of TAG_CATEGORIES) groups.set(c.name, [])
  for (const tag of tags) {
    const cat = categorizeTag(tag)
    if (!groups.has(cat)) groups.set(cat, [])
    groups.get(cat)!.push(tag)
  }
  return TAG_CATEGORIES.map((c) => ({ category: c.name, tags: groups.get(c.name) ?? [] })).filter(
    (g) => g.tags.length > 0
  )
}
