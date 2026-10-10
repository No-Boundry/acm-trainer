<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { invoke } from '@/api/ipc'
import { useToast } from '@/composables/useToast'
import { useStatementStore } from '@/stores/statement'
import { useProblemsStore } from '@/stores/problems'
import { groupTagsByCategory } from '@shared/tag-categories'
import { IpcChannels } from '@shared/channels'
import type {
  Contest,
  ContestListItem,
  ContestResult,
  ProblemRow,
  ResultStatus
} from '@shared/types'
import { RESULT_STATUSES } from '@shared/types'

const toast = useToast()
const problemsStore = useProblemsStore()
const statement = useStatementStore()

/** v1.8：比赛内题面同样用 Edge 浏览器打开（与题库页一致，应用内不再弹窗展示题面） */
async function openContestStatement(problemId: string): Promise<void> {
  try {
    const via = await statement.openStatement(problemId)
    toast.info(via === 'edge' ? '已在 Edge 中打开题面' : '已用默认浏览器打开题面（未检测到 Edge）')
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  }
}

type View = 'create' | 'running' | 'result' | 'history'
const view = ref<View>('create')

// 创建表单
const form = ref({
  name: '',
  durationMinutes: 120,
  count: 5 as 3 | 5 | 7 | 10,
  ratingMin: 1200 as number | null,
  ratingMax: 2000 as number | null,
  tags: [] as string[]
})
const generating = ref(false)
const generated = ref<ProblemRow[]>([])

// 组卷标签选择：横向大类 Tab（与题库页一致，v1.2.1）
const groupedTags = computed(() => groupTagsByCategory(problemsStore.allTags))
const activeTagCat = ref('')
watch(
  () => groupedTags.value,
  (groups) => {
    if (groups.length === 0) return
    const names = groups.map((g) => g.category)
    if (!names.includes(activeTagCat.value)) activeTagCat.value = names[0]
  },
  { immediate: true }
)
const activeGroupTags = computed(
  () => groupedTags.value.find((g) => g.category === activeTagCat.value)?.tags ?? []
)

// 比赛状态
const contest = ref<Contest | null>(null)
const contests = ref<ContestListItem[]>([])
const result = ref<ContestResult | null>(null)
const remaining = ref(0)
const finishing = ref(false)
let timer: ReturnType<typeof setInterval> | null = null

const letters = 'ABCDEFGHIJ'

