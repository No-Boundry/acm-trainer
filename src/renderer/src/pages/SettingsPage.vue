<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { invoke } from '@/api/ipc'
import { useToast } from '@/composables/useToast'
import { useUserStore } from '@/stores/user'
import { IpcChannels } from '@shared/channels'

interface ExportResult {
  canceled: boolean
  path?: string
  counts?: { table: string; count: number }[]
}

const toast = useToast()
const user = useUserStore()
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
    toast.info('已打开登录窗口：登录完成后回到题库页点「在线导入」即可使用登录态')
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  }
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

    <div class="panel">
      <h3>洛谷账号（UID 导入用）</h3>
      <p class="dim small">
        从洛谷「做题记录」在线导入需要登录态：点下方按钮打开登录窗口完成登录（登录态仅保存在本机，
        仅用于 UID 导入；未登录时仍可在题库页粘贴文本离线导入）。
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
</style>
