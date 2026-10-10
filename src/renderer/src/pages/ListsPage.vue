<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useListsStore } from '@/stores/lists'
import { useProblemsStore } from '@/stores/problems'
import { useToast } from '@/composables/useToast'
import { useStatementStore } from '@/stores/statement'
import { LUOGU_DIFFICULTY_LABELS, LEETCODE_DIFFICULTY_LABELS, REVIEW_EASE_LABELS } from '@shared/types'
import type { ReviewEase, ProblemRow } from '@shared/types'
import { SKILL_TRACKS, SKILL_TRACK_MAP } from '@shared/skill-tracks'

/**
 * 题单 / 今日复习 / 训练计划（v1.10 FR-27~FR-29）。
 * 三个 Tab 共用一份 store：题单是题目集合，复习挂在题单条目上，训练计划把题单（或抽题结果）排到日历。
 */

type Tab = 'lists' | 'review' | 'plans'
const tab = ref<Tab>('lists')

const lists = useListsStore()
const problemsStore = useProblemsStore()
const statement = useStatementStore()
const toast = useToast()

// ---------- 通用 ----------
function err(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function difficultyText(p: ProblemRow | null): string {
  if (!p) return '—'
  if (p.source === 'cf') return p.rating != null ? String(p.rating) : '—'
  if (p.source === 'luogu') return LUOGU_DIFFICULTY_LABELS[p.difficulty ?? 0] ?? '—'
  return LEETCODE_DIFFICULTY_LABELS[p.difficulty ?? 0] ?? '—'
}

async function openStatement(problemId: string): Promise<void> {
  try {
    const via = await statement.openStatement(problemId)
    toast.info(via === 'edge' ? '已在 Edge 中打开题面' : '已用默认浏览器打开题面（未检测到 Edge）')
  } catch (e) {
    toast.error(err(e))
  }
}

// ---------- 题单 ----------
const newListName = ref('')
const noteEditing = ref<{ listId: number; problemId: string; value: string } | null>(null)

const currentList = computed(() => lists.current?.list ?? null)

async function createList(): Promise<void> {
  const name = newListName.value.trim()
  if (!name) {
    toast.error('请输入题单名称')
    return
  }
  try {
    const list = await lists.createList(name)
    newListName.value = ''
    toast.success(`已创建题单「${list.name}」`)
  } catch (e) {
    toast.error(err(e))
  }
}

async function renameList(): Promise<void> {
  const cur = currentList.value
  if (!cur) return
  const name = window.prompt('题单名称', cur.name)
  if (name == null || !name.trim()) return
  try {
    await lists.renameList(cur.id, name.trim())
    toast.success('已重命名')
  } catch (e) {
    toast.error(err(e))
  }
}

async function deleteList(): Promise<void> {
  const cur = currentList.value
  if (!cur) return
  if (!window.confirm(`删除题单「${cur.name}」？（题目本身与练习记录不受影响）`)) return
  try {
    await lists.deleteList(cur.id)
    toast.success('已删除题单')
  } catch (e) {
    toast.error(err(e))
  }
}

// 粘贴识别
const pasteOpen = ref(false)
const pasteText = ref('')
const parseResult = ref<{ matchedIds: string[]; missing: string[] } | null>(null)
const pasteListName = ref('')

async function doParse(): Promise<void> {
  try {
    const r = await lists.parseText(pasteText.value)
    parseResult.value = { matchedIds: r.matchedIds, missing: r.missing }
    if (r.matchedIds.length === 0) toast.error('没有识别到题库中的题目；可检查题号/链接格式')
    else toast.success(`识别到 ${r.matchedIds.length} 道题（未命中 ${r.missing.length} 条）`)
  } catch (e) {
    toast.error(err(e))
  }
}

async function confirmPaste(): Promise<void> {
  // 注意：Vue 响应式 Proxy 无法通过 Electron IPC 结构化克隆 → 必须显式转纯数组
  const ids = [...(parseResult.value?.matchedIds ?? [])]
  if (ids.length === 0) return
  try {
    let targetId = currentList.value?.id ?? null
    if (!targetId) {
      const list = await lists.createList(pasteListName.value.trim() || `粘贴题单 ${lists.today}`)
      targetId = list.id
    }
    const added = await lists.addProblems(targetId, ids)
    pasteOpen.value = false
    pasteText.value = ''
    parseResult.value = null
    pasteListName.value = ''
    toast.success(`已加入 ${added} 道题到题单`)
  } catch (e) {
    toast.error(err(e))
  }
}

// 按知识点 + 难度生成
const genOpen = ref(false)
const genForm = ref({
  name: '',
  trackId: '',
  knowledgeIds: [] as string[],
  count: 10,
  source: 'all' as 'all' | 'cf' | 'luogu' | 'leetcode',
  ratingMin: null as number | null,
  ratingMax: null as number | null,
  difficultyMin: null as number | null,
  difficultyMax: null as number | null,
  excludePracticed: true
})

const genNodes = computed(() => problemsStore.skills)

function toggleGenNode(id: string): void {
  const set = new Set(genForm.value.knowledgeIds)
  if (set.has(id)) set.delete(id)
  else set.add(id)
  genForm.value.knowledgeIds = [...set]
}

function applyTrack(trackId: string): void {
  genForm.value.trackId = trackId
  const track = SKILL_TRACK_MAP.get(trackId)
  if (!track) return
  genForm.value.knowledgeIds = [...track.focus]
  genForm.value.ratingMin = track.ratingRange[0]
  genForm.value.ratingMax = track.ratingRange[1]
  genForm.value.name = genForm.value.name || `${track.name} 训练题单`
}

async function doGenerate(): Promise<void> {
  const f = genForm.value
  try {
    // 纯对象/纯数组：避免 Vue Proxy 过 IPC（structuredClone）失败
    const r = await lists.generate({
      name: f.name.trim() || `知识点题单 ${lists.today}`,
      knowledgeIds: [...f.knowledgeIds],
      count: Number(f.count) || 10,
      source: f.source,
      ratingMin: f.ratingMin,
      ratingMax: f.ratingMax,
      difficultyMin: f.difficultyMin,
      difficultyMax: f.difficultyMax,
      excludePracticed: f.excludePracticed,
      trackId: f.trackId || null
    })
    genOpen.value = false
    toast.success(`已生成题单：抽取 ${r.picked} 题（候选 ${r.candidates} 题）`)
  } catch (e) {
    toast.error(err(e))
  }
}

async function toggleDone(problemId: string, done: boolean): Promise<void> {
  const cur = currentList.value
  if (!cur) return
  try {
    await lists.setDone(cur.id, problemId, done)
    if (done) toast.success('已标记完成，并进入复习第 1 档（1 天后复习）')
  } catch (e) {
    toast.error(err(e))
  }
}

function startNote(listId: number, problemId: string, value: string): void {
  noteEditing.value = { listId, problemId, value }
}

async function saveNote(): Promise<void> {
  const edit = noteEditing.value
  if (!edit) return
  try {
    await lists.setNote(edit.listId, edit.problemId, edit.value)
    noteEditing.value = null
  } catch (e) {
    toast.error(err(e))
  }
}

async function removeItem(problemId: string): Promise<void> {
  const cur = currentList.value
  if (!cur) return
  try {
    await lists.removeItem(cur.id, problemId)
  } catch (e) {
    toast.error(err(e))
  }
}

// ---------- 今日复习 ----------
async function submitReview(listId: number, problemId: string, ease: ReviewEase): Promise<void> {
  try {
    await lists.review(listId, problemId, ease)
    toast.success(`已记录「${REVIEW_EASE_LABELS[ease]}」`)
  } catch (e) {
    toast.error(err(e))
  }
}

// ---------- 训练计划 ----------
const planForm = ref({
  name: '',
  listId: null as number | null,
  generateCount: 0,
  targetDate: '' as string,
  dailyTarget: 3,
  trackId: '',
  knowledgeIds: [] as string[],
  ratingMin: null as number | null,
  ratingMax: null as number | null,
  restWeekdays: [0] as number[],
  excludePracticed: true
})

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function toggleRest(day: number): void {
  const set = new Set(planForm.value.restWeekdays)
  if (set.has(day)) set.delete(day)
  else set.add(day)
  planForm.value.restWeekdays = [...set].sort()
}

function applyPlanTrack(trackId: string): void {
  planForm.value.trackId = trackId
  const track = SKILL_TRACK_MAP.get(trackId)
  if (!track) return
  planForm.value.knowledgeIds = [...track.focus]
  planForm.value.ratingMin = track.ratingRange[0]
  planForm.value.ratingMax = track.ratingRange[1]
  planForm.value.name = planForm.value.name || `${track.name} 训练计划`
}

async function doCreatePlan(): Promise<void> {
  const f = planForm.value
  if (!f.listId && f.generateCount <= 0) {
    toast.error('请选择一份题单，或填写自动抽题数量')
    return
  }
  try {
    // 纯对象/纯数组：避免 Vue Proxy 过 IPC（structuredClone）失败
    const r = await lists.createPlan({
      name: f.name.trim() || `训练计划 ${lists.today}`,
      listId: f.listId,
      generateCount: f.generateCount > 0 ? Number(f.generateCount) : undefined,
      targetDate: f.targetDate || null,
      dailyTarget: Number(f.dailyTarget) || 3,
      knowledgeIds: [...f.knowledgeIds],
      ratingMin: f.ratingMin,
      ratingMax: f.ratingMax,
      restWeekdays: [...f.restWeekdays],
      trackId: f.trackId || null,
      excludePracticed: f.excludePracticed
    })
    toast.success(
      r.overflow > 0
        ? `已排期 ${r.scheduled} 题；有 ${r.overflow} 题超出目标日期未排入（可放宽目标日期或提高每日题量）`
        : `已排期 ${r.scheduled} 题`
    )
  } catch (e) {
    toast.error(err(e))
  }
}

async function toggleTask(problemId: string): Promise<void> {
  const p = lists.currentPlan?.plan
  if (!p) return
  try {
    await lists.toggleTask(p.id, problemId)
  } catch (e) {
    toast.error(err(e))
  }
}

const busyInput = ref<{ date: string; reason: string }>({ date: '', reason: '' })

async function markBusy(): Promise<void> {
  const p = lists.currentPlan?.plan
  if (!p || !busyInput.value.date) {
    toast.error('请选择日期')
    return
  }
  try {
    await lists.markBusy(p.id, busyInput.value.date, busyInput.value.reason)
    toast.success('已标记没空，其后未完成任务已自动顺延')
    busyInput.value = { date: '', reason: '' }
  } catch (e) {
    toast.error(err(e))
  }
}

const planStats = computed(() => {
  const plan = lists.currentPlan?.plan
  return plan ? { total: plan.total, done: plan.doneCount } : { total: 0, done: 0 }
})

onMounted(async () => {
  lists.loading = true
  try {
    if (problemsStore.skills.length === 0) await problemsStore.loadSkills()
    await Promise.all([lists.loadLists(), lists.loadDue(), lists.loadPlans()])
    if (lists.lists.length > 0 && !lists.current) await lists.openList(lists.lists[0].id)
    if (lists.plans.length > 0 && !lists.currentPlan) await lists.openPlan(lists.plans[0].id)
  } catch (e) {
    toast.error(err(e))
  } finally {
    lists.loading = false
  }
})
</script>

<template>
  <div class="lists-page">
    <div class="head">
      <div class="tabs">
        <button class="seg" :class="{ on: tab === 'lists' }" @click="tab = 'lists'">📋 题单</button>
        <button class="seg" :class="{ on: tab === 'review' }" @click="tab = 'review'">
          🔁 今日复习
          <span v-if="lists.due.length" class="badge-due">{{ lists.due.length }}</span>
        </button>
        <button class="seg" :class="{ on: tab === 'plans' }" @click="tab = 'plans'">🗓️ 训练计划</button>
      </div>
    </div>

    <!-- ============ 题单 ============ -->
    <div v-if="tab === 'lists'" class="two-col">
      <div class="panel side">
        <h4>我的题单（{{ lists.lists.length }}）</h4>
        <div class="new-row">
          <input v-model="newListName" class="input" placeholder="新建题单名称…" @keyup.enter="createList()" />
          <button class="btn primary" @click="createList()">新建</button>
        </div>
        <ul class="list-items">
          <li
            v-for="l in lists.lists"
            :key="l.id"
            class="list-item"
            :class="{ on: currentList?.id === l.id }"
            @click="lists.openList(l.id)"
          >
            <div class="li-name">{{ l.name }}</div>
            <div class="li-meta dim small">
              {{ l.doneCount }}/{{ l.total }} 完成
              <span v-if="l.reviewCount"> · 复习 {{ l.reviewCount }}</span>
              <span v-if="l.dueCount" class="due"> · 待复习 {{ l.dueCount }}</span>
              <span v-if="l.trackId"> · {{ SKILL_TRACK_MAP.get(l.trackId)?.name }}</span>
            </div>
          </li>
          <li v-if="lists.lists.length === 0" class="dim small">还没有题单：右侧「粘贴识别」或「按知识点生成」都可以快速建一份。</li>
        </ul>
      </div>

      <div class="panel main">
        <div v-if="!currentList" class="empty">左侧新建或选择一份题单</div>
        <template v-else>
          <div class="list-head">
            <div>
              <h3>{{ currentList.name }}</h3>
              <p class="dim small">{{ currentList.description || '（无描述）' }}</p>
            </div>
            <div class="actions">
              <button class="btn" @click="renameList()">重命名</button>
              <button class="btn ghost danger" @click="deleteList()">删除题单</button>
            </div>
          </div>

          <div class="toolbar">
            <button class="btn" @click="pasteOpen = true">📋 粘贴题号识别</button>
            <button class="btn primary" @click="genOpen = true">✨ 按知识点+难度生成</button>
            <span class="dim small">也可在「题库」勾选多题后一键加入题单</span>
          </div>

          <table class="table">
            <thead>
              <tr>
                <th class="w-60">完成</th>
                <th class="w-110">题号</th>
                <th>题目</th>
                <th class="w-120">难度</th>
                <th class="w-170">复习</th>
                <th class="w-200">备注</th>
                <th class="w-120">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="it in lists.current?.items ?? []" :key="it.problemId">
                <td>
                  <input
                    type="checkbox"
                    :checked="it.done"
                    :title="it.done ? '取消完成' : '标记完成（自动进入复习第 1 档）'"
                    @change="toggleDone(it.problemId, ($event.target as HTMLInputElement).checked)"
                  />
                </td>
                <td class="mono">{{ it.problemId }}</td>
                <td>
                  <div>{{ it.problem?.name ?? '（本地题库缺失）' }}</div>
                  <div class="dim small">{{ it.problem?.tags.slice(0, 5).join(' · ') }}</div>
                </td>
                <td>{{ difficultyText(it.problem) }}</td>
                <td class="small">
                  <span v-if="it.reviewStage > 0">
                    第 {{ it.reviewStage }}/6 档 · 下次 {{ it.reviewDue }}
                    <span v-if="it.reviewEase" class="dim">（上次：{{ it.reviewEase }}）</span>
                  </span>
                  <span v-else class="dim">未进入复习</span>
                </td>
                <td>
                  <template v-if="noteEditing && noteEditing.problemId === it.problemId">
                    <input
                      v-model="noteEditing.value"
                      class="input"
                      @keyup.enter="saveNote()"
                      @blur="saveNote()"
                    />
                  </template>
                  <span
                    v-else
                    class="note-cell"
                    :class="{ dim: !it.note }"
                    @click="startNote(it.listId, it.problemId, it.note)"
                  >{{ it.note || '点击添加备注' }}</span>
                </td>
                <td>
                  <button class="btn xs" @click="openStatement(it.problemId)">题面</button>
                  <button class="btn xs ghost" @click="removeItem(it.problemId)">移除</button>
                </td>
              </tr>
              <tr v-if="(lists.current?.items.length ?? 0) === 0">
                <td colspan="7" class="dim">题单为空：用上面的两个按钮添加题目。</td>
              </tr>
            </tbody>
          </table>
        </template>
      </div>
    </div>

    <!-- ============ 今日复习 ============ -->
    <div v-else-if="tab === 'review'" class="panel">
      <div class="list-head">
        <div>
          <h3>今日待复习（{{ lists.due.length }}）</h3>
          <p class="dim small">
            题单里勾选完成的题目会自动进入 1/3/7/14/30/60 天阶梯；今天到期 {{ lists.due.length }} 道（本地日期 {{ lists.today }}）。
          </p>
        </div>
        <button class="btn" @click="lists.loadDue()">⟳ 刷新</button>
      </div>
      <table class="table">
        <thead>
          <tr>
            <th class="w-160">所属题单</th>
            <th class="w-110">题号</th>
            <th>题目</th>
            <th class="w-120">难度</th>
            <th class="w-140">档位 / 到期</th>
            <th class="w-260">本次复习反馈</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in lists.due" :key="`${r.listId}-${r.problemId}`">
            <td class="dim small">{{ r.listName }}</td>
            <td class="mono">{{ r.problemId }}</td>
            <td>{{ r.problem?.name ?? '—' }}</td>
            <td>{{ difficultyText(r.problem) }}</td>
            <td class="small">第 {{ r.reviewStage }}/6 档 · {{ r.reviewDue }}</td>
            <td>
              <button class="btn xs" title="提前重来（退一档）" @click="submitReview(r.listId, r.problemId, 'hard')">困难</button>
              <button class="btn xs primary" title="正常推进一档" @click="submitReview(r.listId, r.problemId, 'ok')">一般</button>
              <button class="btn xs" title="跳一档推进" @click="submitReview(r.listId, r.problemId, 'easy')">轻松</button>
              <button class="btn xs ghost" @click="openStatement(r.problemId)">题面</button>
            </td>
          </tr>
          <tr v-if="lists.due.length === 0">
            <td colspan="6" class="dim">今天没有到期复习。完成题单里的题目后，它们会自动排进复习队列。</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- ============ 训练计划 ============ -->
    <div v-else class="two-col">
      <div class="panel side">
        <h4>训练计划（{{ lists.plans.length }}）</h4>
        <ul class="list-items">
          <li
            v-for="p in lists.plans"
            :key="p.id"
            class="list-item"
            :class="{ on: lists.currentPlan?.plan.id === p.id }"
            @click="lists.openPlan(p.id)"
          >
            <div class="li-name">{{ p.name }}</div>
            <div class="li-meta dim small">
              {{ p.doneCount }}/{{ p.total }} 完成 · 每日 {{ p.dailyTarget }} 题
              <span v-if="p.targetDate"> · 目标 {{ p.targetDate }}</span>
            </div>
          </li>
          <li v-if="lists.plans.length === 0" class="dim small">还没有计划：右侧填一个题单或抽题数量就能排到日历上。</li>
        </ul>
      </div>

      <div class="panel main">
        <div class="list-head">
          <h3>新建训练计划</h3>
        </div>
        <div class="form-grid">
          <label class="fld">
            <span class="dim small">计划名称</span>
            <input v-model="planForm.name" class="input" placeholder="如：暑假冲 1600" />
          </label>
          <label class="fld">
            <span class="dim small">题目来源：题单</span>
            <select v-model="planForm.listId" class="select">
              <option :value="null">（不用题单，自动抽题）</option>
              <option v-for="l in lists.lists" :key="l.id" :value="l.id">{{ l.name }}（{{ l.total }} 题）</option>
            </select>
          </label>
          <label class="fld">
            <span class="dim small">自动抽题数量（不选题单时生效）</span>
            <input v-model.number="planForm.generateCount" class="input" type="number" min="0" max="200" />
          </label>
          <label class="fld">
            <span class="dim small">每日题量</span>
            <input v-model.number="planForm.dailyTarget" class="input" type="number" min="1" max="20" />
          </label>
          <label class="fld">
            <span class="dim small">目标日期（可留空）</span>
            <input v-model="planForm.targetDate" class="input" type="date" />
          </label>
          <label class="fld">
            <span class="dim small">赛道预设（自动填知识点与难度）</span>
            <select :value="planForm.trackId" class="select" @change="applyPlanTrack(($event.target as HTMLSelectElement).value)">
              <option value="">（不套用）</option>
              <option v-for="t in SKILL_TRACKS" :key="t.id" :value="t.id">{{ t.name }}</option>
            </select>
          </label>
          <label class="fld">
            <span class="dim small">难度区间（CF rating，自动抽题用）</span>
            <div class="range">
              <input v-model.number="planForm.ratingMin" class="input w-90" type="number" placeholder="≥" />
              <span class="dim">—</span>
              <input v-model.number="planForm.ratingMax" class="input w-90" type="number" placeholder="≤" />
            </div>
          </label>
          <div class="fld">
            <span class="dim small">每周固定休息日（不排任务）</span>
            <div class="chips">
              <button
                v-for="(d, i) in WEEKDAYS"
                :key="d"
                class="chip"
                :class="{ on: planForm.restWeekdays.includes(i) }"
                @click="toggleRest(i)"
              >
                {{ d }}
              </button>
            </div>
          </div>
          <label class="fld check">
            <input v-model="planForm.excludePracticed" type="checkbox" />
            <span class="dim small">排除已练过的题</span>
          </label>
        </div>
        <div class="actions">
          <button class="btn primary" @click="doCreatePlan()">生成并排期</button>
          <span class="dim small">知识点来自赛道预设；也可先在「题单」里用「按知识点生成」建好题单再选它。</span>
        </div>

        <template v-if="lists.currentPlan">
          <hr />
          <div class="list-head">
            <div>
              <h3>{{ lists.currentPlan.plan.name }}</h3>
              <p class="dim small">
                进度 {{ planStats.done }}/{{ planStats.total }} ·
                目标 {{ lists.currentPlan.plan.targetDate || '未设' }} ·
                休息日 {{ lists.currentPlan.plan.restWeekdays.map((d) => WEEKDAYS[d]).join('、') || '无' }}
              </p>
            </div>
            <button class="btn ghost danger" @click="lists.deletePlan(lists.currentPlan!.plan.id)">删除计划</button>
          </div>

          <div class="busy-row">
            <input v-model="busyInput.date" class="input w-140" type="date" />
            <input v-model="busyInput.reason" class="input" placeholder="没空原因（选填，如：期中考试）" />
            <button class="btn" @click="markBusy()">标记这天没空（自动顺延）</button>
            <button class="btn ghost" @click="lists.reschedule(lists.currentPlan!.plan.id)">重新排期</button>
          </div>
          <p v-if="lists.currentPlan.plan.busyDays.length" class="dim small">
            已标记没空：
            <span v-for="b in lists.currentPlan.plan.busyDays" :key="b.date" class="busy-tag">
              {{ b.date }}<span v-if="b.reason">（{{ b.reason }}）</span>
              <button class="x" title="取消标记" @click="lists.unmarkBusy(lists.currentPlan!.plan.id, b.date)">✕</button>
            </span>
          </p>

          <div class="calendar">
            <div v-for="day in lists.currentPlan.days" :key="day.date" class="day" :class="{ busy: day.busy }">
              <div class="day-head">
                <span class="mono">{{ day.date }}</span>
                <span class="dim small">
                  {{ day.tasks.filter((t) => t.status === 'done').length }}/{{ day.tasks.length }}
                  <span v-if="day.busy">· 没空{{ day.reason ? `（${day.reason}）` : '' }}</span>
                </span>
              </div>
              <div
                v-for="t in day.tasks"
                :key="t.problemId"
                class="task"
                :class="{ done: t.status === 'done' }"
              >
                <input
                  type="checkbox"
                  :checked="t.status === 'done'"
                  @change="toggleTask(t.problemId)"
                />
                <span class="mono pid">{{ t.problemId }}</span>
                <span class="tname">{{ t.problem?.name ?? '' }}</span>
                <span class="dim small">{{ difficultyText(t.problem) }}</span>
                <button class="btn xs ghost" @click="openStatement(t.problemId)">题面</button>
              </div>
            </div>
            <p v-if="lists.currentPlan.days.length === 0" class="dim">该计划还没有任务。</p>
          </div>
        </template>
      </div>
    </div>

    <!-- ============ 弹窗：粘贴识别 ============ -->
    <div v-if="pasteOpen" class="modal-mask" @click.self="pasteOpen = false">
      <div class="modal">
        <h3>粘贴题号 / 链接识别</h3>
        <p class="dim small">
          支持混排：`1741A`、`CF 1741 A`、`P3374`、`洛谷 P1000`、`LC1`，以及三类题面链接。会自动去重并与本地题库匹配。
        </p>
        <textarea v-model="pasteText" class="textarea" rows="7" placeholder="粘贴错题列表 / 题号清单 / 题面链接…"></textarea>
        <div class="modal-actions">
          <input v-model="pasteListName" class="input" placeholder="新题单名称（未选中题单时使用）" />
          <button class="btn" @click="doParse()">识别</button>
          <button class="btn primary" :disabled="!parseResult || parseResult.matchedIds.length === 0" @click="confirmPaste()">
            加入题单（{{ parseResult?.matchedIds.length ?? 0 }} 题）
          </button>
          <button class="btn ghost" @click="pasteOpen = false">取消</button>
        </div>
        <div v-if="parseResult" class="parse-result">
          <p class="small">
            命中 <b>{{ parseResult.matchedIds.length }}</b> 题；未匹配 <b>{{ parseResult.missing.length }}</b> 条
            <span v-if="parseResult.missing.length" class="dim">（{{ parseResult.missing.slice(0, 12).join('、') }}…）</span>
          </p>
          <p class="dim small">命中题号：{{ parseResult.matchedIds.slice(0, 40).join('、') }}</p>
        </div>
      </div>
    </div>

    <!-- ============ 弹窗：按知识点生成 ============ -->
    <div v-if="genOpen" class="modal-mask" @click.self="genOpen = false">
      <div class="modal wide">
        <h3>按知识点 + 难度生成题单</h3>
        <div class="form-grid">
          <label class="fld">
            <span class="dim small">题单名称</span>
            <input v-model="genForm.name" class="input" placeholder="如：蓝桥杯冲刺 · 动态规划" />
          </label>
          <label class="fld">
            <span class="dim small">赛道预设（一键选中该比赛重点节点）</span>
            <select :value="genForm.trackId" class="select" @change="applyTrack(($event.target as HTMLSelectElement).value)">
              <option value="">（不套用）</option>
              <option v-for="t in SKILL_TRACKS" :key="t.id" :value="t.id">{{ t.name }}</option>
            </select>
          </label>
          <label class="fld">
            <span class="dim small">题量</span>
            <input v-model.number="genForm.count" class="input" type="number" min="1" max="100" />
          </label>
          <label class="fld">
            <span class="dim small">数据源</span>
            <select v-model="genForm.source" class="select">
              <option value="all">全部</option>
              <option value="cf">Codeforces</option>
              <option value="luogu">洛谷</option>
              <option value="leetcode">力扣</option>
            </select>
          </label>
          <label class="fld">
            <span class="dim small">CF rating 区间</span>
            <div class="range">
              <input v-model.number="genForm.ratingMin" class="input w-90" type="number" placeholder="≥" />
              <span class="dim">—</span>
              <input v-model.number="genForm.ratingMax" class="input w-90" type="number" placeholder="≤" />
            </div>
          </label>
          <label class="fld">
            <span class="dim small">洛谷/力扣难度区间</span>
            <div class="range">
              <input v-model.number="genForm.difficultyMin" class="input w-90" type="number" placeholder="≥" />
              <span class="dim">—</span>
              <input v-model.number="genForm.difficultyMax" class="input w-90" type="number" placeholder="≤" />
            </div>
          </label>
          <label class="fld check">
            <input v-model="genForm.excludePracticed" type="checkbox" />
            <span class="dim small">排除已练过的题</span>
          </label>
        </div>

        <p class="dim small">选择知识点（已选 {{ genForm.knowledgeIds.length }} 个；不选则无法生成）：</p>
        <div class="node-picker">
          <button
            v-for="n in genNodes"
            :key="n.id"
            class="chip"
            :class="{ on: genForm.knowledgeIds.includes(n.id) }"
            @click="toggleGenNode(n.id)"
          >
            {{ n.name }}
          </button>
        </div>

        <div class="modal-actions">
          <button class="btn primary" @click="doGenerate()">生成题单</button>
          <button class="btn ghost" @click="genOpen = false">取消</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lists-page {
  padding: 16px 20px 40px;
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.tabs {
  display: flex;
  gap: 8px;
}
.seg {
  border: 1px solid var(--border);
  background: var(--bg-side);
  color: var(--text-dim);
  border-radius: 8px;
  padding: 6px 14px;
  font-size: 13px;
  cursor: pointer;
}
.seg.on {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}
.badge-due {
  display: inline-block;
  margin-left: 6px;
  background: #e34c39;
  color: #fff;
  border-radius: 9px;
  padding: 0 6px;
  font-size: 11px;
}
.two-col {
  display: grid;
  grid-template-columns: 300px 1fr;
  gap: 12px;
  align-items: start;
}
.panel {
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: 10px;
  padding: 14px 16px;
}
.panel h4 {
  margin: 0 0 10px;
  font-size: 13px;
  color: var(--text-dim);
}
.new-row {
  display: flex;
  gap: 6px;
  margin-bottom: 10px;
}
.list-items {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 560px;
  overflow: auto;
}
.list-item {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 10px;
  cursor: pointer;
}
.list-item.on {
  border-color: var(--primary);
  background: #1e90ff14;
}
.li-name {
  font-size: 13px;
  font-weight: 600;
}
.due {
  color: #e34c39;
}
.list-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.list-head h3 {
  margin: 0 0 4px;
  font-size: 15px;
}
.actions {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
  margin: 8px 0;
}
.toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  margin: 8px 0 12px;
}
.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.table th,
.table td {
  border-bottom: 1px solid var(--border);
  padding: 6px 8px;
  text-align: left;
  vertical-align: middle;
}
.mono {
  font-family: var(--mono);
}
.small {
  font-size: 12px;
}
.dim {
  color: var(--text-faint);
}
.note-cell {
  cursor: pointer;
  display: inline-block;
  min-width: 90px;
}
.w-60 {
  width: 60px;
}
.w-90 {
  width: 90px;
}
.w-110 {
  width: 110px;
}
.w-120 {
  width: 120px;
}
.w-140 {
  width: 140px;
}
.w-160 {
  width: 160px;
}
.w-170 {
  width: 170px;
}
.w-200 {
  width: 200px;
}
.w-260 {
  width: 260px;
}
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 14px;
}
.fld {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.fld.check {
  flex-direction: row;
  align-items: center;
  gap: 6px;
}
.range {
  display: flex;
  align-items: center;
  gap: 6px;
}
.chips {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
.chip {
  border: 1px solid var(--border);
  background: var(--bg-side);
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
.busy-row {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  margin: 10px 0;
}
.busy-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 1px 8px;
  margin-right: 6px;
}
.busy-tag .x {
  border: none;
  background: transparent;
  color: var(--text-faint);
  cursor: pointer;
}
.calendar {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 10px;
  margin-top: 10px;
}
.day {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 10px;
}
.day.busy {
  border-color: #e34c3966;
  background: #e34c3910;
}
.day-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
  font-size: 12px;
}
.task {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 0;
  font-size: 12px;
}
.task.done .tname {
  text-decoration: line-through;
  color: var(--text-faint);
}
.task .pid {
  color: var(--text-faint);
}
.task .tname {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: #00000088;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}
.modal {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 18px 20px;
  width: 560px;
  max-width: 92vw;
  max-height: 86vh;
  overflow: auto;
}
.modal.wide {
  width: 780px;
}
.modal h3 {
  margin: 0 0 8px;
  font-size: 15px;
}
.modal-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  margin-top: 12px;
}
.textarea {
  width: 100%;
  box-sizing: border-box;
  background: var(--bg-side);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px;
  font-family: var(--mono);
  font-size: 12px;
}
.parse-result {
  margin-top: 10px;
}
.node-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 8px 0;
  max-height: 220px;
  overflow: auto;
}
.btn {
  border: 1px solid var(--border);
  background: var(--bg-side);
  color: var(--text);
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 13px;
  cursor: pointer;
}
.btn.primary {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}
.btn.ghost {
  background: transparent;
}
.btn.danger {
  color: #e34c39;
  border-color: #e34c3966;
}
.btn.xs {
  padding: 2px 8px;
  font-size: 12px;
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.input,
.select {
  background: var(--bg-side);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 13px;
}
.empty {
  color: var(--text-faint);
  text-align: center;
  padding: 48px 0;
}
hr {
  border: none;
  border-top: 1px solid var(--border);
  margin: 16px 0;
}
</style>
