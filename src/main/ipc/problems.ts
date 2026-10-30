import { IpcChannels } from '@shared/channels'
import type { IpcMainInvokeEvent } from 'electron'
import type {
  ProblemFilter,
  ProblemListResult,
  ProblemSource,
  SyncResult,
  SyncProgress,
  TagUsage
} from '@shared/types'
import type { Repos } from '../services'
import { practicedTags } from '../services/recommend-service'
import { handle, pushEvent } from './helpers'

export function registerProblemsIpc(repos: Repos): void {
  handle<unknown, ProblemListResult>(IpcChannels.ProblemsList, (req) => {
    return repos.problems.list(req as ProblemFilter)
  })

  handle<{ id: string }, ReturnType<Repos['problems']['getById']>>(
    IpcChannels.ProblemsGet,
    ({ id }) => repos.problems.getById(id)
  )

  handle<unknown, SyncResult>(IpcChannels.ProblemsSync, async (_req, event: IpcMainInvokeEvent) => {
    const { syncProblemset } = await import('../services/cf')
    return syncProblemset(repos.problems, (p: SyncProgress) => {
      pushEvent(event, IpcChannels.ProblemsSyncProgress, p)
    })
  })

  handle<unknown, Record<ProblemSource, string | null>>(IpcChannels.ProblemsLastSync, () =>
    repos.problems.lastSync()
  )

  handle<unknown, string[]>(IpcChannels.ProblemsTags, () => repos.problems.allTags())

  // v1.14 FR-32：标签使用情况（已练习 / 已 AC / 最近练习），供技能树与题库「显示已练习标签」
  handle<{ knowledgeIds?: string[] } | undefined, TagUsage[]>(
    IpcChannels.StatsTagUsage,
    (req) => practicedTags(repos, [...(req?.knowledgeIds ?? [])])
  )
}
