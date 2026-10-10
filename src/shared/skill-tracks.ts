import { MASTERY_TIER_ORDER, type MasteryTier } from './types'

/**
 * 国内比赛的技能树「赛道」预设（v1.10 FR-26）。
 *
 * 同一条技能树图谱（54 节点）按不同比赛的考纲做三件事：
 * - focus：该比赛的重点节点（界面高亮 + 题单生成的默认知识点来源）；
 * - required：必须达标的节点（达标线 = proficient「基本掌握」及以上）；
 * - ratingRange / meta：推荐难度区间与赛制说明（题单/计划生成的默认值）。
 *
 * 纯数据 + 纯函数，便于单测；节点 id 合法性由 tests/unit/skill-tracks.test.ts 校验。
 */

export interface SkillTrack {
  id: string
  /** 展示名 */
  name: string
  /** 一句话赛制说明（时长/题量/计分） */
  meta: string
  description: string
  /** 推荐练习难度区间（CF rating 口径） */
  ratingRange: [number, number]
  /** 重点节点（顺序即建议学习顺序，靠前优先） */
  focus: string[]
  /** 必达节点（达标线：基本掌握及以上） */
  required: string[]
}

export const SKILL_TRACKS: readonly SkillTrack[] = [
  {
    id: 'lanqiao',
    name: '蓝桥杯（省赛/国赛）',
    meta: 'OI 赛制 · 4 小时 · 约 10 题（含填空题）',
    description:
      '蓝桥杯以「基础算法 + 实现能力」为主：填空题考数学与手算，编程题集中在大模拟、枚举/暴力、排序、二分、简单 DP 与搜索。国赛会加难度到背包、图论与字符串。',
    ratingRange: [800, 1700],
    focus: [
      'math_basic',
      'impl',
      'sim_impl',
      'brute_force',
      'stl_usage',
      'sort',
      'enum',
      'prefix',
      'binary',
      'greedy',
      'dp',
      'search',
      'strings',
      'number',
      'combo',
      'dp_knapsack',
      'twopointer',
      'bitops',
      'recursion',
      'graph'
    ],
    required: ['math_basic', 'impl', 'sim_impl', 'brute_force', 'sort', 'prefix', 'binary', 'greedy', 'dp', 'search']
  },
  {
    id: 'gplt',
    name: '天梯赛（GPLT）',
    meta: '3 小时 · 团体计分（基础/进阶/登顶三档）',
    description:
      '天梯赛题量大、按档计分，考的是「读题快、实现稳」：字符串处理、结构体排序、大模拟、栈队列与图论基础是拿分主力，后期档位会出现最短路、DP 与数据结构。',
    ratingRange: [800, 1900],
    focus: [
      'impl',
      'sim_impl',
      'strings',
      'sort',
      'stl_usage',
      'stack_queue',
      'search',
      'graph',
      'shortest',
      'dp',
      'greedy',
      'prefix',
      'binary',
      'hash_str',
      'monotone',
      'segtree'
    ],
    required: ['impl', 'sim_impl', 'strings', 'sort', 'stl_usage', 'stack_queue', 'search', 'graph', 'dp']
  },
  {
    id: 'icpc',
    name: 'ICPC / CCPC 区域赛',
    meta: '5 小时 · ACM 赛制（20 分钟罚时）· 10~13 题',
    description:
      '区域赛覆盖全图谱，且「难题 + 罚时」决定名次：数据结构、图论、DP 优化、数论与组合是主力，需要能读英文题、快速分工与构造/交互题应对。',
    ratingRange: [1200, 2400],
    focus: [
      'math_basic',
      'impl',
      'sort',
      'greedy',
      'construct',
      'prefix',
      'binary',
      'twopointer',
      'bitops',
      'dp',
      'dp_knapsack',
      'dp_interval',
      'dp_tree',
      'dp_state',
      'dp_opt',
      'search',
      'graph',
      'shortest',
      'mst',
      'dsu',
      'fenwick',
      'segtree',
      'monotone',
      'heap',
      'strings',
      'hash_str',
      'strings_suf',
      'number',
      'mod_inv',
      'combo',
      'prob_stats',
      'matrix_linear',
      'geo',
      'flow',
      'match',
      'game_theory',
      'interactive'
    ],
    required: [
      'math_basic',
      'impl',
      'sort',
      'greedy',
      'construct',
      'dp',
      'search',
      'graph',
      'shortest',
      'dsu',
      'fenwick',
      'segtree',
      'strings',
      'number',
      'combo',
      'geo'
    ]
  },
  {
    id: 'noip',
    name: 'NOIP / CSP-S',
    meta: 'OI 赛制 · 3.5~4 小时 · 4 题（CSP-J 同源、难度更低）',
    description:
      '信奥体系重「DP + 图论 + 数据结构 + 数学」的扎实度，题目难度分层明显：T1 模拟/贪心、T2 简单 DP 或数据结构、T3/T4 是需要建模的 DP、图论或数论。',
    ratingRange: [1000, 2200],
    focus: [
      'math_basic',
      'impl',
      'enum',
      'brute_force',
      'sort',
      'prefix',
      'binary',
      'greedy',
      'recursion',
      'dp',
      'dp_knapsack',
      'dp_interval',
      'dp_tree',
      'dp_state',
      'search',
      'graph',
      'shortest',
      'mst',
      'dsu',
      'fenwick',
      'segtree',
      'monotone',
      'heap',
      'strings',
      'hash_str',
      'number',
      'mod_inv',
      'combo',
      'prob_stats',
      'matrix_linear'
    ],
    required: [
      'math_basic',
      'impl',
      'enum',
      'sort',
      'prefix',
      'greedy',
      'dp',
      'dp_knapsack',
      'search',
      'graph',
      'shortest',
      'dsu',
      'fenwick',
      'strings',
      'number'
    ]
  },
  {
    id: 'nowcoder',
    name: '牛客多校 / 小白月赛',
    meta: '2~3 小时 · ACM 赛制 · 思维/构造占比高',
    description:
      '牛客系比赛（多校训练营、小白月赛、练习赛）偏思维：构造、贪心、数学与博弈比例高，常常「代码短但要想」，需要大量思维题的题感积累。',
    ratingRange: [800, 2000],
    focus: [
      'impl',
      'construct',
      'greedy',
      'math_basic',
      'number',
      'combo',
      'game_theory',
      'dp',
      'bitops',
      'search',
      'stl_usage',
      'sim_impl',
      'prob_stats',
      'sort',
      'binary',
      'prefix',
      'graph',
      'matrix_linear'
    ],
    required: ['impl', 'construct', 'greedy', 'math_basic', 'number', 'dp', 'search', 'bitops']
  }
]

