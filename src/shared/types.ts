/**
 * 跨进程共享类型定义（v1.0，与 docs/03-详细设计 §2 对齐）。
 */

/** 统一 IPC 响应包装：{ ok:true, data } | { ok:false, error } */
export type IpcResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } }

export type ResultStatus =
  | 'AC'
  | 'WA'
  | 'TLE'
  | 'RE'
  | 'MLE'
  | 'CE'
  | 'SKIP'
  | 'UNSOLVED'

/** 题目数据源（v1.1 FR-8 双源；v1.9 FR-21 增加力扣） */
export type ProblemSource = 'cf' | 'luogu' | 'leetcode'

/** 洛谷难度评级（0-7，官方映射） */
export const LUOGU_DIFFICULTY_LABELS: readonly string[] = [
  '暂无评定',
  '入门',
  '普及-',
  '普及/提高-',
  '普及+/提高',
  '提高+/省选-',
  '省选/NOI-',
  'NOI/NOI+/CTSC'
]

/** 力扣难度评级（1-3，官方「简单/中等/困难」） */
export const LEETCODE_DIFFICULTY_LABELS: readonly string[] = ['', '简单', '中等', '困难']

/** 力扣练习分默认折算（无官方分值，参照洛谷同量级映射，可在设置中修改） */
export const LEETCODE_DIFFICULTY_RATING: Readonly<Record<number, number>> = {
  1: 1000,
  2: 1500,
  3: 2000
}

export interface Problem {
  id: string // 'contestId:index'(cf) / 'P1000'(luogu) / 'LC1'(leetcode)
  contestId: number // luogu/leetcode 行固定 0
  index: string // cf 题号字母 / luogu pid / leetcode titleSlug
  name: string
  rating: number | null // 仅 cf 行非空
  difficulty: number | null // 洛谷 0-7 / 力扣 1-3，仅对应来源行
  solvedCount: number
  totalSubmit: number
  source: ProblemSource
  cfUrl: string // 语义：来源题面 URL
  tags: string[]
  fetchedAt: string
}

export interface PracticeRecord {
  id: number
  problemId: string
  status: ResultStatus
  durationSeconds: number | null
  note: string | null
  isMistake: boolean
  /** v1.2 FR-8.9：导入来源标记（'luogu-import' 等），手动记录为 null */
  importSource?: string | null
  createdAt: string
}

export interface Note {
  id: number
  problemId: string | null
  title: string
  content: string
  tags: string[]
  createdAt: string
  updatedAt: string
}

export interface Template {
  id: number
  category: string
  title: string
  language: string
  description: string
  code: string
  createdAt: string
  updatedAt: string
}

export type ContestStatus = 'pending' | 'running' | 'finished'

export interface ContestProblem {
  position: number // 0=A, 1=B, ...
  problem: Problem
}

export interface ContestSubmission {
  id: number
  problemId: string
  status: ResultStatus
  secondsElapsed: number
  submittedAt: string
}

export interface Contest {
  id: number
  name: string
  durationMinutes: number
  status: ContestStatus
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
  problems: ContestProblem[]
  submissions: ContestSubmission[]
}

/** 比赛结果（finish 时计算） */
export interface ContestResult {
  contest: Contest
  solvedCount: number
  totalPenaltySeconds: number
  breakdown: {
    position: number
    problemId: string
    status: ResultStatus | null
    acSeconds: number | null
    wrongCount: number
    penaltySeconds: number | null
  }[]
}

/** 洛谷练习水平（v1.3 FR-6.6：独立显示，不并入 CF 综合） */
export interface LuoguRatingInfo {
  /** 洛谷练习分（难度折算同量级分值，独立计算） */
  rating: number | null
  attemptCount: number
  acCount: number
  accuracy: number | null
  /** 洛谷难度分布（1-7）：各档练习数与 AC 数 */
  difficultyDist: { difficulty: number; total: number; ac: number }[]
}

/** 力扣练习水平（v1.9 FR-23：独立显示，不并入 CF 综合，与洛谷同构） */
export interface LeetcodeRatingInfo {
  /** 力扣练习分（简单/中等/困难折算同量级分值，独立计算） */
  rating: number | null
  attemptCount: number
  acCount: number
  accuracy: number | null
  /** 力扣难度分布（1-3）：各档练习数与 AC 数 */
  difficultyDist: { difficulty: number; total: number; ac: number }[]
}

