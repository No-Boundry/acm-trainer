import { IpcChannels } from '@shared/channels'
import type { DifficultyStatsResult, PracticeRecord, StatsResult } from '@shared/types'
import type { Repos } from '../services'
import type { CreateRecordInput } from '../db/repositories/records'
import { handle } from './helpers'

interface RecordsListReq {
  problemId?: string
  mistakeOnly?: boolean
  page?: number
  pageSize?: number
}

export function registerRecordsIpc(repos: Repos): void {
  handle<CreateRecordInput, PracticeRecord>(IpcChannels.RecordsCreate, (req) =>
    repos.records.create(req)
  )

  handle<RecordsListReq, { total: number; items: PracticeRecord[] }>(
    IpcChannels.RecordsList,
    (req) => repos.records.list(req ?? {})
  )

  handle<{ id: number; status?: string; note?: string | null; isMistake?: boolean }, PracticeRecord>(
    IpcChannels.RecordsUpdate,
    ({ id, status, note, isMistake }) =>
      repos.records.update(id, {
        status: status as never,
        note,
        isMistake
      })
  )

  handle<{ id: number }, void>(IpcChannels.RecordsDelete, ({ id }) => repos.records.delete(id))

  handle<{ days?: number }, StatsResult>(IpcChannels.RecordsStats, (req) =>
    repos.records.stats(req?.days ?? 30)
  )

  // v1.9 FR-22：按题目难度标签统计（CF rating 分段 / 洛谷 0-7 / 力扣 1-3）
  handle<unknown, DifficultyStatsResult>(IpcChannels.StatsDifficulty, () =>
    repos.records.difficultyStats()
  )
}
