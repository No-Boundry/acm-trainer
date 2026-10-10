import { defineStore } from 'pinia'
import { invoke, on } from '@/api/ipc'
import { IpcChannels } from '@shared/channels'
import type {
  ProblemFilter,
  ProblemRow,
  ProblemSource,
  SkillNodeReport,
  SyncProgress
} from '@shared/types'

export type SourceLastSync = Record<ProblemSource, string | null>

interface ProblemsState {
  filter: Required<Pick<ProblemFilter, 'page' | 'pageSize'>> & Partial<ProblemFilter>
  total: number
  items: ProblemRow[]
  allTags: string[]
  lastSync: SourceLastSync
  syncRunning: boolean
  syncProgress: SyncProgress | null
  /** 进度监听是否已注册（防止跨页面挂载重复注册导致泄漏） */
  syncListenerAttached: boolean
  /** v1.8：知识点（技能树节点）与掌握情况，用于题库「知识点」筛选 */
  skills: SkillNodeReport[]
  skillLayerNames: string[]
  knowledgeIds: string[]
  /** v1.8.1：其他页面（技能树）跳转过来时请求自动展开知识点面板 */
  knowledgeOpenRequested: boolean
  /** v1.10：题库页勾选中的题目（用于「加入题单」） */
  selectedIds: string[]
}

/** 同步进度首条提示文案（按数据源） */
const SYNC_PREPARING: Record<ProblemSource, string> = {
  cf: '准备同步 Codeforces…',
  luogu: '准备同步洛谷…',
  leetcode: '准备同步力扣…'
}