export interface RatingBreakdown {
  practiceRating: number | null
  contestRating: number | null
  finalRating: number | null
  title: string | null
  color: string | null
  acCount: number
  attemptCount: number
  accuracy: number | null
  /** 洛谷练习水平（独立显示，不并入 CF 综合，v1.3 FR-6.6） */
  luogu: LuoguRatingInfo
  /** 力扣练习水平（独立显示，不并入 CF 综合，v1.9 FR-23） */
  leetcode: LeetcodeRatingInfo
}

export interface RatingSnapshot {
  id: number
  rating: number
  source: 'practice' | 'contest' | 'manual'
  detail: string | null
  createdAt: string
}

// ============ v1.6 技能树（FR-9） ============

export type MasteryTier = 'untouched' | 'newbie' | 'learning' | 'proficient' | 'master'

export interface NodePracticeStats {
  /** 尝试过（有练习记录）的去重题数 */
  attempted: number
  /** 至少一次 AC 的去重题数 */
  acProblems: number
  /** 总练习记录数 */
  attempts: number
  /** AC 记录数 */
  acAttempts: number
  /** 记录级正确率 0..1 */
  acc: number | null
  /** 攻克难题数（CF rating≥1600 或洛谷难度≥5 的 AC） */
  hardSolved: number
  /** 最近练习距今天数（无则 null） */
  lastActiveDays: number | null
}

/**
 * 掌握度五档展示元数据（v1.8 修订：色相明显分离，避免「初学/基本掌握」难以分辨）。
 * 配色：灰(未开始) → 蓝(初学) → 紫(练习中) → 绿(基本掌握) → 金(熟练)
 * 由 tests/unit/mastery-tier-colors.test.ts 保证两两色相间距 ≥ 45°。
 */
export const MASTERY_TIER_ORDER: readonly MasteryTier[] = [
  'untouched',
  'newbie',
  'learning',
  'proficient',
  'master'
]

export const MASTERY_TIER_META: Record<MasteryTier, { label: string; color: string }> = {
  untouched: { label: '未开始', color: '#6c7086' }, // 灰
  newbie: { label: '初学', color: '#4f9cf9' }, // 蓝
  learning: { label: '练习中', color: '#b07cf5' }, // 紫
  proficient: { label: '基本掌握', color: '#3cb371' }, // 绿
  master: { label: '熟练', color: '#e6a23c' } // 金
}

export interface SkillNodeReport {
  id: string
  name: string
  layer: number
  tags: string[]
  dependsOn: string[]
  /** 中文简介（v1.7 FR-11，仅详情面板展示） */
  intro: string
  stats: NodePracticeStats
  tier: MasteryTier
  /** 依赖是否全部达标（proficient 及以上） */
  depsReady: boolean
}

export interface SkillReport {
  nodes: SkillNodeReport[]
  /** 推荐下一步：依赖已满足且自身未达标（proficient 以下），按 layer 升序 */
  recommendedIds: string[]
  /** 全部节点是否已达标/掌握 */
  allDone: boolean
}

/** 题库列表筛选条件 */
export interface ProblemFilter {
  page: number
  pageSize: number
  source?: 'all' | ProblemSource // v1.1 FR-8：数据源过滤，默认 'all'
  difficulty?: number | null // v1.1：洛谷难度筛选（洛谷视图）
  ratingMin?: number | null
  ratingMax?: number | null
  tags?: string[]
  /** v1.8：任意命中其一即可（OR 语义），用于「知识点」筛选（多选并集） */
  tagsAny?: string[]
  keyword?: string
  practiced?: 'all' | 'done' | 'undone'
  sortBy?: 'rating' | 'id' | 'solvedCount'
  sortDir?: 'asc' | 'desc'
}

export interface ProblemListResult {
  total: number
  items: Problem[]
}

export interface SyncResult {
  added: number
  updated: number
  fetchedAt: string
}

export interface SyncProgress {
  stage: 'fetching' | 'writing'
  percent: number
  message: string
}

export interface StatsResult {
  totalAttempts: number
  acCount: number
  accuracy: number | null
  distinctProblems: number
  practiceSeconds: number
  daily: { date: string; count: number; acCount: number }[]
  weekly: { week: string; count: number; acCount: number }[]
  tagStats: { tag: string; count: number; acCount: number }[]
}