const remainingText = computed(() => {
  const s = Math.max(0, remaining.value)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`
})

function toggleTag(tag: string): void {
  const tags = form.value.tags
  form.value.tags = tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag]
}

async function generate(): Promise<void> {
  if (!form.value.name.trim()) {
    toast.error('请先填写比赛名称')
    return
  }
  generating.value = true
  try {
    const ids = await invoke<string[]>(IpcChannels.ContestsGenerate, {
      count: form.value.count,
      ratingMin: form.value.ratingMin,
      ratingMax: form.value.ratingMax,
      tags: [...form.value.tags]
    })
    const rows = await Promise.all(
      ids.map(async (id) => {
        const p = await invoke<ProblemRow | null>(IpcChannels.ProblemsGet, { id })
        return p
      })
    )
    generated.value = rows.filter((r): r is ProblemRow => r !== null)
    toast.info(`已生成 ${generated.value.length} 道题，确认后开始比赛`)
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  } finally {
    generating.value = false
  }
}

async function createAndStart(): Promise<void> {
  if (generated.value.length === 0) {
    toast.error('请先生成题单')
    return
  }
  let created: Contest | null = null
  try {
    created = await invoke<Contest>(IpcChannels.ContestsCreate, {
      name: form.value.name.trim(),
      durationMinutes: form.value.durationMinutes,
      problemIds: generated.value.map((p) => p.id)
    })
    const running = await invoke<Contest>(IpcChannels.ContestsStart, { id: created.id })
    contest.value = running
    generated.value = []
    await loadContests()
    startTicker()
    view.value = 'running'
  } catch (e) {
    // 开始失败时清理孤儿 pending 比赛，避免重试重复创建
    if (created) {
      await invoke(IpcChannels.ContestsDelete, { id: created.id }).catch(() => undefined)
    }
    toast.error(e instanceof Error ? e.message : String(e))
  }
}

function startTicker(): void {
  if (timer) clearInterval(timer)
  timer = setInterval(() => {
    if (!contest.value?.startedAt) return
    const started = new Date(contest.value.startedAt.replace(' ', 'T')).getTime()
    const end = started + contest.value.durationMinutes * 60 * 1000
    remaining.value = Math.floor((end - Date.now()) / 1000)
    if (remaining.value <= 0 && view.value === 'running') {
      void finish(true)
    }
  }, 1000)
}

function latestStatus(problemId: string): ResultStatus | null {
  const subs = contest.value?.submissions.filter((s) => s.problemId === problemId) ?? []
  return subs.length > 0 ? subs[subs.length - 1].status : null
}

async function submit(problemId: string, status: ResultStatus): Promise<void> {
  if (!contest.value) return
  try {
    contest.value = await invoke<Contest>(IpcChannels.ContestsSubmit, {
      contestId: contest.value.id,
      problemId,
      status
    })
    if (status === 'AC') toast.success('AC! 通过本题')
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  }
}

async function finish(auto = false): Promise<void> {
  if (!contest.value) return
  if (finishing.value) return // 防止计时器重入
  if (!auto && !confirm('确定结束比赛？')) return
  finishing.value = true
  try {
    const r = await invoke<ContestResult>(IpcChannels.ContestsFinish, { id: contest.value.id })
    result.value = r
    contest.value = null
    if (timer) clearInterval(timer)
    await loadContests()
    view.value = 'result'
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  } finally {
    finishing.value = false
  }
}

async function viewHistoryResult(id: number): Promise<void> {
  try {
    result.value = await invoke<ContestResult>(IpcChannels.ContestsResult, { id })
    view.value = 'result'
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  }
}

async function loadContests(): Promise<void> {
  contests.value = await invoke<ContestListItem[]>(IpcChannels.ContestsList)
}

function fmtPenalty(s: number | null): string {
  if (s == null) return '—'
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}min ${String(sec).padStart(2, '0')}s`
}

function fmtDate(t: string | null): string {
  return t ? t.slice(0, 16) : '—'
}

function backToList(): void {
  result.value = null
  view.value = 'create'
}

onMounted(async () => {
  // 默认比赛时长来自设置（FR-7.1）
  try {
    const settings = await invoke<Record<string, string>>(IpcChannels.SettingsGetAll)
    const mins = Number(settings.defaultContestMinutes)
    if ([60, 90, 120, 180].includes(mins)) form.value.durationMinutes = mins
  } catch {
    // 使用默认值 120
  }
  await loadContests()
  if (!problemsStore.allTags.length) await problemsStore.loadTags()
  const running = contests.value.find((c) => c.status === 'running')
  if (running) {
    try {
      contest.value = await invoke<Contest>(IpcChannels.ContestsGet, { id: running.id })
      startTicker()
      view.value = 'running'
    } catch {
      view.value = 'create'
    }
  }
})

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div class="contests-page">
    <!-- 创建向导 -->
    <div v-if="view === 'create'" class="create-view">
      <div class="panel">
        <h3>创建虚拟比赛</h3>
        <div class="form-grid">
          <input v-model="form.name" class="input" placeholder="比赛名称，如：周末模拟赛" />
          <select v-model.number="form.durationMinutes" class="select">
            <option :value="60">60 分钟</option>
            <option :value="90">90 分钟</option>
            <option :value="120">120 分钟</option>
            <option :value="180">180 分钟</option>
          </select>
          <select v-model.number="form.count" class="select">
            <option :value="3">3 题</option>
            <option :value="5">5 题</option>
            <option :value="7">7 题</option>
            <option :value="10">10 题</option>
          </select>
          <input v-model.number="form.ratingMin" class="input w-100" type="number" placeholder="难度 ≥" />
          <input v-model.number="form.ratingMax" class="input w-100" type="number" placeholder="难度 ≤" />
        </div>
        <div v-if="groupedTags.length" class="tag-horz">
          <div class="dim small">知识点（可选，横向大类）：</div>
          <div class="tag-tabs">
            <button
              v-for="g in groupedTags"
              :key="g.category"
              class="seg-tab"
              :class="{ on: activeTagCat === g.category }"
              @click="activeTagCat = g.category"
            >
              {{ g.category }}
            </button>
          </div>
          <div class="tag-row">
            <button
              v-for="tag in activeGroupTags"
              :key="tag"
              class="chip"
              :class="{ on: form.tags.includes(tag) }"
              @click="toggleTag(tag)"
            >
              {{ tag }}
            </button>
          </div>
        </div>
        <div class="actions">
          <button class="btn primary" :disabled="generating" @click="generate()">
            {{ generating ? '生成中…' : '🎲 生成题单' }}
          </button>
          <button class="btn" :disabled="generated.length === 0" @click="createAndStart()">
            ▶ 创建并开始比赛
          </button>
        </div>
      </div>

      <!-- 生成的题单 -->
      <div v-if="generated.length" class="panel">
        <h3>生成的题单（按难度升序）</h3>
        <table class="table">
          <thead>
            <tr>
              <th>题号</th>
              <th>题目</th>
              <th>难度</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(p, i) in generated" :key="p.id">
              <td class="mono">{{ letters[i] }} · {{ p.id }}</td>
              <td>{{ p.name }}</td>
              <td class="mono">{{ p.rating }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 历史 -->
      <div class="panel">
        <h3>历史比赛</h3>
        <table v-if="contests.length" class="table">
          <thead>
            <tr>
              <th>名称</th>
              <th>时长</th>
              <th>状态</th>
              <th>AC</th>
              <th>开始时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in contests" :key="c.id">
              <td>{{ c.name }}</td>
              <td class="dim">{{ c.durationMinutes }}min</td>
              <td>
                <span class="badge" :class="c.status">{{ c.status }}</span>
              </td>
              <td class="mono">{{ c.solvedCount }}</td>
              <td class="dim">{{ fmtDate(c.startedAt) }}</td>
              <td>
                <button v-if="c.status === 'finished'" class="btn xs" @click="viewHistoryResult(c.id)">查看结果</button>
                <button v-else-if="c.status === 'running'" class="btn xs primary" @click="view = 'running'">继续</button>
                <span v-else class="dim">—</span>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else class="dim">暂无比赛记录</p>
      </div>
    </div>

    <!-- 比赛进行中 -->
    <div v-else-if="view === 'running' && contest" class="running-view">
      <div class="race-head">
        <div>
          <h3>{{ contest.name }}</h3>
          <span class="dim">剩 {{ remainingText }}</span>
        </div>
        <button class="btn danger" @click="finish()">结束比赛</button>
      </div>
      <table class="table">
        <thead>
          <tr>
            <th class="w-60">题</th>
            <th>题目</th>
            <th>难度</th>
            <th>状态</th>
            <th class="w-220">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="cp in contest.problems" :key="cp.position">
            <td class="mono">{{ letters[cp.position] }}</td>
            <td>
              <div>{{ cp.problem.name }}</div>
              <div class="dim small mono">{{ cp.problem.id }}</div>
            </td>
            <td class="mono">{{ cp.problem.rating ?? '—' }}</td>
            <td>
              <span v-if="latestStatus(cp.problem.id)" class="badge" :class="latestStatus(cp.problem.id)">
                {{ latestStatus(cp.problem.id) }}
              </span>
              <span v-else class="dim">未提交</span>
            </td>
            <td>
              <button class="btn xs primary" @click="submit(cp.problem.id, 'AC')">AC</button>
              <button class="btn xs" @click="submit(cp.problem.id, 'WA')">WA</button>
              <select class="select xs" @change="submit(cp.problem.id, ($event.target as HTMLSelectElement).value as ResultStatus)">
                <option value="">更多…</option>
                <option v-for="s in RESULT_STATUSES.filter((x) => x !== 'AC' && x !== 'WA' && x !== 'SKIP' && x !== 'UNSOLVED')" :key="s" :value="s">{{ s }}</option>
              </select>
              <button class="btn xs ghost" @click="openContestStatement(cp.problem.id)">📖 题面</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 结果 -->
    <div v-else-if="view === 'result' && result" class="result-view">
      <div class="panel">
        <h3>🏁 {{ result.contest.name }} —— 比赛结果</h3>
        <div class="result-cards">
          <div class="card">
            <div class="num">{{ result.solvedCount }} / {{ result.contest.problems.length }}</div>
            <div class="label">通过题数</div>
          </div>
          <div class="card">
            <div class="num">{{ fmtPenalty(result.totalPenaltySeconds) }}</div>
            <div class="label">总罚时</div>
          </div>
        </div>
        <table class="table">
          <thead>
            <tr>
              <th class="w-60">题</th>
              <th>题目</th>
              <th>结果</th>
              <th>AC 耗时</th>
              <th>错误次数</th>
              <th>罚时</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="b in result.breakdown" :key="b.position">
              <td class="mono">{{ letters[b.position] }}</td>
              <td>{{ result.contest.problems[b.position]?.problem.name }}</td>
              <td>
                <span v-if="b.status" class="badge" :class="b.status">{{ b.status }}</span>
                <span v-else class="dim">未提交</span>
              </td>
              <td class="mono">{{ b.acSeconds != null ? fmtPenalty(b.acSeconds) : '—' }}</td>
              <td class="mono">{{ b.wrongCount }}</td>
              <td class="mono">{{ fmtPenalty(b.penaltySeconds) }}</td>
            </tr>
          </tbody>
        </table>
        <button class="btn" @click="backToList()">返回</button>
      </div>
    </div>
  </div>

</template>

<style scoped>
.contests-page {
  padding: 16px 20px;
}
.panel {
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: 10px;
  padding: 16px 18px;
  margin-bottom: 14px;
}
.panel h3 {
  margin: 0 0 12px;
  font-size: 15px;
}
.form-grid {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.input,
.select {
  background: var(--bg-side);
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
.w-100 {
  width: 100px;
}
.select.xs {
  padding: 3px 6px;
  font-size: 12px;
}
.tag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  margin-bottom: 12px;
}
.tag-horz {
  display: flex;
  flex-direction: column;
  gap: 8px;
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
}
.seg-tab.on {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
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
.actions {
  display: flex;
  gap: 10px;
}
.btn {
  border: 1px solid var(--border);
  background: var(--bg-side);
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
.btn.danger {
  border-color: var(--danger);
  color: var(--danger);
  background: transparent;
}
.btn.xs {
  padding: 3px 9px;
  font-size: 12px;
  margin-right: 4px;
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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
  padding: 8px 10px;
  border-bottom: 1px solid #262638;
}
.w-60 {
  width: 60px;
}
.w-220 {
  width: 220px;
}
.badge {
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  border-radius: 4px;
  padding: 2px 8px;
  background: var(--text-faint);
}
.badge.AC,
.badge.finished {
  background: var(--success);
}
.badge.WA,
.badge.RE {
  background: var(--danger);
}
.badge.TLE,
.badge.MLE {
  background: var(--warning);
}
.badge.running {
  background: var(--primary);
}
.badge.pending {
  background: var(--text-faint);
}
.race-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.race-head h3 {
  margin: 0 0 4px;
}
.dim {
  color: var(--text-faint);
}
.small {
  font-size: 12px;
}
.mono {
  font-family: var(--mono);
}
.result-cards {
  display: flex;
  gap: 12px;
  margin-bottom: 12px;
}
.card {
  border: 1px solid var(--border);
  background: var(--bg);
  border-radius: 10px;
  padding: 14px 20px;
}
.num {
  font-size: 22px;
  font-weight: 700;
  font-family: var(--mono);
}
.label {
  color: var(--text-faint);
  font-size: 12px;
  margin-top: 4px;
}
</style>
