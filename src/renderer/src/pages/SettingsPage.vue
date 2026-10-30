<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { invoke } from '@/api/ipc'
import { useToast } from '@/composables/useToast'
import { useUserStore } from '@/stores/user'
import { IpcChannels } from '@shared/channels'
import { FRESH_ORDER_LABELS, PRACTICED_ORDER_LABELS } from '@shared/types'
import { useRoute } from 'vue-router'

interface ExportResult {
  canceled: boolean
  path?: string
  counts?: { table: string; count: number }[]
}

const toast = useToast()
const user = useUserStore()
const route = useRoute()
const settings = ref<Record<string, string>>({})
const loaded = ref(false)
const saving = ref(false)
const importing = ref(false)
const exporting = ref(false)
const lastBackup = ref('')

// 评估权值 / 洛谷映射（v1.4：初始值维持现状 0.7/0.3 与 900~2300）
const weightP = ref(0.7)
const weightC = ref(0.3)
const diffInputs = ref<Record<number, string>>({ 1: '900', 2: '1100', 3: '1300', 4: '1500', 5: '1750', 6: '2050', 7: '2300' })

const DEFAULT_WEIGHTS = '{"practice":0.7,"contest":0.3}'
const DEFAULT_DIFF = '{"1":900,"2":1100,"3":1300,"4":1500,"5":1750,"6":2050,"7":2300}'

function parseJson(v: string | undefined, fallback: Record<string, unknown>): Record<string, unknown> {
  if (!v) return fallback
  try {
    return JSON.parse(v) as Record<string, unknown>
  } catch {
    return fallback
  }
}

function syncFromSettings(): void {
  const w = parseJson(settings.value.ratingWeights, { practice: 0.7, contest: 0.3 })
  weightP.value = typeof w.practice === 'number' ? w.practice : 0.7
  weightC.value = typeof w.contest === 'number' ? w.contest : 0.3
  const m = parseJson(settings.value.luoguDiffRatings, {})
  for (let d = 1; d <= 7; d++) {
    const v = m[d]
    diffInputs.value[d] = typeof v === 'number' ? String(v) : String(DEFAULT_DIFF_VALUES[d])
  }
  const lm = parseJson(settings.value.leetcodeDiffRatings, {})
  for (let d = 1; d <= 3; d++) {
    const v = lm[d]
    lcDiffInputs.value[d] = typeof v === 'number' ? String(v) : String(DEFAULT_LC_DIFF_VALUES[d])
  }
}

const DEFAULT_DIFF_VALUES: Record<number, number> = { 1: 900, 2: 1100, 3: 1300, 4: 1500, 5: 1750, 6: 2050, 7: 2300 }

/** v1.9 FR-23：力扣难度映射（默认 简单1000 / 中等1500 / 困难2000） */
const LC_DIFF_NAMES: Record<number, string> = { 1: '简单', 2: '中等', 3: '困难' }
const DEFAULT_LC_DIFF_VALUES: Record<number, number> = { 1: 1000, 2: 1500, 3: 2000 }
const lcDiffInputs = ref<Record<number, string>>({ 1: '1000', 2: '1500', 3: '2000' })

async function load(): Promise<void> {
  try {
    const fresh = await invoke<Record<string, string>>(IpcChannels.SettingsGetAll)
    // 合并而非整体覆盖，避免与用户 set() 竞态回滚已保存的值
    settings.value = { ...settings.value, ...fresh }
    syncFromSettings()
  } finally {
    loaded.value = true
  }
}

async function set(key: string, value: string): Promise<void> {
  saving.value = true
  try {
    await invoke(IpcChannels.SettingsSet, { key, value })
    settings.value[key] = value
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  } finally {
    saving.value = false
  }
}

function setRecommendLimit(key: string, raw: string): void {
  const n = Math.max(1, Math.min(30, Math.round(Number(raw) || 8)))
  void set(key, String(n))
}

function saveWeights(): void {
  const p = Number(weightP.value)
  const c = Number(weightC.value)
  if (!Number.isFinite(p) || !Number.isFinite(c) || p < 0 || c < 0 || p + c <= 0) {
    toast.error('权值需为非负数字且至少一个大于 0（如 0.7 与 0.3）')
    return
  }
  void set('ratingWeights', JSON.stringify({ practice: p, contest: c }))
  toast.success('评估权值已保存（重新计算评估后生效）')
}

