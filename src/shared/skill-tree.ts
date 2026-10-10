/**
 * ACM 知识点技能树图谱（v1.6 FR-9.1 + v1.7 FR-11 简介）。
 * 纯数据（代码为唯一事实源，docs/03 §12 引用本文件）：
 * - layer：0=最易（界面最下方）→ 6=最难（最上方）；
 * - dependsOn：前置知识点 id，且约束 dependsOn 的 layer ≤ 自身 layer（Kahn 校验无环，见 tests）；
 * - tags：关联题库标签（CF 官方英文 tag 与洛谷中文 tag 均可），用于按练习记录统计掌握度；
 *   存在性由 tests/unit/skill-tree-graph.test.ts 对 CF tag 全集与真实洛谷字典校验，防静默 0 统计；
 * - intro：中文简介（v1.7 FR-11，定位 + 解决什么问题 + 典型方向），仅展示于节点详情面板。
 */

export interface SkillNode {
  id: string
  name: string
  layer: number
  /** 关联标签（可多个；多标签题会同时计入相关节点） */
  tags: string[]
  /** 前置知识点 id（须满足前置 layer ≤ 自身 layer） */
  dependsOn: string[]
  /** 中文简介（v1.7 FR-11） */
  intro: string
}

/** Codeforces 官方 problemset 标签全集（用于图谱 tag 校验） */
export const CF_TAGS: readonly string[] = [
  '2-sat', 'bitmasks', 'brute force', 'binary search', 'chinese remainder theorem',
  'combinatorics', 'constructive algorithms', 'data structures', 'dfs and similar',
  'divide and conquer', 'dp', 'dsu', 'expression parsing', 'fft', 'flows',
  'games', 'geometry', 'graph matchings', 'graphs', 'greedy', 'hashing',
  'implementation', 'interactive', 'math', 'matrices', 'meet-in-the-middle',
  'number theory', 'probabilities', 'schedules', 'shortest paths', 'sortings',
  'string suffix structures', 'strings', 'ternary search', 'trees', 'two pointers'
]

export const LAYER_NAMES: readonly string[] = [
  '基础入门',
  '核心基础',
  '算法起步',
  '数据结构与 DP',
  '图论与进阶',
  '高级专题',
  '竞赛进阶'
]

