<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { invoke } from '@/api/ipc'
import { useUserStore } from '@/stores/user'
import { IpcChannels } from '@shared/channels'
import { PRACTICED_ORDER_LABELS, FRESH_ORDER_LABELS } from '@shared/types'
import type {
  PracticeRecord,
  PracticeState,
  RatingBreakdown,
  RatingSnapshot,
  RecommendResult,
  RecommendedProblem,
  StatsResult,
  TagUsage
} from '@shared/types'

const user = useUserStore()
const router = useRouter()
const stats = ref<StatsResult | null>(null)
const rating = ref<(RatingBreakdown & { history: RatingSnapshot[] }) | null>(null)
const recent = ref<PracticeRecord[]>([])
const loading = ref(true)

// v1.14 FR-31~FR-33: 推荐习题 + 已练习标签
const rec = ref<RecommendResult | null>(null)
const recLoading = ref(false)
const tags = ref<TagUsage[]>([])
const showTags = ref(true)
/** 已练习部分的知识点标签筛选 */
const selectedTags = ref<string[]>([])

/** 当前生效的推荐方式短标签 */
const practicedOrderText = computed(() =>
  rec.value ? (PRACTICED_ORDER_LABELS[rec.value.practicedOrder] ?? '').split('（')[0] : ''
)
const freshOrderText = computed(() =>
  rec.value ? (FRESH_ORDER_LABELS[rec.value.freshOrder] ?? '').split('（')[0] : ''
)

/** 已练习标签：只展示知识点关联的标签，已 AC 的排在前面 */
const practicedTagChips = computed(() => tags.value.filter((t) => t.acProblems > 0))
const untouchedTagChips = computed(() => tags.value.filter((t) => t.acProblems === 0 && t.attempted > 0))

async function loadRecommend(): Promise<void> {
  recLoading.value = true
  try {
    rec.value = await invoke<RecommendResult>(IpcChannels.RecommendGet, {
      filterTags: [...selectedTags.value]
    })
  } catch {
    rec.value = null
  } finally {
    recLoading.value = false
  }
}

async function loadTags(): Promise<void> {
  try {
    const [list, all] = await Promise.all([
      invoke<TagUsage[]>(IpcChannels.StatsTagUsage),
      invoke<Record<string, string>>(IpcChannels.SettingsGetAll)
    ])
    tags.value = list
    showTags.value = all.recommendShowTags !== 'false'
  } catch {
    tags.value = []
  }
}

function toggleTag(tag: string): void {
  const i = selectedTags.value.indexOf(tag)
  if (i >= 0) selectedTags.value.splice(i, 1)
  else selectedTags.value.push(tag)
  void loadRecommend()
}

function clearTags(): void {
  selectedTags.value = []
  void loadRecommend()
}

/** 跳题库并按题号定位 */
function gotoProblem(p: RecommendedProblem): void {
  void router.push({ path: '/problems', query: { q: p.problem.id } })
}

const stateLabel: Record<PracticeState, string> = {
  done: '已 AC',
  trying: '未通过',
  undone: '未练习'
}
const stateClass: Record<PracticeState, string> = {
  done: 'st-done',
  trying: 'st-trying',
  undone: 'st-undone'
}

onMounted(async () => {
  if (!user.loaded) void user.load()
  try {
    const [s, r, rec2] = await Promise.all([
      invoke<StatsResult>(IpcChannels.RecordsStats, { days: 30 }),
      invoke<RatingBreakdown & { history: RatingSnapshot[] }>(IpcChannels.RatingGet).catch(() => null),
      invoke<{ total: number; items: PracticeRecord[] }>(IpcChannels.RecordsList, {
        page: 1,
        pageSize: 8
      })
    ])
    stats.value = s
    rating.value = r
    recent.value = rec2.items
  } finally {
    loading.value = false
  }
  void loadRecommend()
  void loadTags()
})

const statusColor: Record<string, string> = {
  AC: '#3cb371',
  WA: '#ff6347',
  TLE: '#ffa500',
  RE: '#ff6347',
  MLE: '#ffa500',
  CE: '#a6adc8'
}
</script>

