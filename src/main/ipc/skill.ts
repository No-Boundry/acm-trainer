import { IpcChannels } from '@shared/channels'
import type { ListKnowledgeCoverage, SkillReport } from '@shared/types'
import type { Repos } from '../services'
import { SKILL_TRACKS, trackNodeIds, trackProgress, type TrackProgress } from '@shared/skill-tracks'
import { coveredNodeIds } from '@shared/skill-tree'
import { canonicalTags } from '@shared/tag-map'
import { handle } from './helpers'

/** v1.10 FR-26：技能报告附带国内比赛赛道的进度（供技能树页切换赛道） */
export interface SkillReportWithTracks extends SkillReport {
  tracks: { id: string; progress: TrackProgress; nodeIds: string[] }[]
}

export function registerSkillIpc(repos: Repos): void {
  handle<unknown, SkillReportWithTracks>(IpcChannels.SkillGet, async () => {
    const { buildSkillReport } = await import('../services/skill')
    const report = buildSkillReport(repos)
    const nodes = report.nodes.map((n) => ({
      id: n.id,
      layer: n.layer,
      tier: n.tier,
      depsReady: n.depsReady
    }))
    return {
      ...report,
      tracks: SKILL_TRACKS.map((t) => ({
        id: t.id,
        progress: trackProgress(t, nodes),
        nodeIds: [...trackNodeIds(t)]
      }))
    }
  })

  /**
   * v1.21 FR-44：题单覆盖的知识点。
   * 学习路径页「仅显示题单知识点」用它把题单里的题（按标签并集、tag-map 归一）映射回技能树节点。
   */
  handle<{ listId: number }, ListKnowledgeCoverage>(IpcChannels.SkillListCoverage, ({ listId }) => {
    const detail = repos.lists.detail(Number(listId), repos.problems)
    const rawTags = new Set<string>()
    for (const it of detail.items) {
      if (!it.problem) continue
      for (const t of it.problem.tags) rawTags.add(t)
    }
    const tags = canonicalTags([...rawTags])
    return {
      listId: detail.list.id,
      listName: detail.list.name,
      problemCount: detail.items.length,
      nodeIds: coveredNodeIds(tags),
      tags: [...new Set(tags)].sort()
    }
  })
}
