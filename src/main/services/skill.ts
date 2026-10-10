import type { Repos } from './index'
import type { ResultStatus } from '@shared/types'
import type { MasteryTier, NodePracticeStats, SkillNodeReport, SkillReport } from '@shared/types'
import { SKILL_NODES } from '@shared/skill-tree'

/**
 * 技能树统计与学习路径（v1.6 FR-9.2/9.3）。
 * 纯函数（classifyTier / nodeAvailability）可单测；buildSkillReport 读取练习记录聚合。
 * 类型定义见 src/shared/types.ts（与渲染进程共享）。
 */

/** 五档掌握度（docs/03 §12.2；阈值可调） */
export function classifyTier(s: NodePracticeStats): MasteryTier {
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
  return { attempted: 0, acProblems: 0, attempts: 0, acAttempts: 0, acc: null, hardSolved: 0, lastActiveDays: null }
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
  const { items: records } = repos.records.list({ page: 1, pageSize: 100000 })

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
  const nodeRecords = new Map<string, { status: ResultStatus; createdAt: string; problemId: string }[]>()
  const nodeTagSet = new Map<string, Set<string>>()
  for (const n of SKILL_NODES) {
    nodeRecords.set(n.id, [])
    nodeTagSet.set(n.id, new Set(n.tags.map((t) => t.toLowerCase())))
  }
  for (const r of records) {
    const lowerTags = metaOf(r.problemId).tags.map((t) => t.toLowerCase())
    if (lowerTags.length === 0) continue
    for (const n of SKILL_NODES) {
      if (lowerTags.some((t) => nodeTagSet.get(n.id)!.has(t))) {
        nodeRecords.get(n.id)!.push({ status: r.status, createdAt: r.createdAt, problemId: r.problemId })
      }
    }
  }

  // 全节点统计
  const statsById = new Map<string, NodePracticeStats>()
  for (const n of SKILL_NODES) {
    statsById.set(n.id, aggregateNode(nodeRecords.get(n.id)!, metaOf))
  }

  const tierOf = (id: string): MasteryTier => classifyTier(statsById.get(id) ?? emptyStats())

  const nodes: SkillNodeReport[] = SKILL_NODES.map((n) => {
    const depsReady = nodeAvailability(n.dependsOn.map(tierOf))
    return {
      id: n.id,
      name: n.name,
      layer: n.layer,
      tags: n.tags,
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