<template>
  <div class="dash-page">
    <h2 v-if="user.name" class="greeting">你好，{{ user.name }} 👋</h2>
    <div v-if="loading" class="empty">加载中…</div>
    <template v-else>
      <!-- 概览 -->
      <div class="cards">
        <div class="card">
          <div class="num">{{ stats?.totalAttempts ?? 0 }}</div>
          <div class="label">近 30 天提交</div>
        </div>
        <div class="card">
          <div class="num success">{{ stats?.acCount ?? 0 }}</div>
          <div class="label">近 30 天 AC</div>
        </div>
        <div class="card">
          <div class="num">{{ stats?.accuracy ?? '—' }}%</div>
          <div class="label">通过率</div>
        </div>
        <div class="card">
          <div class="num">{{ stats?.distinctProblems ?? 0 }}</div>
          <div class="label">练习题目数</div>
        </div>
      </div>

      <!-- 水平评估 -->
      <div v-if="rating" class="panel rating-card">
        <div class="rating-info">
          <span class="dim">当前训练水平（CF）：</span>
          <span class="rating-num" :style="{ color: rating.color ?? '#fff' }">
            {{ rating.finalRating ?? '—' }}
          </span>
          <span class="title" :style="{ color: rating.color ?? '#6c7086' }">{{ rating.title ?? '暂无' }}</span>
          <span v-if="rating.luogu && rating.luogu.attemptCount > 0" class="luogu-ref">
            洛谷参考：<b>{{ rating.luogu.rating ?? '—' }}</b>
            <span class="dim">（{{ rating.luogu.acCount }}/{{ rating.luogu.attemptCount }} AC）</span>
          </span>
        </div>
        <p class="dim small">综合 = 0.7×CF练习分 + 0.3×比赛分（本地参考值）；洛谷练习分为独立参考，不并入</p>
      </div>

      <!-- 已练习标签（v1.14 FR-32） -->
      <div v-if="showTags && practicedTagChips.length" class="panel tag-panel">
        <div class="panel-head">
          <h4>已练习标签</h4>
          <span class="dim small">
            共 {{ practicedTagChips.length }} 个知识点标签已练过（点标签可筛选下方推荐）
          </span>
          <button v-if="selectedTags.length" class="btn ghost mini" @click="clearTags">
            清空筛选（{{ selectedTags.length }}）
          </button>
        </div>
        <div class="tag-chips">
          <button
            v-for="t in practicedTagChips"
            :key="t.tag"
            class="tag-chip"
            :class="{ on: selectedTags.includes(t.tag), weak: t.progress < 0.1 }"
            :title="`题库 ${t.totalProblems} 题 · 已练 ${t.attempted} · 已 AC ${t.acProblems}`"
            :data-tag="t.tag"
            @click="toggleTag(t.tag)"
          >
            {{ t.tag }}
            <span class="cnt">{{ t.acProblems }}/{{ t.totalProblems }}</span>
          </button>
          <span v-if="untouchedTagChips.length" class="dim small untouched">
            另有 {{ untouchedTagChips.length }} 个标签练习过但未 AC
          </span>
        </div>
      </div>

      <!-- 推荐习题（v1.14 FR-31） -->
      <div class="panel rec-panel" data-panel="recommend">
        <div class="panel-head">
          <h4>推荐习题</h4>
          <span v-if="selectedTags.length" class="filter-hint">筛选：{{ selectedTags.join(' / ') }}</span>
          <span class="grow" />
          <button class="btn ghost mini" :disabled="recLoading" @click="loadRecommend">
            {{ recLoading ? '刷新中…' : '换一批' }}
          </button>
          <button class="btn ghost mini" @click="router.push('/settings?panel=recommend')">推荐设置</button>
        </div>

        <div v-if="!rec" class="dim small">暂无推荐数据</div>
        <div v-else class="rec-grid">
          <section class="rec-col" data-rec="practiced">
            <header>
              <b>已练习</b>
              <span class="dim small">{{ practicedOrderText }} · {{ rec.totals.practiced }} 道可复习</span>
            </header>
            <ul v-if="rec.practiced.length" class="rec-items">
              <li v-for="p in rec.practiced" :key="p.problem.id" class="rec-item" @click="gotoProblem(p)">
                <span class="mono pid">{{ p.problem.id }}</span>
                <span class="pname">{{ p.problem.name }}</span>
                <span class="state" :class="stateClass[p.state]">{{ stateLabel[p.state] }}</span>
                <span v-if="p.problem.rating" class="rating">{{ p.problem.rating }}</span>
                <span class="reason" :class="{ urgent: p.dueReview || p.urgency >= 0.5 }">{{ p.reason.text }}</span>
                <span v-if="p.listNames.length" class="in-list" :title="p.listNames.join(' / ')">📋</span>
              </li>
            </ul>
            <p v-else class="dim small">
              {{ selectedTags.length ? '该标签下还没有练习过的题目' : '还没有练习记录' }}
            </p>
          </section>

          <section class="rec-col" data-rec="fresh">
            <header>
              <b>未练习</b>
              <span class="dim small">{{ freshOrderText }} · {{ rec.totals.fresh }} 道待练</span>
            </header>
            <ul v-if="rec.fresh.length" class="rec-items">
              <li v-for="p in rec.fresh" :key="p.problem.id" class="rec-item" @click="gotoProblem(p)">
                <span class="mono pid">{{ p.problem.id }}</span>
                <span class="pname">{{ p.problem.name }}</span>
                <span v-if="p.problem.rating" class="rating">{{ p.problem.rating }}</span>
                <span class="reason">{{ p.reason.text }}</span>
              </li>
            </ul>
            <p v-else class="dim small">题库中没有符合条件的未练习题目</p>
          </section>
        </div>
      </div>

      <!-- 最近记录 -->
      <div class="panel">
        <h4>最近练习</h4>
        <ul v-if="recent.length" class="rec-list">
          <li v-for="r in recent" :key="r.id">
            <span class="badge" :style="{ background: statusColor[r.status] ?? '#6c7086' }">{{ r.status }}</span>
            <span class="mono dim">{{ r.problemId }}</span>
            <span class="dim">{{ r.createdAt.slice(5, 16) }}</span>
            <span v-if="r.isMistake" class="mini-tag">错题</span>
          </li>
        </ul>
        <p v-else class="dim">还没有练习记录，去「题库」开始刷题吧！</p>
      </div>
    </template>
  </div>