/** 互补联动：修改一项时另一项自动 = 1 − 该项（两值和恒为 1） */
function onWeightInput(key: 'practice' | 'contest', e: Event): void {
  const v = Number((e.target as HTMLInputElement).value)
  if (!Number.isFinite(v)) return
  const clamped = Math.min(1, Math.max(0, v))
  const other = Math.round((1 - clamped) * 100) / 100
  if (key === 'practice') {
    weightP.value = clamped
    weightC.value = other
  } else {
    weightC.value = clamped
    weightP.value = other
  }
}

function resetWeights(): void {
  weightP.value = 0.7
  weightC.value = 0.3
  void set('ratingWeights', DEFAULT_WEIGHTS)
  toast.success('已恢复默认权值 0.7 / 0.3')
}

function saveDiffMap(): void {
  const out: Record<number, number> = {}
  for (let d = 1; d <= 7; d++) {
    const v = Number(diffInputs.value[d])
    if (!Number.isInteger(v) || v < 800 || v > 3500) {
      toast.error(`难度 ${d} 的映射分值需为 800~3500 的整数`)
      return
    }
    out[d] = v
  }
  void set('luoguDiffRatings', JSON.stringify(out))
  toast.success('洛谷难度映射已保存（重新计算评估后生效）')
}

function resetDiffMap(): void {
  for (let d = 1; d <= 7; d++) diffInputs.value[d] = String(DEFAULT_DIFF_VALUES[d])
  void set('luoguDiffRatings', DEFAULT_DIFF)
  toast.success('已恢复默认洛谷难度映射')
}

/** v1.9 FR-23：力扣难度映射（简单/中等/困难 → 近似分值） */
function saveLcDiffMap(): void {
  const out: Record<number, number> = {}
  for (let d = 1; d <= 3; d++) {
    const v = Number(lcDiffInputs.value[d])
    if (!Number.isInteger(v) || v < 800 || v > 3500) {
      toast.error(`${LC_DIFF_NAMES[d]}的映射分值需为 800~3500 的整数`)
      return
    }
    out[d] = v
  }
  void set('leetcodeDiffRatings', JSON.stringify(out))
  toast.success('力扣难度映射已保存（重新计算评估后生效）')
}

function resetLcDiffMap(): void {
  for (let d = 1; d <= 3; d++) lcDiffInputs.value[d] = String(DEFAULT_LC_DIFF_VALUES[d])
  void set('leetcodeDiffRatings', JSON.stringify(DEFAULT_LC_DIFF_VALUES))
  toast.success('已恢复默认力扣难度映射（1000 / 1500 / 2000）')
}

async function saveNickname(e: Event): Promise<void> {
  const name = (e.target as HTMLInputElement).value.trim()
  if (name.length > 20) {
    toast.error('昵称最长 20 个字符')
    return
  }
  await user.saveName(name)
}

async function pickAvatar(): Promise<void> {
  try {
    await user.pickAvatar()
    toast.success('头像已更新')
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  }
}

/** noteAutoSaveMs：钳制到 500–600000，非法值拒绝保存 */
function setAutoSaveMs(raw: string): void {
  const n = Number(raw)
  if (!Number.isFinite(n)) {
    toast.error('自动保存间隔必须为数字（500–600000 毫秒）')
    return
  }
  const clamped = Math.min(600000, Math.max(500, Math.round(n)))
  void set('noteAutoSaveMs', String(clamped))
  settings.value.noteAutoSaveMs = String(clamped)
}

/** 打开洛谷登录窗口（仅用于 UID 在线导入的登录态；v1.8 起题面一律用 Edge 打开） */
async function openLuoguLogin(): Promise<void> {
  try {
    await invoke(IpcChannels.LuoguOpenLogin, {})
    toast.info('已打开登录窗口：登录完成后回到本页点「同步」即可自动抓取做题记录')
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  }
}

// ---------------- v1.12 FR-30：题库账号绑定 ----------------
interface AccountBinding {
  platform: 'cf' | 'luogu' | 'leetcode'
  account: string | null
  displayName: string | null
  totalPassed: number | null
  lastSyncAt: string | null
  lastImported: number | null
  lastError: string | null
  supportsRecords: boolean
}

