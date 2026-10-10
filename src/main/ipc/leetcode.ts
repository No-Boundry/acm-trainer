import { net, type IpcMainInvokeEvent } from 'electron'
import { IpcChannels } from '@shared/channels'
import type { SyncProgress } from '@shared/types'
import type { Repos } from '../services'
import { AppError } from '../db/errors'
import {
  buildTagPageQuery,
  syncLeetcodeProblemset,
  LEETCODE_GRAPHQL_URL,
  LEETCODE_LIST_URL,
  type LeetcodeFetchers
} from '../services/leetcode'
import { handle, pushEvent } from './helpers'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

/**
 * 力扣抓取：Electron net（Chromium 网络栈，无需登录态）。
 * 两个接口都不是稳定公开 API，故统一做一次重试 + 明确的中文错误提示。
 */
async function fetchText(url: string, init?: RequestInit): Promise<string> {
  let lastErr: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await net.fetch(url, {
        ...init,
        headers: { 'User-Agent': UA, Accept: 'application/json', Referer: 'https://leetcode.cn/problemset/', ...(init?.headers ?? {}) }
      })
      if (!resp.ok) throw new AppError('LEETCODE_FETCH_FAILED', `力扣请求失败 HTTP ${resp.status}`)
      return await resp.text()
    } catch (e) {
      lastErr = e
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1200))
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr)
  throw new AppError(
    'LEETCODE_FETCH_FAILED',
    `拉取力扣数据失败: ${msg}（leetcode.cn 需要可访问的网络；若使用了代理，请确认代理对应用生效）`
  )
}

function buildFetchers(): LeetcodeFetchers {
  return {
    fetchList: () => fetchText(LEETCODE_LIST_URL),
    fetchTagPage: (skip: number, limit: number) =>
      fetchText(LEETCODE_GRAPHQL_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operationName: 'problemsetQuestionList',
          variables: { categorySlug: 'algorithms', limit, skip, filters: {} },
          query: buildTagPageQuery(skip, limit)
        })
      })
  }
}

export function registerLeetcodeIpc(repos: Repos): void {
  handle<
    unknown,
    {
      added: number
      updated: number
      fetchedAt: string
      totalPages: number
      total: number
      paidCount: number
    }
  >(IpcChannels.LeetcodeSync, async (_req, event: IpcMainInvokeEvent) => {
    return syncLeetcodeProblemset(
      repos.problems,
      (p: SyncProgress) => {
        pushEvent(event, IpcChannels.ProblemsSyncProgress, p)
      },
      buildFetchers()
    )
  })
}