</template>

<style scoped>
.dash-page {
  padding: 16px 20px;
}
.greeting {
  font-size: 18px;
  margin: 0 0 12px;
}
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px;
  margin-bottom: 14px;
}
.card {
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: 10px;
  padding: 16px;
}
.num {
  font-size: 26px;
  font-weight: 700;
  font-family: var(--mono);
}
.num.success {
  color: var(--success);
}
.label {
  color: var(--text-faint);
  font-size: 12px;
  margin-top: 4px;
}
.panel {
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: 10px;
  padding: 14px 16px;
  margin-bottom: 14px;
}
.panel h4 {
  margin: 0 0 10px;
  font-size: 13px;
  color: var(--text-dim);
}
.panel-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}
.panel-head h4 {
  margin: 0;
}
.panel-head .grow {
  flex: 1;
}
/* 已练习标签 */
.tag-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.tag-chip {
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-dim);
  border-radius: 12px;
  padding: 3px 9px;
  font-size: 12px;
  cursor: pointer;
  display: inline-flex;
  gap: 5px;
  align-items: center;
  transition: all 0.12s;
}
.tag-chip:hover {
  border-color: var(--primary);
  color: var(--text);
}
.tag-chip.on {
  border-color: var(--primary);
  color: #fff;
  background: rgba(75, 107, 251, 0.28);
}
.tag-chip.weak {
  border-style: dashed;
}
.tag-chip .cnt {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text-faint);
}
.untouched {
  margin-left: 4px;
}
.filter-hint {
  font-size: 12px;
  color: var(--primary);
}
/* 推荐两列 */
.rec-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
@media (max-width: 1100px) {
  .rec-grid {
    grid-template-columns: 1fr;
  }
}
.rec-col header {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 6px;
  font-size: 13px;
}
.rec-items {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.rec-item {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 12.5px;
  padding: 4px 6px;
  border-radius: 6px;
  cursor: pointer;
}
.rec-item:hover {
  background: var(--bg);
}
.pid {
  color: var(--text-faint);
  min-width: 62px;
  flex: none;
}
.pname {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.state {
  font-size: 11px;
  border-radius: 4px;
  padding: 1px 6px;
  flex: none;
}
.st-done {
  color: var(--success);
  border: 1px solid var(--success);
}
.st-trying {
  color: var(--warning);
  border: 1px solid var(--warning);
}
.st-undone {
  color: var(--text-faint);
  border: 1px solid var(--border);
}
.rating {
  font-family: var(--mono);
  font-size: 11.5px;
  color: #cba6f7;
  flex: none;
}
.reason {
  font-size: 11px;
  color: var(--text-faint);
  flex: none;
  max-width: 130px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.reason.urgent {
  color: var(--warning);
}
.in-list {
  font-size: 11px;
  flex: none;
}
.mini {
  font-size: 12px;
  padding: 2px 8px;
}
.rating-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.rating-info {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.luogu-ref {
  border: 1px solid #e34c3944;
  color: #e34c39;
  border-radius: 12px;
  padding: 3px 10px;
  font-size: 12.5px;
}
.luogu-ref b {
  font-family: var(--mono);
}
.rating-num {
  font-size: 26px;
  font-weight: 800;
  font-family: var(--mono);
}
.title {
  font-weight: 600;
}
.rec-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.rec-list li {
  display: flex;
  gap: 10px;
  align-items: center;
  font-size: 13px;
}
.badge {
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  border-radius: 4px;
  padding: 2px 8px;
}
.mini-tag {
  font-size: 11px;
  color: var(--warning);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 2px 8px;
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
.empty {
  color: var(--text-faint);
  text-align: center;
  padding: 48px 0;
}
</style>