/** 难度分档统计（v1.9 FR-22）：按题目难度标签聚合练习情况 */
export interface DifficultyBucket {
  /** 桶标识：'lt800' | '800' … | 'd3' | 'na' */
  key: string
  /** 展示名：'800–999' | '普及/提高-' | '中等' | '未标难度' */
  label: string
  /** 有练习记录的题数（去重） */
  attempted: number
  /** 其中曾 AC 的题数 */
  ac: number
  /** AC 率（%，保留 1 位；attempted=0 时为 null） */
  acRate: number | null
  /** 占该题源已练题数比例（0–100，保留 1 位） */
  share: number
}

/** 单题源的难度分布 */
export interface DifficultySourceStats {
  source: ProblemSource
  attempted: number
  ac: number
  buckets: DifficultyBucket[]
}

/** 难度分布统计结果（三个题源各一组） */
export interface DifficultyStatsResult {
  cf: DifficultySourceStats
  luogu: DifficultySourceStats
  leetcode: DifficultySourceStats
}

/** 题目入库输入（由 CF API / 洛谷页面 / 力扣接口映射而来） */
export interface ProblemUpsertInput {
  contestId: number // luogu / leetcode 行固定 0
  index: string // luogu 行 = pid；leetcode 行 = titleSlug
  name: string
  rating: number | null
  difficulty?: number | null // 洛谷 0-7 / 力扣 1-3，仅对应来源行
  solvedCount: number
  totalSubmit?: number
  source?: ProblemSource // 默认 'cf'
  /** 力扣题号（如 '1' / 'LCR 001' / '面试题 01.01'），用于生成可读 id：LC1 */
  frontendId?: string
  tags: string[]
}

/** 合法练习结果状态 */
export const RESULT_STATUSES: readonly ResultStatus[] = [
  'AC',
  'WA',
  'TLE',
  'RE',
  'MLE',
  'CE',
  'SKIP',
  'UNSOLVED'
]

/** 比赛列表项（轻量，不含 submissions） */
export interface ContestListItem {
  id: number
  name: string
  durationMinutes: number
  status: ContestStatus
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
  problemCount: number
  solvedCount: number
}

/** 题库列表查询行（含标签聚合） */
export interface ProblemRow {
  id: string
  contestId: number
  index: string
  name: string
  rating: number | null
  difficulty: number | null
  solvedCount: number
  totalSubmit: number
  source: ProblemSource
  cfUrl: string
  fetchedAt: string
  tags: string[]
  /** 扩展字段：是否已练习过 */
  practiced?: boolean
  /** 扩展字段：最近一次练习状态 */
  lastStatus?: ResultStatus | null
}

// ============ v2.0 本地测评（FR-12） ============

export type JudgeLanguage = 'cpp' | 'c' | 'python'

export type JudgeStatus = 'AC' | 'WA' | 'TLE' | 'MLE' | 'RE' | 'CE' | 'OLE' | 'IE'

export interface JudgeTestCase {
  input: string
  output: string
}

export interface JudgeTestResult {
  index: number
  verdict: JudgeStatus
  timeMs: number
  memoryKB: number
  message?: string
  /** WA 时附带：输入/期望/实际（截断） */
  input?: string
  expected?: string
  got?: string
  /** WA 时附带：前若干行差异 */
  diff?: string[]
}

export interface JudgeResult {
  status: JudgeStatus
  /** 全部测试点耗时合计（ms） */
  timeMs: number
  /** 峰值内存（KB，各测试点最大值） */
  memoryKB: number
  passed: number
  total: number
  tests: JudgeTestResult[]
  /** 编译输出（CE 时含编译器报错） */
  compileOutput: string
  /** 内存限制是否生效（辅助进程编译失败时降级为 false） */
  memLimitEnabled: boolean
  message: string
}

export interface SampleRunResult {
  status: JudgeStatus
  stdout: string
  stderr: string
  timeMs: number
  memoryKB: number
  message: string
}

export const JUDGE_LANGUAGES: readonly JudgeLanguage[] = ['cpp', 'c', 'python']

export const JUDGE_LANGUAGE_LABELS: Record<JudgeLanguage, string> = {
  cpp: 'C++17 (g++)',
  c: 'C11 (gcc)',
  python: 'Python 3'
}