export const useProblemsStore = defineStore('problems', {
  state: (): ProblemsState => ({
    filter: {
      page: 1,
      pageSize: 20,
      source: 'all',
      difficulty: null,
      ratingMin: null,
      ratingMax: null,
      tags: [],
      keyword: '',
      practiced: 'all',
      sortBy: 'rating',
      sortDir: 'desc'
    },
    total: 0,
    items: [],
    allTags: [],
    lastSync: { cf: null, luogu: null, leetcode: null },
    syncRunning: false,
    syncProgress: null,
    syncListenerAttached: false,
    skills: [],
    skillLayerNames: [],
    knowledgeIds: [],
    knowledgeOpenRequested: false,
    selectedIds: []
  }),
  actions: {
    /** v1.10：勾选/取消勾选题目（加入题单用；跨页保留选择） */
    toggleSelect(id: string): void {
      const set = new Set(this.selectedIds)
      if (set.has(id)) set.delete(id)
      else set.add(id)
      this.selectedIds = [...set]
    },
    clearSelection(): void {
      this.selectedIds = []
    },
    selectAllOnPage(): void {
      const set = new Set(this.selectedIds)
      for (const it of this.items) set.add(it.id)
      this.selectedIds = [...set]
    },
    async load(): Promise<{ total: number; items: ProblemRow[] }> {
      // v1.8.1：已选知识点但技能数据未就绪（深链/刷新）→ 先拉技能报告，否则 tagsAny 会为空导致筛不出题
      if (this.knowledgeIds.length > 0 && this.skills.length === 0) {
        await this.loadSkills()
      }
      // 注意：Vue 响应式 Proxy 无法通过 Electron IPC 结构化克隆，
      // 必须显式转换为纯对象/纯数组后再发送
      const res = await invoke<{ total: number; items: ProblemRow[] }>(IpcChannels.ProblemsList, {
        page: this.filter.page,
        pageSize: this.filter.pageSize,
        source: this.filter.source ?? 'all',
        difficulty: this.filter.difficulty ?? null,
        ratingMin: this.filter.ratingMin ?? null,
        ratingMax: this.filter.ratingMax ?? null,
        tags: [...(this.filter.tags ?? [])],
        // v1.8：知识点筛选 → 所选中节点的关联标签并集（OR 语义）
        tagsAny: this.knowledgeTags(),
        keyword: this.filter.keyword ?? '',
        practiced: this.filter.practiced ?? 'all',
        sortBy: this.filter.sortBy ?? 'rating',
        sortDir: this.filter.sortDir ?? 'desc'
      })
      this.total = res.total
      this.items = res.items
      return res
    },
    /** 选中知识点对应的标签并集（去重、小写化去重保留原样） */
    knowledgeTags(): string[] {
      if (this.knowledgeIds.length === 0) return []
      const nodes = this.skills.filter((n) => this.knowledgeIds.includes(n.id))
      const set = new Set<string>()
      for (const n of nodes) for (const t of n.tags) set.add(t)
      return [...set]
    },
    /** 节点掌握情况（题库知识点筛选 UI 展示：掌握度色点 + 练习题数） */
    nodeById(id: string): SkillNodeReport | null {
      return this.skills.find((n) => n.id === id) ?? null
    },
    async loadSkills(): Promise<void> {
      try {
        const report = await invoke<{ nodes: SkillNodeReport[] }>(IpcChannels.SkillGet)
        this.skills = report.nodes
      } catch {
        this.skills = [] // 技能树统计不可用时不影响题库浏览
      }
    },
    async toggleKnowledge(id: string): Promise<void> {
      const set = new Set(this.knowledgeIds)
      if (set.has(id)) set.delete(id)
      else set.add(id)
      this.knowledgeIds = [...set]
      this.filter = { ...this.filter, page: 1 }
      try {
        if (this.knowledgeIds.length > 0 && this.skills.length === 0) await this.loadSkills()
        await this.load()
      } catch {
        // 查询失败时保留选中状态，页面其它错误提示由调用方处理
      }
    },
    async clearKnowledge(): Promise<void> {
      this.knowledgeIds = []
      this.filter = { ...this.filter, page: 1 }
      try {
        await this.load()
      } catch {
        // 同上
      }
    },
    /** v1.8.1：应用外部传入的知识点选择（技能树跳转），并请求展开面板 */
    async applyKnowledge(ids: string[]): Promise<void> {
      this.knowledgeIds = [...ids]
      this.knowledgeOpenRequested = true
      this.filter = { ...this.filter, page: 1 }
      try {
        if (this.skills.length === 0) await this.loadSkills()
        await this.load()
      } catch {
        // 查询失败保留选择
      }
    },
    async loadTags(): Promise<void> {
      this.allTags = await invoke<string[]>(IpcChannels.ProblemsTags)
    },
    async loadLastSync(): Promise<void> {
      this.lastSync = await invoke<SourceLastSync>(IpcChannels.ProblemsLastSync)
    },
    setFilter(partial: Partial<ProblemFilter>): Promise<{ total: number; items: ProblemRow[] }> {
      this.filter = { ...this.filter, ...partial, page: 1 }
      return this.load()
    },
    setPage(page: number): Promise<{ total: number; items: ProblemRow[] }> {
      this.filter.page = page
      return this.load()
    },
    /** 切换数据源：重置仅对当前源无意义的筛选条件（v1.9.1：难度筛选跨源含义不同，一律清空） */
    setSource(source: 'all' | ProblemSource): void {
      const next: Partial<ProblemFilter> = { source, page: 1 }
      if (source === 'luogu' || source === 'leetcode') {
        // 洛谷 / 力扣视图：清掉 CF rating 区间（这两源无 rating，按难度筛选）
        next.ratingMin = null
        next.ratingMax = null
      }
      // 难度值在不同源含义不同（洛谷 0-7 / 力扣 1-3），切源时清空，避免「切过去结果为空」
      next.difficulty = null
      // 按题号排序时默认升序更符合直觉
      if ((this.filter.sortBy ?? 'rating') === 'id') next.sortDir = 'asc'
      this.setFilter(next)
    },
    /** 切换排序方式（v1.9.1）：按题号 → 升序；按难度 / 按 AC 数 → 降序 */
    setSortBy(
      sortBy: NonNullable<ProblemFilter['sortBy']>
    ): Promise<{ total: number; items: ProblemRow[] }> {
      return this.setFilter({ sortBy, sortDir: sortBy === 'id' ? 'asc' : 'desc' })
    },
    init(): void {
      void this.loadSkills()
      void this.loadTags()
      void this.loadLastSync()
      void this.load()
      // 全局单例，进度事件监听只注册一次，避免多次挂载泄漏
      if (!this.syncListenerAttached) {
        on(IpcChannels.ProblemsSyncProgress, (d) => {
          this.syncProgress = d as SyncProgress
        })
        this.syncListenerAttached = true
      }
    },
    /** 按数据源同步（FR-8.3：cf → problems:sync；luogu → luogu:sync；leetcode → leetcode:sync） */
    async sync(
      source: ProblemSource
    ): Promise<{ added: number; updated: number; fetchedAt: string; totalPages?: number }> {
      if (this.syncRunning) return { added: 0, updated: 0, fetchedAt: '' }
      this.syncRunning = true
      this.syncProgress = { stage: 'fetching', percent: 0, message: SYNC_PREPARING[source] }
      try {
        const channel =
          source === 'cf'
            ? IpcChannels.ProblemsSync
            : source === 'luogu'
              ? IpcChannels.LuoguSync
              : IpcChannels.LeetcodeSync
        const r = await invoke<{ added: number; updated: number; fetchedAt: string; totalPages?: number }>(
          channel
        )
        await this.loadLastSync()
        await this.loadTags()
        await this.load()
        return r
      } finally {
        this.syncRunning = false
      }
    }
  }
})