/** 知识点图谱（id → 节点） */
export const SKILL_NODES: readonly SkillNode[] = [
  // ---------- L0 基础入门 ----------
  {
    id: 'math_basic', name: '基础数学', layer: 0, tags: ['math', '数学', '最大公约数', '最小公倍数', '质因数分解', '素性测试', '素数筛法', '欧几里得算法', '扩展欧几里得算法', '裴蜀定理', '抽屉原理'], dependsOn: [],
    intro: '整除、素数、最大公约数与同余等基本概念贯穿几乎所有算法题；先掌握这些数论工具，再向进阶数论专题迈进。'
  },
  {
    id: 'impl', name: '模拟与实现', layer: 0, tags: ['implementation', '模拟', '链表', '双向链表'], dependsOn: [],
    intro: '按题意直接模拟过程，细心处理边界与输出格式；把自然语言规则准确翻译成代码，是竞赛解题的底层能力。'
  },
  {
    id: 'enum', name: '枚举与暴力', layer: 0, tags: ['枚举'], dependsOn: [],
    intro: '穷举所有可能并逐一检验；数据范围较小时最直接有效，也是理解剪枝、折半枚举等优化思路的出发点。'
  },
  {
    id: 'sort', name: '排序', layer: 0, tags: ['sortings', '排序', '快速排序', '归并排序', '计数排序', '桶排序', '基数排序', '冒泡排序', '快速选择', '锦标赛排序', 'Tim 排序'], dependsOn: [],
    intro: '让数据有序的基础操作：快排/归并/计数排序及其应用（逆序对、去重、top-k）；许多题目先排序才能继续。'
  },
  {
    id: 'construct', name: '构造题', layer: 0, tags: ['constructive algorithms', '构造'], dependsOn: [],
    intro: '按约束手工设计一种可行方案并说明其正确性；锻炼观察与归纳能力，是 CF 低中难度的高频题型。'
  },

  // ---------- L1 核心基础 ----------
  {
    id: 'greedy', name: '贪心', layer: 1, tags: ['greedy', '贪心'], dependsOn: ['sort'],
    intro: '每一步取当前最优并证明全局最优；适用于具备交换论证/拟阵结构的问题，是区间调度、取最值类题目的常用策略。'
  },
  {
    id: 'prefix', name: '前缀和与差分', layer: 1, tags: ['前缀和', '差分'], dependsOn: ['math_basic'],
    intro: '用预处理把子段和、区间增量查询降到 O(1)/O(log n)；把区间操作转化为点操作，是大量题目的前置优化技巧。'
  },
  {
    id: 'recursion', name: '递归与分治', layer: 1, tags: ['divide and conquer', '递归', '分治'], dependsOn: ['enum'],
    intro: '把问题拆成同构子问题再合并结果；是搜索、动态规划、归并排序与快速幂等方法论基础。'
  },
  {
    id: 'twopointer', name: '双指针', layer: 1, tags: ['two pointers', '双指针 two-pointer', '双指针', '滑动窗口'], dependsOn: ['sort'],
    intro: '两个指针协同扫描线性结构，把 O(n²) 压到 O(n)；常用于有序数组配对、滑动窗口与去重类问题。'
  },
  {
    id: 'bitops', name: '位运算', layer: 1, tags: ['bitmasks', '位运算'], dependsOn: ['math_basic'],
    intro: '按位与/或/异或/移位的性质与技巧；状压 DP、集合运算、快速幂与二进制枚举都建立在位运算之上。'
  },
  {
    id: 'binary', name: '二分', layer: 1, tags: ['binary search', '二分', '二分查找', '三分查找'], dependsOn: ['sort'],
    intro: '在具备单调性的序列/答案空间上折半查找；二分答案、二分图判定等经典模型都以二分思想为核心。'
  },
  {
    id: 'bigint', name: '高精度', layer: 1, tags: ['高精度'], dependsOn: ['math_basic'],
    intro: '用数组/字符串模拟大整数四则运算（C++ 无内置大数）；涉及加减乘除与压位优化，使用 Java/Python 时可略。'
  },
  // ---------- v1.10 新增：国内比赛高频考点 ----------
  {
    id: 'stl_usage', name: '容器与 STL 应用', layer: 1, tags: ['数组', '哈希表', '有序集合', '堆（优先队列）', '字符串', 'data structures'], dependsOn: ['impl'],
    intro: '熟练使用 vector / map / set / priority_queue / string 等容器与算法库（sort、lower_bound、next_permutation）：国内比赛与天梯赛里「会用 STL」往往直接决定实现速度与罚时。'
  },
  {
    id: 'sim_impl', name: '大模拟与工程实现', layer: 1, tags: ['模拟', '设计', '数据流', '矩阵'], dependsOn: ['impl'],
    intro: '把冗长的题面规则完整、无遗漏地翻译成代码（多状态、分情况、边界处理）。蓝桥杯、天梯赛与区域赛签到题大量出现，是最考验耐心与工程习惯的一类题。'
  },
  {
    id: 'brute_force', name: '暴力与剪枝', layer: 1, tags: ['brute force', '枚举', 'Brute-Force Search'], dependsOn: ['enum'],
    intro: '先写出正确暴力再逐步优化：子集/排列枚举、可行性剪枝、最优性剪枝与卡常技巧。OI 赛制里「暴力拿部分分」是稳定得分的重要手段。'
  },
  {
    id: 'expression', name: '表达式与括号处理', layer: 3, tags: ['expression parsing', '括号序列'], dependsOn: ['stack_queue'],
    intro: '中缀/后缀表达式求值、括号匹配与括号序列合法性判定；是大模拟题与「字符串 + 栈」组合题的常见内核。'
  },
  {
    id: 'interactive', name: '交互题与提答', layer: 3, tags: ['interactive', '交互'], dependsOn: ['impl'],
    intro: '与评测程序交互（询问—回答式）或构造式输出：考的是策略设计（二分、随机化、分组）与 I/O 规范，区域赛与多校赛常见。'
  },
  {
    id: 'game_theory', name: '博弈论', layer: 3, tags: ['games', '博弈', '极小化极大', '零和博弈', '无偏博弈', 'Nim 游戏', 'Sprague–Grundy'], dependsOn: ['dp', 'math_basic'],
    intro: '公平组合游戏（Nim、SG 函数、必胜/必败态判定）与极小化极大搜索；牛客系与区域赛的思维题常以博弈为外壳。'
  },
  {
    id: 'prob_stats', name: '概率与期望', layer: 4, tags: ['probabilities', '概率与统计'], dependsOn: ['dp', 'math_basic'],
    intro: '概率 DP、期望线性性、随机化算法与蒙特卡洛估计；难度不低但套路清晰，是区域赛与 NOIP 提高组的常见进阶考点。'
  },
  {
    id: 'matrix_linear', name: '矩阵与线性代数', layer: 4, tags: ['matrices', '线性代数', '矩阵'], dependsOn: ['math_basic', 'mod_inv'],
    intro: '矩阵乘法与递推加速（矩阵快速幂）、高斯消元与线性基；把「递推 + 取模」的大规模问题降到 O(n³ log k)。'
  },
  {
    id: 'meet_middle', name: '折半搜索与双向 BFS', layer: 4, tags: ['meet-in-the-middle', '中途相遇', '双向搜索', '0-1 BFS'], dependsOn: ['brute_force', 'bitops'],
    intro: '把指数级搜索折半（meet-in-the-middle）或从两端同时 BFS：在 n≈40 的子集和、状态空间双向可达等场景里把复杂度开平方。'
  },
  {
    id: 'hash_str', name: '字符串哈希', layer: 4, tags: ['hashing', '哈希函数', '滚动哈希'], dependsOn: ['strings'],
    intro: '用多项式哈希 + 前缀哈希在 O(1) 内比较子串，解决重复子串、回文判定与「哈希 + 二分」类问题；注意双模/自然溢出与卡哈希风险。'
  },

  // ---------- L2 算法起步 ----------
  {
    id: 'stack_queue', name: '栈与队列', layer: 2, tags: ['栈', '队列'], dependsOn: ['recursion'],
    intro: '受限线性结构及其应用：括号匹配、表达式求值、单调队列滑动窗口等；也是单调栈、堆等进阶结构的前置。'
  },
  {
    id: 'search', name: '搜索 DFS/BFS', layer: 2, tags: ['dfs and similar', '深度优先搜索 DFS', '广度优先搜索 BFS', '深度优先搜索', '广度优先搜索', '回溯', '双向搜索', 'A* 搜索', 'Heuristic Search'], dependsOn: ['recursion', 'enum'],
    intro: '深度优先与广度优先遍历状态空间：DFS 负责回溯与连通性，BFS 擅长无权最短路与按层扩展；是暴力枚举与图论的核心手段。'
  },
  {
    id: 'graph', name: '图论入门', layer: 2, tags: ['graphs', '图论', '图', '拓扑排序', '有向无环图', '图的着色', '欧拉路径', '欧拉回路', '欧拉图', '半欧拉图', '强连通分量', 'Tarjan 强连通分量算法', 'Kosaraju 算法', '双连通分量', '割点', '桥', '平面图', '哈密顿通路'], dependsOn: ['search'],
    intro: '图的存储与遍历、连通性、环与拓扑排序等基本概念；最短路、生成树、网络流等一切图算法都建立在此之上。'
  },
  {
    id: 'dp', name: '动态规划入门', layer: 2, tags: ['dp', '动态规划 DP', '动态规划', '记忆化', '最长上升子序列', '最长公共子序列'], dependsOn: ['recursion', 'greedy', 'prefix'],
    intro: '把问题分解为重叠子问题并记录状态避免重复计算；线性/区间/背包 DP 构成竞赛中占比最大的题型家族。'
  },
  {
    id: 'dsu', name: '并查集', layer: 2, tags: ['dsu', '并查集'], dependsOn: ['recursion'],
    intro: '近常数时间维护集合合并与连通性查询；最小生成树、离线问题、带权并查集等大量场景的通用底座。'
  },
  {
    id: 'fenwick', name: '树状数组', layer: 2, tags: ['树状数组'], dependsOn: ['prefix'],
    intro: '基于 lowbit 的轻量数据结构，支持单点修改与前缀求和；比线段树实现简单，适合动态前缀统计与逆序对问题。'
  },

  // ---------- L3 数据结构与 DP ----------
  {
    id: 'heap', name: '堆与优先队列', layer: 3, tags: ['堆', '优先队列', '堆（优先队列）'], dependsOn: ['stack_queue'],
    intro: '维护动态集合的最值（插入/取最值 O(log n)）；用于贪心选择、K 路归并、Dijkstra 等需要反复取最值的场景。'
  },
  {
    id: 'monotone', name: '单调栈与单调队列', layer: 3, tags: ['单调栈', '单调队列'], dependsOn: ['stack_queue'],
    intro: '利用元素单调性在线性时间求左右最近更大/更小元素与滑动窗口最值；「下一个更大元素」类问题的标准解法。'
  },
  {
    id: 'segtree', name: '线段树', layer: 3, tags: ['data structures', '线段树', '扫描线', 'Sqrt Decomposition', 'Sparse Table', '区间最值查询', '树堆', 'Splay Tree', 'Cartesian Tree', 'K-D Tree', 'Li Chao Tree', '有序集合'], dependsOn: ['fenwick'],
    intro: '把区间问题分解为 O(log n) 个节点维护，支持区间查询/修改与懒标记；是可持久化、树套树等高级结构的前置。'
  },
  {
    id: 'number', name: '数论基础', layer: 3, tags: ['number theory', '数论', '费马小定理', '欧拉函数', '欧拉定理'], dependsOn: ['math_basic'],
    intro: '素数判定与筛法、辗转相除与扩展欧几里得、快速幂与同余；竞赛数论题的地基，也是逆元与莫比乌斯专题的前置。'
  },
  {
    id: 'combo', name: '组合数学', layer: 3, tags: ['combinatorics', '组合数学', '容斥原理'], dependsOn: ['math_basic'],
    intro: '排列组合计数、二项式系数与常用恒等式（隔板法、容斥初探）；计数题与概率题的核心工具。'
  },
  {
    id: 'shortest', name: '最短路', layer: 3, tags: ['shortest paths', '最短路', 'Dijkstra 算法', 'Floyd 算法', 'Bellman–Ford 算法', '0-1 BFS', 'k 短路'], dependsOn: ['graph'],
    intro: 'Dijkstra/SPFA/Bellman-Ford 与 Floyd 全源最短路；负权处理、分层图、次短路与路径计数等大量变体由此展开。'
  },
  {
    id: 'mst', name: '最小生成树', layer: 3, tags: ['生成树', '最小生成树', 'Kruskal 算法', 'Prim 算法', 'Boruvka 算法'], dependsOn: ['graph', 'dsu'],
    intro: 'Kruskal（并查集）与 Prim 求连通代价最小的生成树；衍生最小瓶颈路、次小生成树与生成树计数问题。'
  },
  {
    id: 'dp_interval', name: '区间 DP', layer: 3, tags: ['区间 DP'], dependsOn: ['dp'],
    intro: '状态以区间为维度、转移枚举断点合并子区间；典型应用如石子合并、矩阵链乘与括号序列计数。'
  },
  {
    id: 'dp_knapsack', name: '背包 DP', layer: 3, tags: ['背包 DP', '背包问题', '0-1 背包', '完全背包', '多重背包', '混合背包'], dependsOn: ['dp'],
    intro: '0/1、完全、多重背包及滚动数组优化；最基础的选与不选型 DP，衍生分组背包、依赖背包与方案计数。'
  },
  {
    id: 'dp_tree', name: '树形 DP', layer: 3, tags: ['树形 DP', 'trees', '二叉树', '二叉搜索树'], dependsOn: ['dp', 'graph'],
    intro: '以树为结构定义状态（子树/节点上做 DP），含换根 DP 与树上背包；处理树上最优化、计数与博弈问题。'
  },

  // ---------- L4 图论与进阶算法 ----------
  {
    id: 'dp_state', name: '状态压缩 DP', layer: 4, tags: ['状压 DP', 'bitmasks', '位掩码'], dependsOn: ['dp', 'bitops'],
    intro: '用二进制位表示集合作为状态维度（旅行商、覆盖与排列类问题）；与位运算紧密结合，小规模集合问题的最优解。'
  },
  {
    id: 'strings', name: '字符串与 KMP', layer: 4, tags: ['strings', 'KMP 算法', '字符串匹配', '扩展 KMP', '字典树', 'Manacher 算法'], dependsOn: ['stack_queue', 'dp'],
    intro: '字符串哈希与 KMP 单模式匹配（前缀函数 O(n+m)）；是字符串处理的基础，也是 AC 自动机、后缀结构的前置。'
  },
  {
    id: 'lca', name: 'LCA 与树上问题', layer: 4, tags: ['最近公共祖先 LCA', 'trees', '最近公共祖先', 'Binary Lifting'], dependsOn: ['graph', 'dp_tree'],
    intro: '倍增/树剖/Tarjan 求最近公共祖先，配合树上路径、直径、树上差分；处理树上距离与路径统计类问题的骨架。'
  },
  {
    id: 'geo', name: '计算几何入门', layer: 4, tags: ['geometry', '计算几何', '几何', '多边形', '凸包', '最小圆覆盖', '三角剖分'], dependsOn: ['math_basic'],
    intro: '向量叉积/点积、线段相交判定、多边形面积与凸包；需要严谨处理浮点误差与边界情形。'
  },
  {
    id: 'mod_inv', name: '数论进阶：逆元与筛', layer: 4, tags: ['逆元', '线性筛法', '筛法'], dependsOn: ['number'],
    intro: '模意义除法（费马小定理/扩展欧几里得求逆元）与线性筛预处理积性函数；组合数取模、莫比乌斯反演的前置。'
  },
  {
    id: 'flow', name: '网络流', layer: 4, tags: ['flows', '网络流', '最大流', '最小割', 'Edmonds–Karp 算法', 'Dinic 算法', 'MPM 算法', 'Push-Relabel 算法'], dependsOn: ['shortest', 'graph'],
    intro: '最大流（Dinic/ISAP）与最小割定理，把资源分配/约束满足问题建模为流；是竞赛建模能力的试金石。'
  },
  {
    id: 'match', name: '二分图匹配', layer: 4, tags: ['graph matchings', '二分图', '图的匹配', '最大匹配', '完美匹配', '匈牙利算法'], dependsOn: ['shortest', 'dsu'],
    intro: '匈牙利算法求最大匹配，及最小点覆盖/最大独立集/最大流的转化；图论建模中的高频套路。'
  },

  // ---------- L5 高级专题 ----------
  {
    id: 'strings_suf', name: '后缀自动机/数组', layer: 5, tags: ['string suffix structures', '后缀自动机 SAM', '后缀数组 SA', '后缀数组', 'Suffix Tree', 'Suffix Automato', 'Lyndon 分解', '最小表示法', 'AC 自动机'], dependsOn: ['strings'],
    intro: 'SA/SAM 等后缀数据结构用于本质不同子串统计、LCP、子串出现次数等；字符串进阶难题的主力工具。'
  },
  {
    id: 'dp_opt', name: 'DP 优化（斜率等）', layer: 5, tags: ['斜率优化'], dependsOn: ['dp', 'number'],
    intro: '单调队列、斜率优化与四边形不等式把 O(n²) 压到 O(n log n)/O(n)；大数据范围 DP 的进阶必修课。'
  },
  {
    id: 'persist', name: '可持久化与树套树', layer: 5, tags: ['可持久化', '可持久化线段树', '树套树', '可持久化数据结构'], dependsOn: ['segtree'],
    intro: '主席树等可持久化结构与线段树套平衡树；解决静态区间第 k 大、历史版本查询与多维动态问题。'
  },
  {
    id: 'tree_high', name: '点分治与树上高级', layer: 5, tags: ['点分治'], dependsOn: ['lca'],
    intro: '点分治统计树上路径类问题（长度/数量约束），配合树上启发式合并等技巧处理复杂树上统计。'
  },
  {
    id: 'mobius', name: '莫比乌斯反演', layer: 5, tags: ['莫比乌斯反演'], dependsOn: ['mod_inv'],
    intro: '利用莫比乌斯函数反演化简 gcd/lcm 类求和；数论高级专题核心，通常配合线性筛与整除分块使用。'
  },
  {
    id: 'fft', name: '多项式与 FFT', layer: 5, tags: ['fft', '快速傅里叶变换 FFT'], dependsOn: ['combo', 'mod_inv'],
    intro: '快速傅里叶变换把多项式乘法降到 O(n log n)；是生成函数计数与字符串快速匹配的底层引擎。'
  },

  // ---------- L6 竞赛进阶 ----------
  {
    id: 'flow_adv', name: '费用流与高级图论', layer: 6, tags: ['费用流', '2-SAT', '最小费用流', 'SSP 算法'], dependsOn: ['flow', 'match'],
    intro: '最小费用最大流、上下界网络流与 2-SAT 逻辑建模；把复杂约束翻译成流或布尔可满足问题。'
  },
  {
    id: 'math_adv', name: '数论高端专题', layer: 6, tags: ['杜教筛', '牛顿迭代法', '线性代数'], dependsOn: ['mobius'],
    intro: '杜教筛等亚线性筛法处理超大范围积性函数求和；数论方向选手的最终进阶目标。'
  },
  {
    id: 'final_sprint', name: '综合模拟与比赛策略', layer: 6, tags: [], dependsOn: ['flow_adv', 'fft', 'persist', 'strings_suf', 'tree_high'],
    intro: '综合运用图谱全部技能：多题时间分配、难度取舍、代码稳定性与调试策略；面向真实 ACM/CF 比赛的冲刺训练。'
  }
]

export const SKILL_NODE_MAP: ReadonlyMap<string, SkillNode> = new Map(
  SKILL_NODES.map((n) => [n.id, n])
)

/** 由易到难排序（layer 升序）；同层保持声明顺序 */
export function sortedSkillNodes(): SkillNode[] {
  return [...SKILL_NODES].sort((a, b) => a.layer - b.layer)
}

/** 每层节点 */
export function nodesByLayer(): { layer: number; name: string; nodes: SkillNode[] }[] {
  return LAYER_NAMES.map((name, layer) => ({
    layer,
    name,
    nodes: SKILL_NODES.filter((n) => n.layer === layer)
  }))
}