const accountBindings = ref<AccountBinding[]>([])
const accountInputs = reactive<Record<string, string>>({ cf: '', luogu: '', leetcode: '' })
const accountBusy = reactive<Record<string, boolean>>({ cf: false, luogu: false, leetcode: false })
const syncingAll = ref(false)
const autoSyncEnabled = ref(true)

const PLATFORM_META: Record<
  string,
  { name: string; placeholder: string; hint: string; icon: string }
> = {
  cf: {
    name: 'Codeforces',
    icon: '🔵',
    placeholder: 'Codeforces handle，如 tourist',
    hint: '公开 API 无需登录，自动同步逐题 AC 记录'
  },
  luogu: {
    name: '洛谷',
    icon: '🟢',
    placeholder: '洛谷 UID（纯数字），如 1935012',
    hint: '需先在下方点「登录洛谷」获取登录态，再同步提交记录中的 AC'
  },
  leetcode: {
    name: '力扣',
    icon: '🟠',
    placeholder: '力扣用户名（vue / 个人主页 leetcode.cn/u/<用户名>）',
    hint: '官方仅公开通过数，逐题记录接口已下线，暂只同步概况'
  }
}

async function loadAccounts(): Promise<void> {
  try {
    accountBindings.value = await invoke<AccountBinding[]>(IpcChannels.AccountList)
    for (const b of accountBindings.value) accountInputs[b.platform] = b.account ?? ''
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  }
}

function bindingOf(platform: string): AccountBinding | undefined {
  return accountBindings.value.find((b) => b.platform === platform)
}

async function bindAccount(platform: string): Promise<void> {
  const account = (accountInputs[platform] ?? '').trim()
  if (!account) {
    toast.error('请输入账号后再绑定')
    return
  }
  try {
    await invoke(IpcChannels.AccountBind, { platform, account })
    await loadAccounts()
    toast.success(`已绑定 ${PLATFORM_META[platform].name} 账号：${account}`)
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  }
}

async function unbindAccount(platform: string): Promise<void> {
  if (!confirm(`解绑 ${PLATFORM_META[platform].name} 账号？（已同步的练习记录会保留）`)) return
  try {
    await invoke(IpcChannels.AccountBind, { platform, account: null })
    accountInputs[platform] = ''
    await loadAccounts()
    toast.info('已解绑')
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  }
}

async function syncOne(platform: string): Promise<void> {
  accountBusy[platform] = true
  try {
    const r = await invoke<{
      displayName: string
      totalPassed: number | null
      matched: number
      imported: number
      skipped: number
      unmatched: number
      note?: string
    }>(IpcChannels.AccountSync, { platform })
    await loadAccounts()
    if (r.note) toast.info(r.note)
    else
      toast.success(
        `${PLATFORM_META[platform].name} · ${r.displayName}：通过 ${r.totalPassed ?? '—'} 题，` +
          `匹配 ${r.matched}，新增 ${r.imported}，跳过 ${r.skipped}`
      )
  } catch (e) {
    await loadAccounts()
    toast.error(`同步失败：${e instanceof Error ? e.message : String(e)}`)
  } finally {
    accountBusy[platform] = false
  }
}

async function syncAll(): Promise<void> {
  if (syncingAll.value) return
  syncingAll.value = true
  try {
    const r = await invoke<{
      results: { platform: string; imported: number; displayName: string }[]
      errors: { platform: string; message: string }[]
    }>(IpcChannels.AccountSyncAll)
    await loadAccounts()
    const ok = r.results.map((x) => `${PLATFORM_META[x.platform]?.name ?? x.platform} +${x.imported}`)
    const bad = r.errors.map((x) => `${PLATFORM_META[x.platform]?.name ?? x.platform} 失败`)
    if (ok.length === 0 && bad.length === 0) toast.info('还没有绑定任何账号')
    else toast.success(`同步完成：${[...ok, ...bad].join('，')}`)
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  } finally {
    syncingAll.value = false
  }
}

function fmtSyncTime(s: string | null): string {
  if (!s) return '从未同步'
  return s.slice(0, 16)
}

async function loadAutoSyncSetting(): Promise<void> {
  try {
    const all = await invoke<Record<string, string>>(IpcChannels.SettingsGetAll)
    autoSyncEnabled.value = all.autoSyncEnabled !== 'false'
  } catch {
    autoSyncEnabled.value = true
  }
}

