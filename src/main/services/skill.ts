import type { Repos } from './index'
import type { ResultStatus } from '@shared/types'
import type { MasteryTier, NodePracticeStats, SkillNodeReport, SkillReport } from '@shared/types'
import { SKILL_NODES } from '@shared/skill-tree'
import { canonicalTags } from '@shared/tag-map'

/**
 * 技能树统计与学习路径（v1.6 FR-9.2/9.3）。
 * 纯函数（classifyTier / nodeAvailability）可单测；buildSkillReport 读取练习记录聚合。
 * 类型定义见 src/shared/types.ts（与渲染进程共享）。
 */

/** 五档掌握度（docs/03 §12.2；阈值可调） */
export function classifyTier(s: NodePracticeStats): MasteryTier {
  const base = aggregateTier(s)
  // v1.21.1 广度门槛（FR-45）：节点把多个标签的知识点并在一起，只刷其中一个标签
  // 不足以判定整个知识点掌握。分母只用「本地题库里有题」的标签（tagTotal），
  // 避免把永远练不到的标签算进来；总标签数 ≤1 时不做广度约束（单标签节点保持原口径）。
  const total = s.tagTotal
  if (total <= 1) return base
  const covered = s.coveredTags
  const needProficient = Math.ceil(total * 0.6)
  const needMaster = Math.ceil(total * 0.8)
  const breadthCap: MasteryTier =
    covered >= needMaster
      ? 'master'
      : covered >= needProficient
        ? 'proficient'
        : covered >= 1
          ? 'learning'
          : 'newbie'
  return MASTERY_RANK[base] <= MASTERY_RANK[breadthCap] ? base : breadthCap
}

/** 聚合阈值：只看题数 / 正确率 / 难题，不看广度（v1.21.1 抽出，便于单测） */
export function aggregateTier(s: NodePracticeStats): MasteryTier {
  if (s.attempted === 0) return 'untouched'
  if (s.acProblems < 3) return 'newbie'
  const acc = s.acc ?? 0
  if (s.acProblems < 8 || acc < 0.45) return 'learning'
  const hardOk = s.hardSolved >= 1
  if ((s.acProblems >= 15 && acc >= 0.7 && hardOk) || (s.acProblems >= 25 && acc >= 0.6)) {
    return 'master'
  }
  return 'proficient'
}

const MASTERY_RANK: Record<MasteryTier, number> = {
  untouched: 0,
  newbie: 1,
  learning: 2,
  proficient: 3,
  master: 4
}

/** 依赖满足判定：全部前置 tier ≥ proficient */
export function nodeAvailability(depTiers: MasteryTier[]): boolean {
  const ok: MasteryTier[] = ['proficient', 'master']
  return depTiers.every((t) => ok.includes(t))
}

const DAY_MS = 24 * 60 * 60 * 1000
const PROGRESSIVE: MasteryTier[] = ['untouched', 'newbie', 'learning', 'proficient', 'master']

interface ProblemMeta {
  tags: string[]
  source: string
  rating: number | null
  difficulty: number | null
}

function emptyStats(): NodePracticeStats {
  return {
    attempted: 0,
    acProblems: 0,
    attempts: 0,
    acAttempts: 0,
    acc: null,
    hardSolved: 0,
    lastActiveDays: null,
    tagTotal: 0,
    coveredTags: 0
  }
}

/** 聚合单个节点的统计（记录级） */
function aggregateNode(
  records: { status: ResultStatus; createdAt: string; problemId: string }[],
  metaOf: (pid: string) => ProblemMeta
): NodePracticeStats {
  const problems = new Map<string, { ac: boolean; hard: boolean }>()
  let acAttempts = 0
  let lastTs = 0
  for (const rec of records) {
    const cur = problems.get(rec.problemId) ?? { ac: false, hard: false }
    if (rec.status === 'AC') {
      cur.ac = true
      acAttempts += 1
      const m = metaOf(rec.problemId)
      if (
        (m.source === 'cf' && (m.rating ?? 0) >= 1600) ||
        (m.source === 'luogu' && (m.difficulty ?? 0) >= 5) ||
        // v1.9：力扣「困难」计入难题
        (m.source === 'leetcode' && (m.difficulty ?? 0) >= 3)
      ) {
        cur.hard = true
      }
    }
    const ts = new Date(rec.createdAt.replace(' ', 'T')).getTime()
    if (ts > lastTs) lastTs = ts
    problems.set(rec.problemId, cur)
  }
  const vals = [...problems.values()]
  const stats = emptyStats()
  stats.attempted = problems.size
  stats.acProblems = vals.filter((p) => p.ac).length
  stats.attempts = records.length
  stats.acAttempts = acAttempts
  stats.acc = records.length > 0 ? acAttempts / records.length : null
  stats.hardSolved = vals.filter((p) => p.hard && p.ac).length
  stats.lastActiveDays = lastTs > 0 ? Math.floor((Date.now() - lastTs) / DAY_MS) : null
  return stats
}

