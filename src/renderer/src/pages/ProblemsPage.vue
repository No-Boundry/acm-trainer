<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useProblemsStore } from '@/stores/problems'
import { useStatementStore } from '@/stores/statement'
import type { SkillNodeReport } from '@shared/types'
import { invoke } from '@/api/ipc'
import { useToast } from '@/composables/useToast'
import { IpcChannels } from '@shared/channels'
import type { Note, PracticeRecord, ProblemRow, ProblemSource, ResultStatus } from '@shared/types'
import { RESULT_STATUSES } from '@shared/types'
import KnowledgePicker from '@/components/common/KnowledgePicker.vue'

interface LuoguImportSummary {
  user: { uid: number; name: string; totalPassed: number }
  matched: number
  imported: number
  skipped: number
  unmatched: number
}

const store = useProblemsStore()
const route = useRoute()
const router = useRouter()
const toast = useToast()
const statement = useStatementStore()

const selected = ref<ProblemRow | null>(null)
const drawerOpen = ref(false)
const problemRecords = ref<PracticeRecord[]>([])
const problemNotes = ref<Note[]>([])

// 洛谷 UID 导入（FR-8.9）
const importUid = ref('')
const importJson = ref('')
const pasteMode = ref(false)
const importing = ref(false)

/**
 * v1.20（FR-41）：标签已全部整合进知识点，筛选界面**只保留「知识点」一个维度**。
 * 原来这里是「知识点 Tab + 6 个标签大类 Tab（算法基础/动态规划/图论/数据结构/字符串/其他）」，
 * 同一个概念有两条入口；现在统一由 `KnowledgePicker`（组件）承担，标签状态仍存于
 * `store.filter.tags`（选中知识点 = 勾选它的全部关联标签），已选 chips 与命中数角标不变。
 */
const selectedTags = computed(() => [...(store.filter.tags ?? [])])

/**
 * v1.17：某道题命中了几个已选标签（标签筛选为并集，命中越多排序越靠前）。
 * 返回 0 表示当前没选标签，不显示角标。
 */
function matchCount(row: ProblemRow): number {
  const selected = store.filter.tags ?? []
  if (selected.length === 0) return 0
  const set = new Set(selected)
  return row.tags.reduce((n, t) => (set.has(t) ? n + 1 : n), 0)
}

// 记录练习表单
// v1.8.1：耗时默认为空（此前默认 0，输入时要先删掉 0，易误记）
const recForm = ref({
  status: 'AC' as ResultStatus,
  durationMinutes: null as number | null,
  note: '',
  isMistake: false
})
const submitting = ref(false)

const totalPages = computed(() => Math.max(1, Math.ceil(store.total / store.filter.pageSize!)))

const statusColors: Record<string, string> = {
  AC: '#3cb371',
  WA: '#ff6347',
  TLE: '#ffa500',
  RE: '#ff6347',
  MLE: '#ffa500',
  CE: '#a6adc8',
  SKIP: '#6c7086',
  UNSOLVED: '#6c7086'
}

function ratingColor(r: number | null): string {
  if (r == null) return '#6c7086'
  if (r < 1200) return '#808080'
  if (r < 1400) return '#3cb371'
  if (r < 1600) return '#03a89e'
  if (r < 1900) return '#1e90ff'
  if (r < 2200) return '#aa00aa'
  return '#ff8c00'
}

/** 洛谷难度展示（docs/03 §9.1 官方 0-7 映射） */
const luoguDiffLabels: readonly string[] = [
  '暂无评定',
  '入门',
  '普及-',
  '普及/提高-',
  '普及+/提高',
  '提高+/省选-',
  '省选/NOI-',
  'NOI+'
]

const luoguDiffColors: readonly string[] = [
  '#6c7086',
  '#3cb371',
  '#03a89e',
  '#1e90ff',
  '#9370db',
  '#ff8c00',
  '#ff4500',
  '#ff0000'
]

function luoguDiffLabel(d: number | null): string {
  if (d == null || d < 0 || d > 7) return '暂无评定'
  return luoguDiffLabels[d]
}

function luoguDiffColor(d: number | null): string {
  if (d == null || d < 0 || d > 7) return luoguDiffColors[0]
  return luoguDiffColors[d]
}

/** 力扣难度展示（v1.9 FR-21：1 简单 / 2 中等 / 3 困难） */
const lcDiffLabels: readonly string[] = ['', '简单', '中等', '困难']
const lcDiffColors: readonly string[] = ['#6c7086', '#3cb371', '#ff8c00', '#ff2d2d']
/** 难度下拉选项（不含 0/未标难度） */
const lcDiffOptions = [1, 2, 3].map((d) => ({ value: d, label: lcDiffLabels[d] }))

