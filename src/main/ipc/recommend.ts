import { IpcChannels } from '@shared/channels'
import type { RecommendInput, RecommendResult } from '@shared/types'
import type { Repos } from '../services'
import { recommendProblems } from '../services/recommend-service'
import { handle } from './helpers'

/**
 * 首页推荐习题（v1.14 FR-31~FR-33）。纯读接口。
 * 「已练习标签」走 problems 域的 StatsTagUsage（与题库共用取数）。
 */
export function registerRecommendIpc(repos: Repos): void {
  handle<RecommendInput | undefined, RecommendResult>(IpcChannels.RecommendGet, (req) => {
    // Vue Proxy 过 IPC 会失败 → 只取原始字段并转纯数组
    const input: RecommendInput = req
      ? {
          practicedLimit: req.practicedLimit,
          freshLimit: req.freshLimit,
          practicedOrder: req.practicedOrder,
          freshOrder: req.freshOrder,
          knowledgeIds: [...(req.knowledgeIds ?? [])],
          filterTags: [...(req.filterTags ?? [])],
          ratingMax: req.ratingMax ?? null,
          source: req.source ?? 'all'
        }
      : {}
    return recommendProblems(repos, input)
  })
}