/** 构建完整技能报告（FR-9.2/9.3） */
export function buildSkillReport(repos: Repos): SkillReport {
  // v1.14.1：改用 records.all()——原先 list({pageSize:1e5}) 被 200 钳制，超过 200 条记录后
  // 掌握度会静默算少。这里必须取全量。
  const records = repos.records.all()

  const problemCache = new Map<string, ProblemMeta>()
  const metaOf = (pid: string): ProblemMeta => {
    let m = problemCache.get(pid)
    if (!m) {
      const p = repos.problems.getById(pid)
      m = p
        ? { tags: p.tags, source: p.source, rating: p.rating, difficulty: p.difficulty }
        : { tags: [], source: 'cf', rating: null, difficulty: null }
      problemCache.set(pid, m)
    }
    return m
  }

  // 节点 → 归属记录（题目标签命中节点任一关联标签；多标签题可计入多个节点）
  // v1.18 FR-38：两侧都先 canonical 化（节点写的是 'dsu'/'贪心' 混排，
  // 库里标签已物化为中文 canonical），否则英文节点标签会匹配不到中文题标签。
  const nodeRecords = new Map<string, { status: ResultStatus; createdAt: string; problemId: string }[]>()
  const nodeTagSet = new Map<string, Set<string>>()
  // v1.21.1：节点内「每个标签各自 AC 过的题」——掌握广度（覆盖率）的分子
  const nodeTagAc = new Map<string, Map<string, Set<string>>>()
  // v1.21.1：本地题库里有题的标签集合——广度分母只算「练得到」的标签
  const availableTags = new Set(repos.problems.tagTotals().keys())
  for (const n of SKILL_NODES) {
    nodeRecords.set(n.id, [])
    nodeTagSet.set(n.id, new Set(canonicalTags(n.tags).map((t) => t.toLowerCase())))
    nodeTagAc.set(n.id, new Map())
  }
  for (const r of records) {
    const lowerTags = canonicalTags(metaOf(r.problemId).tags).map((t) => t.toLowerCase())
    if (lowerTags.length === 0) continue
    for (const n of SKILL_NODES) {
      const nodeTags = nodeTagSet.get(n.id)!
      const hitTags = lowerTags.filter((t) => nodeTags.has(t))
      if (hitTags.length === 0) continue
      nodeRecords.get(n.id)!.push({ status: r.status, createdAt: r.createdAt, problemId: r.problemId })
      if (r.status === 'AC') {
        const acMap = nodeTagAc.get(n.id)!
        for (const t of hitTags) {
          const set = acMap.get(t) ?? new Set<string>()
          set.add(r.problemId)
          acMap.set(t, set)
        }
      }
    }
  }

  // 全节点统计
  const statsById = new Map<string, NodePracticeStats>()
  for (const n of SKILL_NODES) {
    const stats = aggregateNode(nodeRecords.get(n.id)!, metaOf)
    // v1.21.1 广度：分母 = 节点标签 ∩ 本地题库有题；分子 = 其中已有 AC 的标签数
    const availableNodeTags = [...nodeTagSet.get(n.id)!].filter((t) => availableTags.has(t))
    const acMap = nodeTagAc.get(n.id)!
    stats.tagTotal = availableNodeTags.length
    stats.coveredTags = availableNodeTags.filter((t) => acMap.has(t)).length
    statsById.set(n.id, stats)
  }

  const tierOf = (id: string): MasteryTier => classifyTier(statsById.get(id) ?? emptyStats())

  const nodes: SkillNodeReport[] = SKILL_NODES.map((n) => {
    const depsReady = nodeAvailability(n.dependsOn.map(tierOf))
    return {
      id: n.id,
      name: n.name,
      layer: n.layer,
      tags: canonicalTags(n.tags),
      dependsOn: n.dependsOn,
      intro: n.intro, // v1.7 FR-11：内置简介随报告下发
      stats: statsById.get(n.id)!,
      tier: tierOf(n.id),
      depsReady
    }
  })

  const recommendedIds = nodes
    .filter((n) => n.depsReady && !['proficient', 'master'].includes(n.tier))
    .sort((a, b) => a.layer - b.layer || PROGRESSIVE.indexOf(a.tier) - PROGRESSIVE.indexOf(b.tier))
    .map((n) => n.id)

  return {
    nodes,
    recommendedIds,
    allDone: nodes.length > 0 && nodes.every((n) => ['proficient', 'master'].includes(n.tier))
  }
}