export const JUDGE_STATUS_LABELS: Record<JudgeStatus, string> = {
  AC: '答案正确',
  WA: '答案错误',
  TLE: '超出时间限制',
  MLE: '超出内存限制',
  RE: '运行时错误',
  CE: '编译错误',
  OLE: '输出超限',
  IE: '判题机内部错误'
}

// ============ v1.10 题单 / 训练计划 / 间隔复习（FR-27~FR-29） ============

export type ListOrigin = 'manual' | 'paste' | 'generate'

export type ReviewEase = 'hard' | 'ok' | 'easy'

/** 间隔复习阶梯（天）：stage 1..6 */
export const REVIEW_INTERVALS: readonly number[] = [1, 3, 7, 14, 30, 60]

export const REVIEW_EASE_LABELS: Record<ReviewEase, string> = {
  hard: '困难（提前重来）',
  ok: '一般（正常推进）',
  easy: '轻松（跳一档）'
}

/** 题单条目（含复习状态） */
export interface ProblemListItem {
  id: number
  listId: number
  problemId: string
  position: number
  done: boolean
  doneAt: string | null
  note: string
  /** 0 = 未进入复习；1..6 = 阶梯档位 */
  reviewStage: number
  reviewDue: string | null
  reviewLastAt: string | null
  reviewEase: ReviewEase | null
}

/** 题单（含聚合进度） */
export interface ProblemList {
  id: number
  name: string
  description: string
  origin: ListOrigin
  trackId: string | null
  createdAt: string
  updatedAt: string
  total: number
  doneCount: number
  /** 已进入复习的条目数 */
  reviewCount: number
  /** 今日及以前到期的复习数 */
  dueCount: number
}

export interface ProblemListDetailItem extends ProblemListItem {
  problem: ProblemRow | null
}

export interface ProblemListDetail {
  list: ProblemList
  items: ProblemListDetailItem[]
}

/** 今日待复习条目（跨题单汇总） */
export interface ReviewEntry extends ProblemListItem {
  listName: string
  problem: ProblemRow | null
}

export interface DueReviewResult {
  today: string
  items: ReviewEntry[]
}

/** 按知识点 + 难度生成题单 */
export interface GenerateListInput {
  name: string
  knowledgeIds: string[]
  count: number
  source?: 'all' | ProblemSource
  ratingMin?: number | null
  ratingMax?: number | null
  difficultyMin?: number | null
  difficultyMax?: number | null
  excludePracticed?: boolean
  trackId?: string | null
}

export interface GenerateListResult {
  listId: number
  picked: number
  candidates: number
}

/** 粘贴题号文本识别结果 */
export interface ParseIdsResult {
  matchedIds: string[]
  /** 本地题库中找不到的题号（原样回显，最多 50 条） */
  missing: string[]
  total: number
}

// ---- 训练计划 ----

export type PlanTaskStatus = 'pending' | 'done' | 'skipped'

export interface PlanTask {
  id: number
  planId: number
  problemId: string
  /** 'YYYY-MM-DD' */
  dueDate: string
  status: PlanTaskStatus
  doneAt: string | null
}

export interface PlanTaskRow extends PlanTask {
  problem: ProblemRow | null
}

export interface PlanDayGroup {
  date: string
  tasks: PlanTaskRow[]
  busy: boolean
  reason: string
}

export interface TrainingPlan {
  id: number
  name: string
  listId: number | null
  targetDate: string | null
  dailyTarget: number
  ratingMin: number | null
  ratingMax: number | null
  knowledgeIds: string[]
  /** 0=周日 … 6=周六 */
  restWeekdays: number[]
  trackId: string | null
  createdAt: string
  updatedAt: string
  total: number
  doneCount: number
  busyDays: { date: string; reason: string }[]
}

export interface TrainingPlanDetail {
  plan: TrainingPlan
  days: PlanDayGroup[]
}

export interface CreatePlanInput {
  name: string
  /** 用题单的题目排期 */
  listId?: number | null
  /** 或直接给题目 id */
  problemIds?: string[]
  /** 都没给时：按知识点 + 难度自动抽题 */
  generateCount?: number
  targetDate?: string | null
  dailyTarget?: number
  ratingMin?: number | null
  ratingMax?: number | null
  knowledgeIds?: string[]
  restWeekdays?: number[]
  trackId?: string | null
  excludePracticed?: boolean
}

export interface SchedulePlanResult {
  planId: number
  scheduled: number
  lastDate: string | null
  /** 超出目标日期而未被排入的题数 */
  overflow: number
}