export const SKILL_TRACK_MAP: ReadonlyMap<string, SkillTrack> = new Map(
  SKILL_TRACKS.map((t) => [t.id, t])
)

/** 赛道涉及的全部节点 id（focus ∪ required） */
export function trackNodeIds(track: SkillTrack): Set<string> {
  return new Set([...track.focus, ...track.required])
}

export interface TrackProgress {
  trackId: string
  requiredTotal: number
  /** required 中已达「基本掌握」及以上的数量 */
  requiredDone: number
  focusTotal: number
  focusDone: number
  /** 建议优先学习：依赖已满足且未达标的 focus 节点（按 layer 升序，最多 8 个） */
  nextIds: string[]
}

/** 达标线：proficient（基本掌握）及以上 */
export function isTrackDone(tier: MasteryTier): boolean {
  return MASTERY_TIER_ORDER.indexOf(tier) >= MASTERY_TIER_ORDER.indexOf('proficient')
}

/** 计算某赛道的完成情况（纯函数） */
export function trackProgress(
  track: SkillTrack,
  nodes: { id: string; layer: number; tier: MasteryTier; depsReady: boolean }[]
): TrackProgress {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const count = (ids: string[]): { total: number; done: number } => {
    let total = 0
    let done = 0
    for (const id of ids) {
      const n = byId.get(id)
      if (!n) continue
      total += 1
      if (isTrackDone(n.tier)) done += 1
    }
    return { total, done }
  }
  const req = count(track.required)
  const foc = count(track.focus)
  const nextIds = track.focus
    .map((id) => byId.get(id))
    .filter((n): n is NonNullable<typeof n> => !!n && !isTrackDone(n.tier) && n.depsReady)
    .sort((a, b) => a.layer - b.layer)
    .slice(0, 8)
    .map((n) => n.id)
  return {
    trackId: track.id,
    requiredTotal: req.total,
    requiredDone: req.done,
    focusTotal: foc.total,
    focusDone: foc.done,
    nextIds
  }
}