async function setAutoSync(v: boolean): Promise<void> {
  autoSyncEnabled.value = v
  await invoke(IpcChannels.SettingsSet, { key: 'autoSyncEnabled', value: v ? 'true' : 'false' })
}


async function exportBackup(): Promise<void> {
  if (exporting.value) return
  exporting.value = true
  try {
    const r = await invoke<ExportResult>(IpcChannels.DataExport)
    if (r.canceled) return
    lastBackup.value = r.path ?? ''
    toast.success(`已导出到 ${r.path}`)
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  } finally {
    exporting.value = false
  }
}

async function importBackup(): Promise<void> {
  if (!confirm('导入将覆盖当前全部本地数据（题库/练习记录/笔记/模板/比赛/评估历史/设置），确定继续？')) {
    return
  }
  importing.value = true
  try {
    const r = await invoke<ExportResult>(IpcChannels.DataImport)
    if (r.canceled) return
    const total = r.counts?.reduce((s, c) => s + c.count, 0) ?? 0
    toast.success(`导入完成：${total} 条数据（未保存的编辑会被覆盖，请刷新页面查看）`)
    settings.value = {}
    await load()
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  } finally {
    importing.value = false
  }
}

onMounted(() => {
  void load()
  // v1.12：账号绑定状态与自动同步开关
  void loadAccounts()
  void loadAutoSyncSetting()
  // 从题库页「账号绑定」入口跳转过来时，滚动定位到账号面板
  if (route.query.section === 'account') {
    requestAnimationFrame(() => {
      document.querySelector('[data-panel="account"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }
})
</script>

<template>
  <div class="settings-page">
    <div class="panel">
      <h3>偏好设置</h3>
      <label class="row">
        <span class="row-label">启动时提示同步题库（距上次同步 &gt; 24h）</span>
        <input
          type="checkbox"
          :disabled="!loaded"
          :checked="settings.syncReminderEnabled === 'true'"
          @change="set('syncReminderEnabled', ($event.target as HTMLInputElement).checked ? 'true' : 'false')"
        />
      </label>
      <label class="row">
        <span class="row-label">默认比赛时长</span>
        <select
          class="select"
          :disabled="!loaded"
          :value="settings.defaultContestMinutes ?? '120'"
          @change="set('defaultContestMinutes', ($event.target as HTMLSelectElement).value)"
        >
          <option value="60">60 分钟</option>
          <option value="90">90 分钟</option>
          <option value="120">120 分钟</option>
          <option value="180">180 分钟</option>
        </select>
      </label>
      <label class="row">
        <span class="row-label">编辑器 Tab 缩进（笔记/模板）</span>
        <select
          class="select"
          :disabled="!loaded"
          :value="settings.editorIndent ?? 'tab'"
          @change="set('editorIndent', ($event.target as HTMLSelectElement).value)"
        >
          <option value="tab">制表符 Tab</option>
          <option value="2">2 空格</option>
          <option value="4">4 空格</option>
          <option value="8">8 空格</option>
        </select>
      </label>
      <label class="row">
        <span class="row-label">笔记自动保存间隔（毫秒，500–600000）</span>
        <input
          class="input w-140"
          type="number"
          min="500"
          max="600000"
          step="100"
          :disabled="!loaded"
          :value="settings.noteAutoSaveMs ?? '2000'"
          @change="setAutoSaveMs(($event.target as HTMLInputElement).value)"
        />
      </label>
    </div>

    <!-- 首页推荐习题（v1.14 FR-33） -->
    <div class="panel" data-panel="recommend">
      <h3>首页推荐习题</h3>
      <label class="row">
        <span class="row-label">「已练习」部分排序方式</span>
        <select
          class="select"
          data-rec-practiced
          :disabled="!loaded"
          :value="settings.recommendOrderPracticed ?? 'forgetting'"
          @change="set('recommendOrderPracticed', ($event.target as HTMLSelectElement).value)"
        >
          <option v-for="(label, key) in PRACTICED_ORDER_LABELS" :key="key" :value="key">{{ label }}</option>
        </select>
      </label>
      <label class="row">
        <span class="row-label">「未练习」部分推荐方式</span>
        <select
          class="select"
          data-rec-fresh
          :disabled="!loaded"
          :value="settings.recommendOrderFresh ?? 'learning-node'"
          @change="set('recommendOrderFresh', ($event.target as HTMLSelectElement).value)"
        >
          <option v-for="(label, key) in FRESH_ORDER_LABELS" :key="key" :value="key">{{ label }}</option>
        </select>
      </label>
      <label class="row">
        <span class="row-label">每部分展示条数（1–30）</span>
        <span class="rec-limits">
          <input
            class="input w-80"
            type="number"
            min="1"
            max="30"
            data-rec-practiced-limit
            :disabled="!loaded"
            :value="settings.recommendPracticedLimit ?? '8'"
            @change="setRecommendLimit('recommendPracticedLimit', ($event.target as HTMLInputElement).value)"
          />
          <span class="dim">/</span>
          <input
            class="input w-80"
            type="number"
            min="1"
            max="30"
            data-rec-fresh-limit
            :disabled="!loaded"
            :value="settings.recommendFreshLimit ?? '8'"
            @change="setRecommendLimit('recommendFreshLimit', ($event.target as HTMLInputElement).value)"
          />
        </span>
      </label>
      <label class="row">
        <span class="row-label">首页显示「已练习标签」栏</span>
        <input
          type="checkbox"
          data-rec-show-tags
          :disabled="!loaded"
          :checked="settings.recommendShowTags !== 'false'"
          @change="set('recommendShowTags', ($event.target as HTMLInputElement).checked ? 'true' : 'false')"
        />
      </label>
      <p class="hint dim small">
        「已练习」按遗忘曲线（记忆衰减度）排序：越接近遗忘的题越靠前，到期复习的题置顶；
        「未练习」默认优先推荐「练习中」知识点下的题目，并按 AC 数升序（AC 数少 = 更值得练）。
      </p>
    </div>

    <!-- 个人资料（v1.4） -->
    <div class="panel">
      <h3>个人资料</h3>
      <label class="row">
        <span class="row-label">昵称</span>
        <input
          class="input"
          :disabled="!loaded"
          maxlength="20"
          placeholder="输入昵称（显示在侧边栏与首页）"
          :value="user.name"
          @change="saveNickname($event)"
        />
      </label>
      <div class="row avatar-row">
        <span class="row-label">头像</span>
        <div class="avatar-pick">
          <span class="avatar" :class="{ empty: !user.avatarUrl }">
            <img v-if="user.avatarUrl" :src="user.avatarUrl" alt="头像" />
            <span v-else>🎓</span>
          </span>
          <button class="btn" :disabled="!loaded" @click="pickAvatar()">选择图片…</button>
          <button v-if="user.avatarUrl" class="btn ghost" @click="user.clearAvatar(); toast.info('已移除头像，使用默认图标')">移除</button>
        </div>
      </div>
      <p class="dim small">头像保存于本机（png/jpg/webp/gif，≤5MB），未设置时显示默认图标。</p>
    </div>

    <!-- 水平评估权值（v1.4，两权值和恒为 1：改任一项另一项自动联动） -->
    <div class="panel">
      <h3>水平评估权值（综合分 = w1×CF练习分 + w2×比赛分）</h3>
      <div class="row">
        <span class="row-label">CF 练习分权重</span>
        <input
          class="input w-100"
          type="number"
          min="0"
          max="1"
          step="0.05"
          :value="weightP"
          @input="onWeightInput('practice', $event)"
        />
      </div>
      <div class="row">
        <span class="row-label">比赛分权重（自动 = 1 − 练习分）</span>
        <input
          class="input w-100"
          type="number"
          min="0"
          max="1"
          step="0.05"
          :value="weightC"
          @input="onWeightInput('contest', $event)"
        />
      </div>
      <div class="actions">
        <button class="btn primary" :disabled="!loaded" @click="saveWeights()">保存权值</button>
        <button class="btn ghost" :disabled="!loaded" @click="resetWeights()">恢复默认（0.7 / 0.3）</button>
      </div>
      <p class="dim small">两权重互补：修改任意一项，另一项自动 = 1 − 该项。洛谷与力扣练习分均为独立板块，不参与此综合分。</p>
    </div>

    <!-- 洛谷难度映射（v1.4） -->
    <div class="panel">
      <h3>洛谷难度映射（难度评级 → 近似分值，用于洛谷练习分）</h3>
      <div class="diff-grid">
        <label v-for="d in [1, 2, 3, 4, 5, 6, 7]" :key="d" class="diff-item">
          <span class="dim small">难度{{ d }}</span>
          <input v-model="diffInputs[d]" class="input w-90" type="number" min="800" max="3500" step="50" />
        </label>
      </div>
      <div class="actions">
        <button class="btn primary" :disabled="!loaded" @click="saveDiffMap()">保存映射</button>
        <button class="btn ghost" :disabled="!loaded" @click="resetDiffMap()">恢复默认（900–2300）</button>
      </div>
    </div>

    <!-- 力扣难度映射（v1.9 FR-23） -->
    <div class="panel">
      <h3>力扣难度映射（简单/中等/困难 → 近似分值，用于力扣练习分）</h3>
      <div class="diff-grid">
        <label v-for="d in [1, 2, 3]" :key="d" class="diff-item">
          <span class="dim small">{{ LC_DIFF_NAMES[d] }}</span>
          <input v-model="lcDiffInputs[d]" class="input w-90" type="number" min="800" max="3500" step="50" />
        </label>
      </div>
      <div class="actions">
        <button class="btn primary" :disabled="!loaded" @click="saveLcDiffMap()">保存映射</button>
        <button class="btn ghost" :disabled="!loaded" @click="resetLcDiffMap()">恢复默认（1000 / 1500 / 2000）</button>
      </div>
      <p class="dim small">力扣练习分为独立板块，不参与上方 CF 综合分；难度统计见「统计 → 难度分布」。</p>
    </div>

    <!-- v1.12 FR-30：题库账号绑定与自动同步 -->
    <div class="panel" data-panel="account">
      <h3>题库账号绑定</h3>
      <p class="dim small">
        绑定各平台的账号后，应用会在启动时（间隔 ≥ 6 小时）自动抓取「已通过的题目」并写入练习记录，无需手动导入。
        绑定信息仅保存在本机，不含密码或令牌。
      </p>
      <div class="account-list">
        <div v-for="p in ['cf', 'luogu', 'leetcode']" :key="p" class="account-row" :data-account="p">
          <div class="acc-head">
            <span class="acc-name">{{ PLATFORM_META[p].icon }} {{ PLATFORM_META[p].name }}</span>
            <span v-if="bindingOf(p)?.account" class="acc-state bound">
              已绑定 {{ bindingOf(p)?.account }}
              <span v-if="bindingOf(p)?.displayName" class="dim">（{{ bindingOf(p)?.displayName }}）</span>
            </span>
            <span v-else class="acc-state dim">未绑定</span>
          </div>
          <div class="acc-input">
            <input v-model="accountInputs[p]" class="input" :placeholder="PLATFORM_META[p].placeholder" />
            <button class="btn" :disabled="accountBusy[p]" @click="bindAccount(p)">绑定</button>
            <button
              class="btn primary"
              :disabled="accountBusy[p] || !bindingOf(p)?.account"
              @click="syncOne(p)"
            >
              {{ accountBusy[p] ? '同步中…' : '同步' }}
            </button>
            <button
              v-if="bindingOf(p)?.account"
              class="btn ghost"
              :disabled="accountBusy[p]"
              @click="unbindAccount(p)"
            >
              解绑
            </button>
            <button v-if="p === 'luogu'" class="btn ghost" @click="openLuoguLogin()">登录洛谷</button>
          </div>
          <div class="acc-meta dim small">
            {{ PLATFORM_META[p].hint }}
            <span class="sep">·</span>
            上次同步：{{ fmtSyncTime(bindingOf(p)?.lastSyncAt ?? null) }}
            <span v-if="bindingOf(p)?.totalPassed != null" class="sep">·</span>
            <span v-if="bindingOf(p)?.totalPassed != null">通过 {{ bindingOf(p)?.totalPassed }} 题</span>
            <span v-if="bindingOf(p)?.lastImported" class="ok-note">（新增 {{ bindingOf(p)?.lastImported }}）</span>
            <span v-if="bindingOf(p)?.lastError" class="warn">· 上次错误：{{ bindingOf(p)?.lastError }}</span>
          </div>
          <div v-if="!bindingOf(p)?.supportsRecords" class="dim small">
            ⚠️ 该平台接口只提供通过数，无法自动同步逐题记录（可用题库页「粘贴题号/内容」导入具体题目）。
          </div>
        </div>
      </div>
      <div class="actions">
        <button class="btn" :disabled="syncingAll" @click="syncAll()">
          {{ syncingAll ? '同步中…' : '↻ 同步全部已绑定账号' }}
        </button>
        <label class="auto-sync">
          <input
            type="checkbox"
            :checked="autoSyncEnabled"
            @change="setAutoSync(($event.target as HTMLInputElement).checked)"
          />
          <span class="dim small">启动时自动同步（≥ 6 小时一次）</span>
        </label>
      </div>
    </div>

    <div class="panel">
      <h3>洛谷账号（UID 导入用）</h3>
      <p class="dim small">
        从洛谷「做题记录」在线导入需要登录态：点下方按钮打开登录窗口完成登录（登录态仅保存在本机，
        仅用于 UID 导入；未登录时仍可在题库页粘贴文本离线导入）。
        <b class="ok-note">洛谷改版后，在线导入已改用「提交记录（只取 AC）」重建做题记录，登录后填 UID 点「在线导入」即可。</b>
      </p>
      <div class="actions">
        <button class="btn" :disabled="!loaded" @click="openLuoguLogin()">登录洛谷（UID 在线导入用）</button>
      </div>
      <p class="dim small">
        v1.8 起题面统一由 Edge 浏览器打开（未检测到 Edge 时回退系统默认浏览器）；应用内不展示题面、不做本地判题。
      </p>
    </div>

    <div class="panel">
      <h3>数据备份</h3>
      <p class="dim small">导出为 JSON 备份文件（含题库、练习记录、笔记、模板、比赛、评估历史），可随时导入恢复。导入会覆盖全部本地数据。</p>
      <div class="actions">
        <button class="btn primary" :disabled="!loaded || exporting" @click="exportBackup()">
          {{ exporting ? '导出中…' : '⬇ 导出备份' }}
        </button>
        <button class="btn" :disabled="!loaded || importing" @click="importBackup()">
          {{ importing ? '导入中…' : '⬆ 导入备份' }}
        </button>
      </div>
      <p v-if="lastBackup" class="dim small">最近导出：{{ lastBackup }}</p>
    </div>
  </div>
</template>

<style scoped>
.settings-page {
  padding: 16px 20px;
  max-width: 720px;
}
.grow {
  flex: 1;
}
.panel {
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: 10px;
  padding: 16px 18px;
  margin-bottom: 14px;
}
.panel h3 {
  margin: 0 0 14px;
  font-size: 15px;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 0;
  border-bottom: 1px solid #262638;
}
.row:last-child {
  border-bottom: none;
}
.row-label {
  font-size: 13px;
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
.w-120 {
  width: 120px;
}
.w-140 {
  width: 140px;
}
.actions {
  display: flex;
  gap: 10px;
  margin-top: 6px;
}
.avatar-row {
  align-items: center;
}
.avatar-pick {
  display: flex;
  gap: 8px;
  align-items: center;
}
.avatar {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  overflow: hidden;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #313244;
  font-size: 22px;
}
.avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.diff-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 8px;
}
.diff-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.btn {
  border: 1px solid var(--border);
  background: var(--bg-side);
  color: var(--text);
  border-radius: 6px;
  padding: 8px 16px;
  font-size: 13px;
  cursor: pointer;
}
.btn.primary {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}
.btn:disabled {
  opacity: 0.5;
}
.dim {
  color: var(--text-faint);
}
.small {
  font-size: 12px;
}
/* 洛谷改版提示（v1.11.0） */
.panel p .warn {
  color: #e6a23c;
  font-weight: 600;
}
.panel p .ok-note {
  color: #3cb371;
  font-weight: 600;
}
/* v1.12：账号绑定面板 */
.account-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 10px 0;
}
.account-row {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.acc-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.acc-name {
  font-weight: 600;
  font-size: 13px;
}
.acc-state.bound {
  color: var(--success, #3cb371);
  font-size: 12px;
}
.acc-input {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  align-items: center;
}
.acc-input .input {
  flex: 1;
  min-width: 220px;
}
.acc-meta .sep {
  margin: 0 4px;
}
.auto-sync {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: 8px;
}
</style>
