import { IpcChannels } from '@shared/channels'
import type { Contest, ContestListItem, ContestResult, ResultStatus } from '@shared/types'
import type { Repos } from '../services'
import { AppError } from '../db/errors'
import { handle } from './helpers'
import {
  finishContest,
  enrichContest,
  generateProblemSelection,
  buildContestResult
} from '../services/contest'

interface CreateContestReq {
  name: string
  durationMinutes: number
  problemIds: string[]
}

interface GenerateReq {
  count: 3 | 5 | 7 | 10
  ratingMin?: number | null
  ratingMax?: number | null
  tags?: string[]
  excludeIds?: string[]
}

interface SubmitReq {
  contestId: number
  problemId: string
  status: ResultStatus
}

export function registerContestsIpc(repos: Repos): void {
  handle<CreateContestReq, Contest>(IpcChannels.ContestsCreate, (req) =>
    enrichContest(repos, repos.contests.createContest(req))
  )

  handle<GenerateReq, string[]>(IpcChannels.ContestsGenerate, (req) =>
    generateProblemSelection(repos.problems, req)
  )

  handle<{ id: number }, Contest>(IpcChannels.ContestsStart, ({ id }) =>
    enrichContest(repos, repos.contests.start(id))
  )

  handle<SubmitReq, Contest>(IpcChannels.ContestsSubmit, (req) =>
    enrichContest(repos, repos.contests.submit(req.contestId, req.problemId, req.status))
  )

  handle<{ id: number }, ContestResult>(IpcChannels.ContestsFinish, async ({ id }) =>
    finishContest(repos, id)
  )

  handle<{ id: number }, ContestResult>(IpcChannels.ContestsResult, async ({ id }) =>
    buildContestResult(repos, id)
  )

  handle<unknown, ContestListItem[]>(IpcChannels.ContestsList, () => repos.contests.list())

  handle<{ id: number }, Contest>(IpcChannels.ContestsGet, ({ id }) => {
    const c = repos.contests.getById(id)
    if (!c) throw new AppError('NOT_FOUND', '比赛不存在')
    return enrichContest(repos, c)
  })

  handle<{ id: number }, { ok: boolean }>(IpcChannels.ContestsDelete, ({ id }) => {
    repos.contests.deleteContest(id)
    return { ok: true }
  })
}
