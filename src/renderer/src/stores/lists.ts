import { defineStore } from 'pinia'
import { invoke } from '@/api/ipc'
import { IpcChannels } from '@shared/channels'
import type {
  CreatePlanInput,
  GenerateListInput,
  GenerateListResult,
  ParseIdsResult,
  ProblemList,
  ProblemListDetail,
  ProblemListItem,
  ReviewEase,
  ReviewEntry,
  TrainingPlan,
  TrainingPlanDetail
} from '@shared/types'

interface ListsState {
  lists: ProblemList[]
  current: ProblemListDetail | null
  due: ReviewEntry[]
  /** 今日日期（用于到期判断展示） */
  today: string
  plans: TrainingPlan[]
  currentPlan: TrainingPlanDetail | null
  loading: boolean
}

/** v1.10：题单 + 题单内复习 + 训练计划（FR-27~FR-29） */
export const useListsStore = defineStore('lists', {
  state: (): ListsState => ({
    lists: [],
    current: null,
    due: [],
    today: '',
    plans: [],
    currentPlan: null,
    loading: false
  }),
  actions: {
    async loadLists(): Promise<void> {
      this.lists = await invoke<ProblemList[]>(IpcChannels.ListsList)
    },
    async openList(id: number | null): Promise<void> {
      if (id == null) {
        this.current = null
        return
      }
      this.current = await invoke<ProblemListDetail>(IpcChannels.ListsGet, { id })
    },
    async createList(name: string, description = '', trackId: string | null = null): Promise<ProblemList> {
      const list = await invoke<ProblemList>(IpcChannels.ListsCreate, { name, description, origin: 'manual', trackId })
      await this.loadLists()
      await this.openList(list.id)
      return list
    },
    async renameList(id: number, name: string): Promise<void> {
      await invoke(IpcChannels.ListsUpdate, { id, name })
      await this.loadLists()
      if (this.current?.list.id === id) await this.openList(id)
    },
    async deleteList(id: number): Promise<void> {
      await invoke(IpcChannels.ListsDelete, { id })
      if (this.current?.list.id === id) this.current = null
      await this.loadLists()
    },
    async addProblems(listId: number, problemIds: string[]): Promise<number> {
      const r = await invoke<{ added: number }>(IpcChannels.ListsAddProblems, { listId, problemIds })
      await this.loadLists()
      await this.openList(listId)
      return r.added
    },
    async removeItem(listId: number, problemId: string): Promise<void> {
      await invoke(IpcChannels.ListsRemoveItem, { listId, problemId })
      await this.openList(listId)
      await this.loadLists()
    },
    async setDone(listId: number, problemId: string, done: boolean): Promise<void> {
      await invoke<ProblemListItem>(IpcChannels.ListsSetDone, { listId, problemId, done })
      await this.openList(listId)
      await this.loadLists()
      await this.loadDue()
    },
    async setNote(listId: number, problemId: string, note: string): Promise<void> {
      await invoke<ProblemListItem>(IpcChannels.ListsSetNote, { listId, problemId, note })
      await this.openList(listId)
    },
    async review(listId: number, problemId: string, ease: ReviewEase): Promise<void> {
      await invoke<ProblemListItem>(IpcChannels.ListsReview, { listId, problemId, ease })
      await this.openList(listId)
      await this.loadLists()
      await this.loadDue()
    },
    async parseText(text: string): Promise<ParseIdsResult> {
      return invoke<ParseIdsResult>(IpcChannels.ListsParseText, { text })
    },
    async generate(input: GenerateListInput): Promise<GenerateListResult> {
      const r = await invoke<GenerateListResult>(IpcChannels.ListsGenerate, input)
      await this.loadLists()
      await this.openList(r.listId)
      return r
    },
    async loadDue(): Promise<void> {
      const r = await invoke<{ today: string; items: ReviewEntry[] }>(IpcChannels.ListsDueReviews)
      this.today = r.today
      this.due = r.items
    },
    // ---- 训练计划 ----
    async loadPlans(): Promise<void> {
      this.plans = await invoke<TrainingPlan[]>(IpcChannels.PlansList)
    },
    async openPlan(id: number | null): Promise<void> {
      if (id == null) {
        this.currentPlan = null
        return
      }
      this.currentPlan = await invoke<TrainingPlanDetail>(IpcChannels.PlansGet, { id })
    },
    async createPlan(input: CreatePlanInput): Promise<{ planId: number; scheduled: number; overflow: number }> {
      const r = await invoke<{ planId: number; scheduled: number; overflow: number }>(
        IpcChannels.PlansCreate,
        input
      )
      await this.loadPlans()
      await this.openPlan(r.planId)
      return r
    },
    async deletePlan(id: number): Promise<void> {
      await invoke(IpcChannels.PlansDelete, { id })
      if (this.currentPlan?.plan.id === id) this.currentPlan = null
      await this.loadPlans()
    },
    async toggleTask(id: number, problemId: string): Promise<void> {
      await invoke(IpcChannels.PlansToggleTask, { id, problemId })
      await this.openPlan(id)
      await this.loadPlans()
    },
    async markBusy(id: number, date: string, reason = ''): Promise<void> {
      await invoke(IpcChannels.PlansMarkBusy, { id, date, reason })
      await this.openPlan(id)
      await this.loadPlans()
    },
    async unmarkBusy(id: number, date: string): Promise<void> {
      await invoke(IpcChannels.PlansUnmarkBusy, { id, date })
      await this.openPlan(id)
      await this.loadPlans()
    },
    async reschedule(id: number, fromDate?: string): Promise<void> {
      await invoke(IpcChannels.PlansReschedule, { id, fromDate })
      await this.openPlan(id)
      await this.loadPlans()
    }
  }
})