function lcDiffLabel(d: number | null): string {
  if (d == null || d < 1 || d > 3) return '未标难度'
  return lcDiffLabels[d]
}

function lcDiffColor(d: number | null): string {
  if (d == null || d < 1 || d > 3) return lcDiffColors[0]
  return lcDiffColors[d]
}

/** 各数据源中文名 */
const SOURCE_NAMES: Record<ProblemSource, string> = {
  cf: 'Codeforces',
  luogu: '洛谷',
  leetcode: '力扣'
}

function toggleTag(tag: string): void {
  const tags = store.filter.tags ?? []
  const next = tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag]
  onFilter({ tags: next })
  // v1.13：标签可能是知识点派生出来的 → 筛选提交后再校正选中知识点
  void store.syncKnowledgeFromTags()
}

/** v1.13：一键清空全部标签（含知识点派生出的标签） */
function clearAllTagFilters(): void {
  store.knowledgeIds = []
  onFilter({ tags: [] })
}

/** v1.13：知识点 Tab 内点击节点 = 选中/取消该节点关联的全部标签 */
function toggleKnowledgeNode(n: SkillNodeReport): void {
  if (!isFilterable(n)) return
  const tags = new Set(store.filter.tags ?? [])
  const allOn = n.tags.every((t) => tags.has(t))
  for (const t of n.tags) {
    if (allOn) tags.delete(t)
    else tags.add(t)
  }
  const ids = new Set(store.knowledgeIds)
  if (allOn) ids.delete(n.id)
  else ids.add(n.id)
  store.knowledgeIds = [...ids]
  onFilter({ tags: [...tags] })
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** 筛选变更：加载失败时给出可见提示（修复"静默失败"） */
function onFilter(partial: Partial<typeof store.filter>): void {
  store.setFilter(partial as never).catch((e: unknown) => toast.error(`筛选加载失败: ${errMsg(e)}`))
}

function onPage(page: number): void {
  store.setPage(page).catch((e: unknown) => toast.error(`翻页失败: ${errMsg(e)}`))
}

/** v1.9.1：切换排序方式（按题号默认升序、按难度/AC 数默认降序，避免"选了什么都没变"的困惑） */
function onSortBy(sortBy: string): void {
  if (sortBy !== 'rating' && sortBy !== 'id' && sortBy !== 'solvedCount') return
  store.setSortBy(sortBy).catch((e: unknown) => toast.error(`排序加载失败: ${errMsg(e)}`))
}

/** v1.10：把勾选的题目加入题单（FR-27 来源之一：从题库勾选加入） */
const listOptions = ref<{ id: number; name: string; total: number }[]>([])
const targetListId = ref<number | null>(null)
const newListNameForSelection = ref('')

async function loadListOptions(): Promise<void> {
  try {
    listOptions.value = await invoke<{ id: number; name: string; total: number }[]>(IpcChannels.ListsList)
    if (targetListId.value == null && listOptions.value.length > 0) {
      targetListId.value = listOptions.value[0].id
    }
  } catch {
    listOptions.value = []
  }
}

async function addSelectionToList(createNew = false): Promise<void> {
  const ids = [...store.selectedIds]
  if (ids.length === 0) {
    toast.error('请先勾选题目（表格第一列的复选框）')
    return
  }
  try {
    let listId = targetListId.value
    if (createNew || listId == null) {
      const name =
        newListNameForSelection.value.trim() || `题库勾选题单 ${new Date().toLocaleDateString()}`
      const created = await invoke<{ id: number }>(IpcChannels.ListsCreate, {
        name,
        description: `来自题库勾选（${ids.length} 题）`,
        origin: 'manual'
      })
      listId = created.id
      newListNameForSelection.value = ''
    }
    const r = await invoke<{ added: number }>(IpcChannels.ListsAddProblems, { listId, problemIds: ids })
    store.clearSelection()
    await loadListOptions()
    toast.success(`已加入题单：新增 ${r.added} 题（可到「题单/计划」查看进度）`)
  } catch (e) {
    toast.error(errMsg(e))
  }
}

async function onSync(source: ProblemSource): Promise<void> {
  const name = SOURCE_NAMES[source]
  try {
    const r = await store.sync(source)
    if (r.added + r.updated === 0) {
      toast.error(`${name} 同步流程完成但入库 0 道题：网络可能返回了异常数据，请重试或检查网络`)
    } else {
      toast.success(`${name} 同步完成：新增 ${r.added} 道，更新 ${r.updated} 道`)
    }
  } catch (e) {
    toast.error(`${name} 同步失败: ${errMsg(e)}`)
  }
}

/** v1.12：在线导入已迁移到设置页的「题库账号绑定」 */
function gotoAccountBinding(): void {
  void router.push({ path: '/settings', query: { section: 'account' } })
}

/** 洛谷 UID 做题记录导入（FR-8.9：在线抓取 / 粘贴 JSON） */
async function doImport(mode: 'fetch' | 'paste'): Promise<void> {
  if (importing.value) return
  importing.value = true
  try {
    const r = await invoke<LuoguImportSummary>(IpcChannels.LuoguImportPractice, {
      mode,
      uid: mode === 'fetch' ? importUid.value.trim() : undefined,
      jsonText: mode === 'paste' ? importJson.value : undefined
    })
    toast.success(
      `${r.user.name}（UID ${r.user.uid}，共 ${r.user.totalPassed} AC）：本地匹配 ${r.matched} 题，新增 ${r.imported}，跳过已导入 ${r.skipped}，未收录 ${r.unmatched}`
    )
    await store.load()
  } catch (e) {
    const msg = errMsg(e)
    // 洛谷改版：在线导入不可用 → 直接打开粘贴面板，少一步操作
    if (/改版|不再提供做题记录|LUOGU_PRACTICE_UNAVAILABLE/.test(msg)) {
      pasteMode.value = true
    }
    // 登录类错误直接展示完整引导文案
    if (msg.includes('登录') || msg.includes('luogu')) {
      toast.error(msg)
    } else {
      toast.error(`导入失败: ${msg}`)
    }
  } finally {
    importing.value = false
  }
}

/** 难度输入：空串 → null，避免 '' >= 比较恒 false 导致列表空白 */
function onRatingInput(key: 'ratingMin' | 'ratingMax', e: Event): void {
  const raw = (e.target as HTMLInputElement).value
  onFilter({ [key]: raw === '' ? null : Number(raw) } as Partial<typeof store.filter>)
}

async function openDrawer(row: ProblemRow): Promise<void> {
  selected.value = row
  drawerOpen.value = true
  await Promise.all([loadRecords(row.id), loadNotes(row.id)])
}

async function loadRecords(problemId: string): Promise<void> {
  const r = await invoke<{ total: number; items: PracticeRecord[] }>(IpcChannels.RecordsList, {
    problemId,
    page: 1,
    pageSize: 20
  })
  problemRecords.value = r.items
}

async function loadNotes(problemId: string): Promise<void> {
  problemNotes.value = await invoke<Note[]>(IpcChannels.NotesList, { problemId })
}

async function submitRecord(): Promise<void> {
  if (!selected.value) return
  submitting.value = true
  try {
    await invoke(IpcChannels.RecordsCreate, {
      problemId: selected.value.id,
      status: recForm.value.status,
      durationSeconds:
        recForm.value.durationMinutes != null && recForm.value.durationMinutes > 0
          ? Math.round(recForm.value.durationMinutes * 60)
          : null,
      note: recForm.value.note || null,
      isMistake: recForm.value.isMistake
    })
    toast.success(`已记录 ${recForm.value.status}`)
    recForm.value = { status: 'AC', durationMinutes: null, note: '', isMistake: false }
    await Promise.all([
      loadRecords(selected.value.id),
      store.load(),
      // v1.8.1：记录后同步刷新知识点掌握情况（否则筛选区题数/色点停留在旧值）
      store.loadSkills()
    ])
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  } finally {
    submitting.value = false
  }
}

/** v1.8：题面用 Edge 浏览器打开（抽屉按钮与列表按钮共用） */
/**
 * 综合节点（无关联标签）不参与筛题：如 final_sprint。
 * v1.20 起知识点渲染搬进 `KnowledgePicker`，这里只保留点击入口需要的判断。
 */
function isFilterable(n: SkillNodeReport): boolean {
  return n.tags.length > 0
}

// v1.8.1 → v1.20：技能树跳过来时只需清掉「打开请求」标记。
// 筛选区现在固定是知识点（没有标签 Tab 可切了），滚动定位由 route.query.knowledge 处理。
watch(
  () => store.knowledgeOpenRequested,
  (v) => {
    if (v) store.knowledgeOpenRequested = false
  },
  { immediate: true }
)

async function openStatement(problemId?: string): Promise<void> {
  const id = problemId ?? selected.value?.id
  if (!id) return
  try {
    const via = await statement.openStatement(id)
    toast.info(via === 'edge' ? '已在 Edge 中打开题面' : '已用默认浏览器打开题面（未检测到 Edge）')
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  }
}

function goNotes(): void {
  if (!selected.value) return
  void router.push({ path: '/notes', query: { problemId: selected.value.id } })
}

function fmtTime(s: string | null | undefined): string {
  if (!s) return '—'
  return s.slice(0, 16)
}

onMounted(() => {
  store.init()
  // v1.20 FR-42：技能树详情「排除已 AC / 只看已 AC」跳转 → ?ac=ac | ?ac=notac
  const rawAc = route.query.ac
  const acParam = Array.isArray(rawAc) ? rawAc[0] : rawAc
  if (acParam === 'ac' || acParam === 'notac') store.filter.ac = acParam
  // v1.8.1：支持 ?knowledge=id1,id2 深链（技能树「去题库练习」跳转；刷新/回退后仍保留选择）
  const rawKnowledge = route.query.knowledge
  const knowledgeParam = Array.isArray(rawKnowledge) ? rawKnowledge.join(',') : (rawKnowledge ?? '')
  const knowledgeIds = String(knowledgeParam)
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
  if (knowledgeIds.length > 0) {
    // 有深链：按其关联标签加载（避免先发一次空筛选请求）
    // v1.14 FR-32：技能树详情面板可手动选取关联标签 → ?knowledge=dsu&tags=并查集,图
    const rawTags = route.query.tags
    const tagParam = Array.isArray(rawTags) ? rawTags.join(',') : (rawTags ?? '')
    const pickedTags = String(tagParam)
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
    store
      .applyKnowledgeTags(knowledgeIds, pickedTags)
      .catch((e: unknown) => toast.error(`题库加载失败: ${errMsg(e)}`))
  } else {
    // 列表加载失败可见化（init 内部静默，这里显式兜底一次）
    store
      .load()
      .catch((e: unknown) => toast.error(`题库加载失败: ${errMsg(e)}`))
  }
  // 从错题本跳转：q=题号 → 直接定位
  const q = route.query.q as string | undefined
  if (q) onFilter({ keyword: q })
  // v1.10：题单下拉（加入题单用）
  void loadListOptions()
})
</script>

<template>
  <div class="problems-page">
    <!-- 筛选栏 -->
    <div class="filter-bar">
      <!-- 数据源选择（FR-8.2）+ 按源同步（FR-8.3） -->
      <div class="source-row">
        <div class="source-switch">
          <button
            class="seg"
            :class="{ on: (store.filter.source ?? 'all') === 'all' }"
            @click="store.setSource('all')"
          >
            全部
          </button>
          <button
            class="seg"
            :class="{ on: store.filter.source === 'cf' }"
            @click="store.setSource('cf')"
          >
            Codeforces
          </button>
          <button
            class="seg"
            :class="{ on: store.filter.source === 'luogu' }"
            @click="store.setSource('luogu')"
          >
            洛谷
          </button>
          <button
            class="seg"
            :class="{ on: store.filter.source === 'leetcode' }"
            @click="store.setSource('leetcode')"
          >
            力扣
          </button>
        </div>
        <span class="dim small">
          最近同步：CF {{ fmtTime(store.lastSync.cf) }} ｜ 洛谷 {{ fmtTime(store.lastSync.luogu) }} ｜ 力扣
          {{ fmtTime(store.lastSync.leetcode) }}
        </span>
        <div class="sync-btns">
          <button class="btn primary" :disabled="store.syncRunning" @click="onSync('cf')">
            同步 Codeforces
          </button>
          <button class="btn luogu" :disabled="store.syncRunning" @click="onSync('luogu')">
            同步洛谷
          </button>
          <button class="btn leetcode" :disabled="store.syncRunning" @click="onSync('leetcode')">
            同步力扣
          </button>
        </div>
      </div>

      <div class="filter-row">
        <input
          v-model="store.filter.keyword"
          class="input"
          placeholder="搜索题号 / 题目名（如 1741 或 P1000 或 two-sum）"
          @keyup.enter="onFilter({ keyword: (store.filter.keyword ?? '').trim() })"
        />
        <template v-if="store.filter.source === 'luogu'">
          <select
            class="select"
            :value="store.filter.difficulty ?? ''"
            @change="onFilter({ difficulty: ($event.target as HTMLSelectElement).value === '' ? null : Number(($event.target as HTMLSelectElement).value) })"
          >
            <option value="">洛谷难度：全部</option>
            <option v-for="(label, d) in luoguDiffLabels" :key="d" :value="d">{{ d }} · {{ label }}</option>
          </select>
        </template>
        <template v-else-if="store.filter.source === 'leetcode'">
          <select
            class="select"
            :value="store.filter.difficulty ?? ''"
            @change="onFilter({ difficulty: ($event.target as HTMLSelectElement).value === '' ? null : Number(($event.target as HTMLSelectElement).value) })"
          >
            <option value="">力扣难度：全部</option>
            <option v-for="o in lcDiffOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </template>
        <template v-else>
          <input
            :value="store.filter.ratingMin ?? ''"
            class="input w-90"
            type="number"
            placeholder="CF难度 ≥"
            @input="onRatingInput('ratingMin', $event)"
          />
          <span class="dim">—</span>
          <input
            :value="store.filter.ratingMax ?? ''"
            class="input w-90"
            type="number"
            placeholder="CF难度 ≤"
            @input="onRatingInput('ratingMax', $event)"
          />
        </template>
        <select v-model="store.filter.practiced" class="select" @change="onFilter({ practiced: store.filter.practiced as never })">
          <option value="all">全部状态</option>
          <option value="undone">未练习</option>
          <option value="done">已练习</option>
        </select>
        <select
          :value="store.filter.sortBy"
          class="select sort-by"
          @change="onSortBy(($event.target as HTMLSelectElement).value)"
        >
          <option value="rating">按难度</option>
          <option value="id">按题号</option>
          <option value="solvedCount">按 AC 数</option>
        </select>
        <button class="btn ghost" @click="onFilter({ sortDir: store.filter.sortDir === 'asc' ? 'desc' : 'asc' })">
          {{ store.filter.sortDir === 'asc' ? '↑ 升序' : '↓ 降序' }}
        </button>
        <button class="btn ghost" @click="onFilter({ keyword: '', difficulty: null, ratingMin: null, ratingMax: null, tags: [], practiced: 'all', sortBy: 'rating', sortDir: 'desc' })">
          重置
        </button>
      </div>

      <!-- v1.20（FR-41）：标签已整合进知识点，筛选区只保留「知识点」一个维度 -->
      <div class="tag-horz">
        <div class="kn-title-row">
          <span class="kn-title">知识点</span>
          <span class="dim small">
            按知识点筛题：点节点 = 勾选它关联的全部标签
            （v1.20 起原来的 6 个标签大类已合并进知识点，不再需要逐个大类翻标签）
          </span>
        </div>

        <div v-if="selectedTags.length" class="sel-line">
          <span class="dim small">已选：</span>
          <button
            v-for="tag in selectedTags"
            :key="tag"
            class="chip on"
            @click="toggleTag(tag)"
          >
            {{ tag }} ✕
          </button>
          <button class="btn ghost xs" @click="clearAllTagFilters()">全部清空</button>
          <span v-if="selectedTags.length > 1" class="dim small match-hint">取并集 · 命中标签越多越靠前</span>
        </div>

        <div v-if="(store.filter.ac ?? 'all') !== 'all'" class="ac-line">
          <span class="dim small">题目状态：</span>
          <button class="chip on" @click="onFilter({ ac: 'all' })">
            {{ store.filter.ac === 'ac' ? '只看已 AC' : '排除已 AC' }} ✕
          </button>
        </div>

        <KnowledgePicker
          :skills="store.skills"
          :selected-ids="store.knowledgeIds"
          :selected-tags="selectedTags"
          @toggle="toggleKnowledgeNode"
          @clear="clearAllTagFilters()"
        />
      </div>

      <!-- v1.12：在线导入（UID 抓取）已迁移到「设置 → 题库账号绑定」，这里只保留粘贴导入与入口 -->
      <div class="import-panel">
        <div class="import-head">
          <span class="import-title">做题记录导入</span>
          <button class="btn luogu" @click="gotoAccountBinding()">⚙️ 账号绑定与自动同步（设置页）</button>
          <button class="btn ghost" @click="pasteMode = !pasteMode">
            {{ pasteMode ? '收起粘贴' : '粘贴题号/内容导入' }}
          </button>
        </div>
        <div v-if="pasteMode" class="paste-area">
          <textarea
            v-model="importJson"
            class="paste-input"
            placeholder="粘贴任意包含题号的内容即可自动识别导入，例如：洛谷个人主页文字、题号列表、网页源码（P1000 / 1741A / LC1 均可）"
          ></textarea>
          <button class="btn primary" :disabled="importing" @click="doImport('paste')">粘贴导入</button>
        </div>
        <div class="dim small tip">
          <b class="ok-note">✅ 已在「设置 → 题库账号绑定」绑定洛谷 UID / Codeforces handle 后，应用会在启动时自动抓取做题记录，无需在此手动导入。</b>
          未绑定时仍可在此直接粘贴题号导入。导入的 AC 记录计入练习统计（可随时删除）。
        </div>
      </div>

      <!-- 同步进度 -->
      <div v-if="store.syncProgress" class="sync-progress">
        <div class="progress-track">
          <div class="progress-fill" :style="{ width: `${store.syncProgress.percent}%` }" />
        </div>
        <span class="dim">{{ store.syncProgress.message }}（{{ store.syncProgress.percent }}%）</span>
      </div>

      <div class="meta-row">
        <span class="dim">共 {{ store.total }} 题</span>
        <!-- v1.10：勾选后一键加入题单（FR-27） -->
        <span class="sel-bar">
          <span class="dim small">已勾选 {{ store.selectedIds.length }} 题</span>
          <select v-model="targetListId" class="select xs">
            <option :value="null">（新建题单）</option>
            <option v-for="l in listOptions" :key="l.id" :value="l.id">{{ l.name }}（{{ l.total }}）</option>
          </select>
          <input
            v-if="targetListId == null"
            v-model="newListNameForSelection"
            class="input xs"
            placeholder="新题单名称"
          />
          <button class="btn xs primary" :disabled="store.selectedIds.length === 0" @click="addSelectionToList(false)">
            加入题单
          </button>
          <button class="btn xs" :disabled="store.selectedIds.length === 0" @click="addSelectionToList(true)">
            新建题单并加入
          </button>
          <button class="btn xs ghost" :disabled="store.selectedIds.length === 0" @click="store.clearSelection()">
            清空勾选
          </button>
        </span>
      </div>
    </div>

    <!-- 题目列表 -->
    <table class="table">
      <thead>
        <tr>
          <th class="w-40">
            <input
              type="checkbox"
              title="勾选本页全部"
              @change="store.selectAllOnPage()"
            />
          </th>
          <th class="w-110">题号</th>
          <th>题目</th>
          <th class="w-110">难度</th>
          <th class="w-100">全球AC</th>
          <th class="w-100">我的状态</th>
          <th class="w-150">操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in store.items" :key="row.id" class="row" @click="openDrawer(row)">
          <td @click.stop>
            <input
              type="checkbox"
              :checked="store.selectedIds.includes(row.id)"
              @change="store.toggleSelect(row.id)"
            />
          </td>
          <td class="mono">{{ row.id }}</td>
          <td>
            <div class="pname">{{ row.name }}</div>
            <div class="ptags">
              <span v-if="row.source === 'luogu'" class="mini-tag src">洛谷</span>
              <span v-else-if="row.source === 'leetcode'" class="mini-tag src lc">力扣</span>
              <span v-for="t in row.tags.slice(0, 4)" :key="t" class="mini-tag">{{ t }}</span>
              <span
                v-if="selectedTags.length > 1 && matchCount(row) > 0"
                class="mini-tag match"
                :title="`命中 ${matchCount(row)} / ${selectedTags.length} 个已选标签`"
              >命中 {{ matchCount(row) }}/{{ selectedTags.length }}</span>
            </div>
          </td>
          <td>
            <span v-if="row.source === 'luogu'" class="rating" :style="{ color: luoguDiffColor(row.difficulty) }">
              {{ luoguDiffLabel(row.difficulty) }}
            </span>
            <span v-else-if="row.source === 'leetcode'" class="rating" :style="{ color: lcDiffColor(row.difficulty) }">
              {{ lcDiffLabel(row.difficulty) }}
            </span>
            <span v-else-if="row.rating != null" class="rating" :style="{ color: ratingColor(row.rating) }">{{ row.rating }}</span>
            <span v-else class="dim">—</span>
          </td>
          <td class="mono dim">{{ row.solvedCount.toLocaleString() }}</td>
          <td>
            <span v-if="row.lastStatus" class="badge" :style="{ background: statusColors[row.lastStatus] }">{{ row.lastStatus }}</span>
            <span v-else class="dim">未做</span>
          </td>
          <td>
            <button class="btn xs" @click.stop="openStatement(row.id)">题面</button>
            <button class="btn xs" @click.stop="openDrawer(row)">记录</button>
          </td>
        </tr>
        <tr v-if="store.items.length === 0">
          <td colspan="6" class="empty">
            {{
              store.total === 0
                ? '题库为空，请先同步：Codeforces（右上按钮）或洛谷（约 1.6 万道 P 题）'
                : '没有符合条件的题目'
            }}
          </td>
        </tr>
      </tbody>
    </table>

    <!-- 分页 -->
    <div class="pager">
      <button class="btn ghost xs" :disabled="store.filter.page! <= 1" @click="onPage(store.filter.page! - 1)">上一页</button>
      <span class="dim">{{ store.filter.page }} / {{ totalPages }}</span>
      <button class="btn ghost xs" :disabled="store.filter.page! >= totalPages" @click="onPage(store.filter.page! + 1)">下一页</button>
    </div>

    <!-- 详情抽屉（v1.7 题面为独立窗口，抽屉不再收缩） -->
    <Teleport to="body">
      <div v-if="drawerOpen && selected" class="drawer-mask" @click.self="drawerOpen = false">
        <div class="drawer">
          <div class="drawer-head">
            <div>
              <div class="mono dim">{{ selected.id }}</div>
              <h3>{{ selected.name }}</h3>
            </div>
            <button class="btn ghost xs" @click="drawerOpen = false">✕</button>
          </div>

          <div class="drawer-actions">
            <button class="btn primary" @click="openStatement()">📖 打开题面（Edge）</button>
            <button class="btn ghost" @click="goNotes()">📝 笔记（{{ problemNotes.length }}）</button>
          </div>

          <!-- 记录练习 -->
          <div class="section">
            <h4>记录练习</h4>
            <div class="form-grid">
              <select v-model="recForm.status" class="select">
                <option v-for="s in RESULT_STATUSES" :key="s" :value="s">{{ s }}</option>
              </select>
              <input
                v-model.number="recForm.durationMinutes"
                class="input"
                type="number"
                min="0"
                step="1"
                placeholder="耗时（分钟，可留空）"
              />
              <label class="check">
                <input v-model="recForm.isMistake" type="checkbox" /> 标记为错题
              </label>
            </div>
            <input v-model="recForm.note" class="input" placeholder="备注（可选）" @keyup.enter="submitRecord()" />
            <button class="btn primary" :disabled="submitting" @click="submitRecord()">提交记录</button>
          </div>

          <!-- 最近记录 -->
          <div class="section">
            <h4>练习记录</h4>
            <ul v-if="problemRecords.length" class="rec-list">
              <li v-for="r in problemRecords" :key="r.id">
                <span class="badge" :style="{ background: statusColors[r.status] }">{{ r.status }}</span>
                <span class="dim">{{ r.durationSeconds != null ? `${Math.round(r.durationSeconds / 60)}min` : '—' }}</span>
                <span class="dim">{{ r.createdAt.slice(5, 16) }}</span>
                <span v-if="r.isMistake" class="mini-tag warn">错题</span>
                <span v-if="r.note" class="note-text">{{ r.note }}</span>
              </li>
            </ul>
            <p v-else class="dim">暂无记录</p>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.problems-page {
  padding: 16px 20px;
}
.filter-bar {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 12px;
}
.filter-row {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.source-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 4px;
}
.source-switch {
  display: flex;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}
.seg {
  background: transparent;
  color: var(--text-dim);
  border: none;
  padding: 6px 14px;
  font-size: 13px;
  cursor: pointer;
}
.seg + .seg {
  border-left: 1px solid var(--border);
}
.seg.on {
  background: var(--primary);
  color: #fff;
}
.sync-btns {
  display: flex;
  gap: 8px;
  margin-left: auto;
}
.small {
  font-size: 12px;
}
.input,
.select {
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 6px;
  padding: 7px 10px;
  font-size: 13px;
  outline: none;
}
.input:focus,
.select:focus {
  border-color: var(--primary);
}
.w-90 {
  width: 90px;
}
.tag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.kn-panel {
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  padding: 8px 10px;
  margin-bottom: 10px;
}
.kn-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.kn-toggle {
  background: transparent;
  border: none;
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  padding: 2px 0;
}
.grow {
  flex: 1;
}
/* v1.20 FR-41：筛选区标题（标签已整合进知识点，不再有分类 Tab） */
.kn-title-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
  padding: 2px 0 4px;
}
.kn-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
.kn-summary-line {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 2px 0 4px;
  border-bottom: 1px dashed var(--border);
  margin-bottom: 4px;
}
.kn-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
}
.kn-group {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}
.kn-layer {
  width: 132px;
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text-faint);
  padding-top: 4px;
}
.kn-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  flex: 1;
}
.kn-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  border-radius: 12px;
  padding: 3px 9px;
  font-size: 11.5px;
  cursor: pointer;
}
.kn-chip:hover {
  border-color: var(--primary);
}
.kn-chip.on {
  border-color: var(--primary);
  background: #2a2a44;
  box-shadow: 0 0 0 1px var(--primary) inset;
}
.kn-chip.disabled {
  opacity: 0.45;
  cursor: not-allowed;
  border-style: dashed;
}
.kn-chip .dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
.kn-chip .kn-stat {
  color: var(--text-faint);
  font-size: 10.5px;
}
.kn-tip {
  line-height: 1.6;
}
.kn-summary {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.kn-sum-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.kn-sum-item .dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}
.tag-horz {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.tag-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.seg-tab {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-dim);
  border-radius: 14px;
  padding: 3px 12px;
  font-size: 12.5px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.seg-tab.on {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}
.sel-count {
  background: #fff;
  color: var(--primary);
  border-radius: 8px;
  font-size: 10.5px;
  min-width: 15px;
  text-align: center;
  padding: 0 3px;
}
.sel-line {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
/* v1.17：标签并集筛选的「命中数」角标与提示 */
.mini-tag.match {
  background: rgba(249, 226, 175, 0.16);
  border: 1px solid rgba(249, 226, 175, 0.45);
  color: #f9e2af;
}
.match-hint {
  margin-left: 2px;
}
.chip.on {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}
.import-panel {
  border: 1px dashed #45475a;
  border-radius: 8px;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.import-head {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.import-title {
  font-weight: 600;
  font-size: 13px;
  color: #e34c39;
}
.paste-area {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}
.paste-input {
  flex: 1;
  height: 96px;
  resize: none;
  background: var(--bg-side);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 6px;
  padding: 8px 10px;
  font-family: var(--mono);
  font-size: 12px;
  outline: none;
}
.import-panel .tip {
  line-height: 1.5;
}
.import-panel .tip .warn {
  color: #e6a23c;
  font-weight: 600;
}
.import-panel .tip .ok-note {
  color: #3cb371;
  font-weight: 600;
}
.chip {
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-dim);
  border-radius: 12px;
  padding: 3px 10px;
  font-size: 12px;
  cursor: pointer;
}
.chip.on {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}
.sync-progress {
  display: flex;
  align-items: center;
  gap: 10px;
}
.progress-track {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: var(--border);
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  background: var(--primary);
  transition: width 0.2s;
}
.meta-row {
  display: flex;
  gap: 16px;
  font-size: 12px;
}
.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.table th {
  text-align: left;
  color: var(--text-faint);
  font-weight: 500;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
}
.table td {
  padding: 9px 10px;
  border-bottom: 1px solid #262638;
}
.row {
  cursor: pointer;
}
.row:hover {
  background: #26263a;
}
.w-110 { width: 110px; }
.w-90 { width: 90px; }
.w-100 { width: 100px; }
.w-150 { width: 150px; }
.pname {
  font-weight: 500;
}
.ptags {
  display: flex;
  gap: 4px;
  margin-top: 3px;
  flex-wrap: wrap;
}
.mini-tag {
  font-size: 11px;
  color: var(--text-dim);
  background: var(--surface);
  border-radius: 3px;
  padding: 1px 6px;
}
.mini-tag.warn {
  color: var(--warning);
}
.mini-tag.src {
  color: #e34c39;
  border-color: #e34c39;
}
.mini-tag.src.lc {
  color: #ffa116;
  border-color: #ffa116;
}
/* v1.10：勾选加入题单 */
.sel-bar {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: 12px;
  flex-wrap: wrap;
}
.w-40 {
  width: 40px;
}
.rating {
  font-weight: 700;
  font-family: var(--mono);
}
.badge {
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  border-radius: 4px;
  padding: 2px 8px;
}
.empty {
  text-align: center;
  color: var(--text-faint);
  padding: 40px 0;
}
.pager {
  display: flex;
  align-items: center;
  gap: 12px;
  justify-content: center;
  padding: 14px 0;
}
.btn {
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  border-radius: 6px;
  padding: 7px 14px;
  font-size: 13px;
  cursor: pointer;
}
.btn:hover {
  border-color: var(--primary);
}
.btn.primary {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}
.btn.luogu {
  background: #e34c39;
  border-color: #e34c39;
  color: #fff;
}
.btn.leetcode {
  background: #ffa116;
  border-color: #ffa116;
  color: #1b1b1b;
}
.btn.ghost {
  background: transparent;
}
.btn.xs {
  padding: 3px 9px;
  font-size: 12px;
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.dim {
  color: var(--text-faint);
}
.mono {
  font-family: var(--mono);
}
.drawer-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 100;
}
.drawer {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 460px;
  background: var(--bg);
  border-left: 1px solid var(--border);
  padding: 16px 18px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.drawer-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}
.drawer-head h3 {
  margin: 2px 0 0;
  font-size: 17px;
}
.drawer-actions {
  display: flex;
  gap: 8px;
}
.section h4 {
  margin: 0 0 8px;
  font-size: 13px;
  color: var(--text-dim);
}
.form-grid {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
  align-items: center;
}
.check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  white-space: nowrap;
}
.rec-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.rec-list li {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 12px;
}
.note-text {
  color: var(--text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 180px;
}
</style>
