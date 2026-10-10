import axios from 'axios'
import type { SyncProgress, SyncResult, ProblemUpsertInput } from '@shared/types'
import type { ProblemsRepo } from '../db/repositories/problems'
import { AppError } from '../db/errors'

/**
 * Codeforces API 对接（docs/03-详细设计 §4.1）。
 * 仅主进程使用；失败返回 CF_FETCH_FAILED，不影响本地缓存。
 */

export const CF_API_BASE = 'https://codeforces.com/api'
const REQUEST_TIMEOUT_MS = 60_000
const RETRY_DELAY_MS = 1_000

interface CfProblem {
  contestId: number
  index: string
  name: string
  type: string
  rating?: number
  tags: string[]
}

interface CfStatistics {
  contestId: number
  index: string
  solvedCount: number
}

interface CfProblemsetResult {
  problems: CfProblem[]
  problemStatistics: CfStatistics[]
}

interface CfApiResponse {
  status: string
  result: CfProblemsetResult
}

async function fetchProblemsetOnce(): Promise<CfProblemsetResult> {
  const resp = await axios.get<CfApiResponse>(`${CF_API_BASE}/problemset.problems`, {
    timeout: REQUEST_TIMEOUT_MS,
    headers: { 'User-Agent': 'ACM-Trainer/0.1 (local desktop app)' }
  })
  if (resp.data?.status !== 'OK' || !resp.data?.result) {
    throw new AppError('CF_FETCH_FAILED', `Codeforces API 返回异常状态: ${resp.data?.status ?? '未知'}`)
  }
  return resp.data.result
}

async function fetchProblemsetWithRetry(): Promise<CfProblemsetResult> {
  try {
    return await fetchProblemsetOnce()
  } catch (err) {
    // 重试一次（指数退避 1s）
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
    try {
      return await fetchProblemsetOnce()
    } catch (retryErr) {
      const msg = retryErr instanceof Error ? retryErr.message : String(retryErr)
      throw new AppError('CF_FETCH_FAILED', `拉取 Codeforces 题库失败: ${msg}`)
    }
  }
}

/** 字段映射 + 过滤（仅收录编程题，合并统计信息） */
export function mapToUpsert(result: CfProblemsetResult): ProblemUpsertInput[] {
  const statsMap = new Map<string, number>()
  for (const s of result.problemStatistics) {
    statsMap.set(`${s.contestId}:${s.index}`, s.solvedCount)
  }
  const inputs: ProblemUpsertInput[] = []
  for (const p of result.problems) {
    if (p.type !== 'PROGRAMMING') continue
    inputs.push({
      contestId: p.contestId,
      index: p.index,
      name: p.name,
      rating: p.rating ?? null,
      difficulty: null, // cf 行无洛谷难度
      solvedCount: statsMap.get(`${p.contestId}:${p.index}`) ?? 0,
      tags: p.tags
    })
  }
  return inputs
}

/** 本地时间格式（与 SQLite created_at 一致：YYYY-MM-DD HH:MM:SS） */
export function formatLocalSqlite(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/**
 * 执行一次完整同步：拉取 → 映射 → 事务 upsert → 进度回调。
 */
export async function syncProblemset(
  problemsRepo: ProblemsRepo,
  onProgress: (p: SyncProgress) => void
): Promise<SyncResult> {
  onProgress({ stage: 'fetching', percent: 0, message: '正在从 Codeforces 拉取题库…' })
  const result = await fetchProblemsetWithRetry()
  const inputs = mapToUpsert(result)
  onProgress({
    stage: 'writing',
    percent: 40,
    message: `拉取完成（${inputs.length} 道编程题），正在写入本地库…`
  })
  const fetchedAt = formatLocalSqlite(new Date())
  const { added, updated } = problemsRepo.upsertMany(inputs, fetchedAt)
  onProgress({ stage: 'writing', percent: 100, message: '同步完成' })
  return { added, updated, fetchedAt }
}
