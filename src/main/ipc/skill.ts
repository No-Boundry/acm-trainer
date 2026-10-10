import { IpcChannels } from '@shared/channels'
import type { SkillReport } from '@shared/types'
import type { Repos } from '../services'
import { SKILL_TRACKS, trackNodeIds, trackProgress, type TrackProgress } from '@shared/skill-tracks'
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
}
