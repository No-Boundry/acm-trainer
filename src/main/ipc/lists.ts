import { IpcChannels } from '@shared/channels'
import type {
  DueReviewResult,
  GenerateListInput,
  GenerateListResult,
  ListOrigin,
  ParseIdsResult,
  ProblemList,
  ProblemListDetail,
  ProblemListItem,
  ReviewEase
} from '@shared/types'
import type { Repos } from '../services'
import { AppError } from '../db/errors'
import { nextReview } from '../services/review'
import { parseCandidatesFromText, pickProblemsForList, resolveCandidates } from '../services/problem-list'
import { SKILL_NODE_MAP } from '@shared/skill-tree'
import { handle } from './helpers'

/** v1.10：题单 + 题单内间隔复习（FR-27 / FR-29） */
export function registerListsIpc(repos: Repos): void {
  handle<unknown, ProblemList[]>(IpcChannels.ListsList, () => repos.lists.list())

  handle<{ id: number }, ProblemListDetail>(IpcChannels.ListsGet, ({ id }) =>
    repos.lists.detail(id, repos.problems)
  )

  handle<{ name: string; description?: string; origin?: ListOrigin; trackId?: string | null }, ProblemList>(
    IpcChannels.ListsCreate,
    (req) => repos.lists.create(req)
  )

  handle<{ id: number; name?: string; description?: string; trackId?: string | null }, ProblemList>(
    IpcChannels.ListsUpdate,
    ({ id, ...fields }) => repos.lists.update(id, fields)
  )

  handle<{ id: number }, void>(IpcChannels.ListsDelete, ({ id }) => repos.lists.delete(id))

  handle<{ listId: number; problemIds: string[] }, { added: number }>(
    IpcChannels.ListsAddProblems,
    ({ listId, problemIds }) => ({ added: repos.lists.addProblems(listId, problemIds ?? []) })
  )

  handle<{ listId: number; problemId: string }, void>(IpcChannels.ListsRemoveItem, (req) =>
    repos.lists.removeItem(req.listId, req.problemId)
  )

  handle<{ listId: number; problemId: string; done: boolean }, ProblemListItem>(
    IpcChannels.ListsSetDone,
    (req) => repos.lists.setDone(req.listId, req.problemId, req.done)
  )

  handle<{ listId: number; problemId: string; note: string }, ProblemListItem>(
    IpcChannels.ListsSetNote,
    (req) => repos.lists.setNote(req.listId, req.problemId, req.note)
  )

  /** 粘贴文本 → 识别题号（不落库，返回命中/未命中，供确认后创建） */
  handle<{ text: string }, ParseIdsResult>(IpcChannels.ListsParseText, ({ text }) => {
    const candidates = parseCandidatesFromText(text ?? '')
    const { matchedIds, missing } = resolveCandidates(repos.problems, candidates)
    return { matchedIds, missing, total: matchedIds.length }
  })

  /** 按知识点 + 难度生成题单 */
  handle<GenerateListInput, GenerateListResult>(IpcChannels.ListsGenerate, (req) => {
    const nodeIds = req.knowledgeIds ?? []
    const tags = new Set<string>()
    for (const id of nodeIds) {
      const node = SKILL_NODE_MAP.get(id)
      if (node) for (const t of node.tags) tags.add(t)
    }
    if (tags.size === 0) {
      throw new AppError('VALIDATION', '请至少选择一个有关联标签的知识点')
    }
    const count = Math.min(100, Math.max(1, Math.floor(req.count || 10)))
    const { ids, candidates } = pickProblemsForList(repos.problems, {
      knowledgeTags: [...tags],
      count,
      source: req.source ?? 'all',
      ratingMin: req.ratingMin ?? null,
      ratingMax: req.ratingMax ?? null,
      difficultyMin: req.difficultyMin ?? null,
      difficultyMax: req.difficultyMax ?? null,
      excludePracticed: req.excludePracticed ?? false
    })
    if (ids.length === 0) {
      throw new AppError('VALIDATION', '当前条件下没有可加入的题目（可放宽难度区间或取消「排除已练」）')
    }
    const list = repos.lists.create({
      name: req.name?.trim() || `知识点题单 ${new Date().toLocaleDateString()}`,
      description: `按知识点生成：${nodeIds.length} 个节点 · 难度筛选 · 共 ${ids.length} 题`,
      origin: 'generate',
      trackId: req.trackId ?? null
    })
    repos.lists.addProblems(list.id, ids)
    const created = repos.lists.getById(list.id)
    return { listId: list.id, picked: created?.total ?? ids.length, candidates }
  })

  /** 复习反馈：困难 / 一般 / 轻松 → 调整下一次复习日期 */
  handle<{ listId: number; problemId: string; ease: ReviewEase }, ProblemListItem>(
    IpcChannels.ListsReview,
    ({ listId, problemId, ease }) => {
      if (ease !== 'hard' && ease !== 'ok' && ease !== 'easy') {
        throw new AppError('VALIDATION', '复习反馈只能是 hard / ok / easy')
      }
      const item = repos.lists.getItem(listId, problemId)
      if (!item) throw new AppError('NOT_FOUND', '题单中没有这道题')
      const { stage, due } = nextReview(item.reviewStage, ease)
      return repos.lists.applyReview(listId, problemId, stage, due, ease)
    }
  )

  /** 今日待复习（跨题单汇总） */
  handle<unknown, DueReviewResult>(IpcChannels.ListsDueReviews, () => ({
    today: new Date().toISOString().slice(0, 10),
    items: repos.lists.dueReviews(repos.problems)
  }))
}
