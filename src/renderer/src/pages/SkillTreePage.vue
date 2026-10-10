<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { useRouter } from 'vue-router'
import { invoke } from '@/api/ipc'
import { useToast } from '@/composables/useToast'
import { useStatementStore } from '@/stores/statement'
import { useProblemsStore } from '@/stores/problems'
import { IpcChannels } from '@shared/channels'
import { LAYER_NAMES } from '@shared/skill-tree'
import { SKILL_TRACKS, SKILL_TRACK_MAP, type TrackProgress } from '@shared/skill-tracks'
import { MASTERY_TIER_META, MASTERY_TIER_ORDER } from '@shared/types'
import type { MasteryTier, SkillNodeReport, SkillReport } from '@shared/types'

/** v1.10 FR-26：赛道进度随 skill:get 一起下发 */
interface ReportWithTracks extends SkillReport {
  tracks?: { id: string; progress: TrackProgress; nodeIds: string[] }[]
}

const statement = useStatementStore()
const problemsStore = useProblemsStore()
const router = useRouter()
const toast = useToast()

/** v1.8.1：一键把「建议优先学习」的知识点带入题库筛选并跳转 */
async function practiceRecommended(): Promise<void> {
  const ids = report.value?.recommendedIds ?? []
  if (ids.length === 0) {
    toast.info('当前没有「建议优先学习」的知识点（可先记录练习，或全部已达标）')
    return
  }
  await gotoProblems(ids, `已在题库中选中 ${ids.length} 个建议学习的知识点`)
}

/**
 * v1.9.1：单个知识点 → 题库（只选中该节点，按关联标签并集筛题）。
 * 综合节点（无关联标签）无法筛题，给出提示而不是跳转到一个空列表。
 */
async function practiceNode(node: SkillNodeReport): Promise<void> {
  if (node.tags.length === 0) {
    toast.info(`「${node.name}」是综合节点，没有可直接筛选的关联标签（可按知识点组合手动筛选）`)
    return
  }
  await gotoProblems([node.id], `已在题库中选中「${node.name}」（${node.tags.length} 个关联标签）`)
}

/** 写入题库筛选状态 + 深链跳转（query 保证刷新/回退后仍保留选择） */
async function gotoProblems(ids: string[], successMsg: string): Promise<void> {
  try {
    problemsStore.knowledgeIds = [...ids]
    problemsStore.knowledgeOpenRequested = true
    await router.push({ path: '/problems', query: { knowledge: ids.join(',') } })
    toast.success(successMsg)
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  }
}

/** v1.8：题面用 Edge 浏览器打开 */
async function openStatement(problemId: string): Promise<void> {
  try {
    await statement.openStatement(problemId)
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  }
}

const loading = ref(true)
const report = ref<SkillReport | null>(null)
const selectedId = ref<string | null>(null)
const rootRef = ref<HTMLElement | null>(null)

// v1.8：五档配色集中到 shared/types（色相分离，见 MASTERY_TIER_META）
const TIER_META = MASTERY_TIER_META

const maxLayer = computed(() => (report.value ? Math.max(...report.value.nodes.map((n) => n.layer)) : 0))

/** 稳定排序（保持原相对顺序） */
function stableSort<T>(arr: T[], cmp: (a: T, b: T) => number): T[] {
  return arr
    .map((v, i) => ({ v, i }))
    .sort((x, y) => cmp(x.v, y.v) || x.i - y.i)
    .map((x) => x.v)
}

/**
 * 层内节点重心排序：下→上两遍 + 上→下一遍，
 * 让依赖尽量落在前一层同列附近 → 连线以竖直为主、交叉最少。
 */
function orderLayersByDeps(nodes: SkillNodeReport[]): SkillNodeReport[][] {
  const maxL = Math.max(0, ...nodes.map((n) => n.layer))
  const layers: SkillNodeReport[][] = []
  for (let l = 0; l <= maxL; l++) layers.push(nodes.filter((n) => n.layer === l))

  const avgPos = (node: SkillNodeReport, layerIdx: number, posMap: Map<string, number>): number => {
    const deps = node.dependsOn.filter((d) => posMap.has(d))
    if (deps.length === 0) return Number.MAX_SAFE_INTEGER
    return deps.reduce((s, d) => s + (posMap.get(d) as number), 0) / deps.length
  }

  // 自下而上两遍：本层顺序 ← 依赖（下一层）位置均值
  for (let pass = 0; pass < 2; pass++) {
    for (let l = 1; l <= maxL; l++) {
      const belowPos = new Map(layers[l - 1].map((n, i) => [n.id, i]))
      layers[l] = stableSort(layers[l], (a, b) => avgPos(a, l, belowPos) - avgPos(b, l, belowPos))
    }
  }
  // 自上而下一遍：被上层依赖多的靠左（子女位置均值）
  for (let l = maxL - 1; l >= 0; l--) {
    const childPos = new Map<string, number[]>()
    layers[l + 1].forEach((n, idx) => {
      for (const d of n.dependsOn) {
        const arr = childPos.get(d)
        if (arr) arr.push(idx)
        else childPos.set(d, [idx])
      }
    })
    const score = (n: SkillNodeReport): number => {
      const children = childPos.get(n.id)
      if (!children || children.length === 0) return Number.MAX_SAFE_INTEGER
      return children.reduce((s, c) => s + c, 0) / children.length
    }
    layers[l] = stableSort(layers[l], (a, b) => score(a) - score(b))
  }
  return layers
}

const layers = computed(() => {
  if (!report.value) return []
  const byLayer = orderLayersByDeps(report.value.nodes)
  const out: { layer: number; name: string; nodes: SkillNodeReport[] }[] = []
  for (let l = maxLayer.value; l >= 0; l--) {
    const nodes = byLayer[l] ?? []
    if (nodes.length > 0) out.push({ layer: l, name: LAYER_NAMES[l] ?? `L${l}`, nodes })
  }
  return out
})

const nodeById = computed(() => {
  const m = new Map<string, SkillNodeReport>()
  for (const n of report.value?.nodes ?? []) m.set(n.id, n)
  return m
})

const selectedNode = computed(() => (selectedId.value ? nodeById.value.get(selectedId.value) ?? null : null))

interface Edge {
  from: string
  to: string
  x1: number
  y1: number
  x2: number
  y2: number
}
const edges = ref<Edge[]>([])
/** SVG 显式像素尺寸（.tree 高度为内容自适应，CSS 百分比高度对绝对定位子元素不可靠） */
const svgSize = ref({ w: 0, h: 0 })

function measureEdges(): void {
  if (!rootRef.value || !report.value) return
  const rootRect = rootRef.value.getBoundingClientRect()
  svgSize.value = { w: rootRef.value.scrollWidth, h: rootRef.value.scrollHeight }
  const list: Edge[] = []
  for (const n of report.value.nodes) {
    for (const d of n.dependsOn) {
      const elA = rootRef.value.querySelector<HTMLElement>(`[data-node="${d}"]`)
      const elB = rootRef.value.querySelector<HTMLElement>(`[data-node="${n.id}"]`)
      if (!elA || !elB) continue
      const ra = elA.getBoundingClientRect()
      const rb = elB.getBoundingClientRect()
      // v1.10.1：赛道过滤隐藏的卡片不再参与测量（否则会画出指向隐藏节点的悬空连线）
      if (!isNodeVisible(d) || !isNodeVisible(n.id)) continue
      list.push({
        from: d,
        to: n.id,
        x1: ra.left + ra.width / 2 - rootRect.left,
        y1: ra.top + ra.height / 2 - rootRect.top,
        x2: rb.left + rb.width / 2 - rootRect.left,
        y2: rb.top + rb.height / 2 - rootRect.top
      })
    }
  }
  edges.value = list
}

/** v1.10.1：节点是否可见（赛道过滤生效且该节点不在赛道内时隐藏） */
function isNodeVisible(id: string): boolean {
  if (!(onlyTrackNodes.value && activeTrackId.value)) return true
  return isInTrack(id)
}

/**
 * 只渲染两端都可见的连线：原先只过滤了卡片、连线仍按原始坐标绘制，
 * 勾选「只显示赛道节点」后会出现悬空/交叉的残留连线。
 */
const visibleEdges = computed(() => edges.value.filter((e) => isNodeVisible(e.from) && isNodeVisible(e.to)))

function edgePath(e: Edge): string {
  const my = (e.y1 + e.y2) / 2
  return `M ${e.x1} ${e.y1} C ${e.x1} ${my}, ${e.x2} ${my}, ${e.x2} ${e.y2}`
}

function tierOf(id: string): MasteryTier {
  return nodeById.value.get(id)?.tier ?? 'untouched'
}

async function load(): Promise<void> {
  loading.value = true
  try {
    const r = await invoke<ReportWithTracks>(IpcChannels.SkillGet)
    report.value = r
    trackInfo.value = r.tracks ?? []
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
    report.value = null
    trackInfo.value = []
  } finally {
    // 树在 loading=false 后才挂载（v-if/v-else-if），测量必须等 DOM 就绪
    loading.value = false
  }
  await nextTick()
  await nextTick()
  measureEdges()
}

// ---------- v1.10 FR-26：国内比赛赛道 ----------
const trackInfo = ref<{ id: string; progress: TrackProgress; nodeIds: string[] }[]>([])
const activeTrackId = ref<string>('')

const activeTrack = computed(() => (activeTrackId.value ? SKILL_TRACK_MAP.get(activeTrackId.value) ?? null : null))
const activeTrackProgress = computed(() => {
  if (!activeTrackId.value) return null
  return trackInfo.value.find((t) => t.id === activeTrackId.value)?.progress ?? null
})
/** 赛道模式下：非赛道节点压暗（可选开关） */
const onlyTrackNodes = ref(false)

function isInTrack(id: string): boolean {
  if (!activeTrackId.value) return true
  const info = trackInfo.value.find((t) => t.id === activeTrackId.value)
  if (!info) return true
  return info.nodeIds.includes(id)
}

function isRequiredNode(id: string): boolean {
  return activeTrack.value?.required.includes(id) ?? false
}

function isFocusNode(id: string): boolean {
  return activeTrack.value?.focus.includes(id) ?? false
}

/** 赛道进度百分比（必达节点达标率） */
const trackPercent = computed(() => {
  const p = activeTrackProgress.value
  if (!p || p.requiredTotal === 0) return 0
  return Math.round((p.requiredDone / p.requiredTotal) * 100)
})

/** 一键按赛道生成题单并跳转（复用题库知识点筛选） */
async function practiceTrack(): Promise<void> {
  const track = activeTrack.value
  if (!track) return
  await gotoProblems([...track.focus], `已按「${track.name}」选中 ${track.focus.length} 个重点知识点`)
}

/** 选中节点（v1.8：资料卡不再拉取题单，仅展示知识点资料） */
function selectNode(n: SkillNodeReport): void {
  selectedId.value = n.id
}


function isRecommended(id: string): boolean {
  return report.value?.recommendedIds.includes(id) ?? false
}

/** 悬停/选中的焦点节点：只点亮与其直连的依赖线，其余压暗 → 信息密集时仍可读 */
const focusId = ref<string | null>(null)
const focusSet = computed<Set<string>>(() => {
  const set = new Set<string>()
  const id = focusId.value ?? selectedId.value
  if (!id || !report.value) return set
  set.add(id)
  for (const n of report.value.nodes) {
    if (n.id === id) for (const d of n.dependsOn) set.add(d)
    if (n.dependsOn.includes(id)) set.add(n.id)
  }
  return set
})
function isEdgeActive(e: Edge): boolean {
  if (!focusId.value && !selectedId.value) return false
  return focusSet.value.has(e.from) && focusSet.value.has(e.to)
}

function pct(v: number | null): string {
  return v == null ? '—' : `${Math.round(v * 100)}%`
}

let onResize: (() => void) | null = null

// v1.10.1：切换赛道 / 勾选「只显示赛道节点」会改变布局（display:none 使卡片重排），
// 必须重测连线，否则连线位置停在旧坐标上
watch([activeTrackId, onlyTrackNodes], async () => {
  await nextTick()
  await nextTick()
  measureEdges()
})

onMounted(() => {
  onResize = () => measureEdges()
  window.addEventListener('resize', onResize)
  void load()
  // 字体加载完成后布局可能微移，重测一次连线
  const fonts = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts
  if (fonts?.ready?.then) void fonts.ready.then(() => measureEdges())
})

onBeforeUnmount(() => {
  if (onResize) window.removeEventListener('resize', onResize)
})
</script>

<template>
  <div class="skill-page">
    <div class="head">
      <div>
        <h3>🗺️ 学习路径 · 技能树</h3>
        <p class="dim small">
          由下至上从易到难；连线表示前置依赖。图例：
          <span
            v-for="tier in MASTERY_TIER_ORDER"
            :key="tier"
            class="lg"
            :style="{ color: MASTERY_TIER_META[tier].color }"
          >{{ MASTERY_TIER_META[tier].label }}</span>
          <span class="lg">🔒 前置未达标</span>
          <span class="lg" style="color: #ff8c00">★ 推荐下一步</span>
        </p>
        <p v-if="report && !report.allDone" class="dim small">
          建议优先学习：<span v-for="id in report.recommendedIds.slice(0, 6)" :key="id" class="rec-pill">{{ nodeById.get(id)?.name }}</span>
          <span v-if="report.recommendedIds.length > 6" class="dim"> 等 {{ report.recommendedIds.length }} 项</span>
          <button
            class="btn primary xs go-problems"
            :title="`在题库中选中全部 ${report.recommendedIds.length} 个建议学习的知识点`"
            @click="practiceRecommended()"
          >
            📚 去题库练习（自动选中 {{ report.recommendedIds.length }} 个知识点）
          </button>
        </p>
        <p v-else-if="report?.allDone" class="ok">🎉 全部知识点已达标，可以多打比赛巩固（或自定义图谱继续进阶）</p>
      </div>
      <button class="btn" :disabled="loading" @click="load()">⟳ 重新统计</button>
    </div>

    <!-- v1.10 FR-26：国内比赛赛道预设 -->
    <div class="track-panel">
      <div class="track-row">
        <span class="dim small">比赛赛道：</span>
        <button class="seg" :class="{ on: activeTrackId === '' }" @click="activeTrackId = ''">全部知识点</button>
        <button
          v-for="t in SKILL_TRACKS"
          :key="t.id"
          class="seg"
          :class="{ on: activeTrackId === t.id }"
          :title="`${t.meta}｜推荐难度 ${t.ratingRange[0]}–${t.ratingRange[1]}`"
          @click="activeTrackId = t.id"
        >
          {{ t.name }}
        </button>
        <label v-if="activeTrackId" class="only-track">
          <input v-model="onlyTrackNodes" type="checkbox" />
          <span class="dim small">只显示赛道节点</span>
        </label>
      </div>

      <div v-if="activeTrack && activeTrackProgress" class="track-detail">
        <div class="track-info">
          <span class="dim small">{{ activeTrack.meta }}</span>
          <span class="dim small">推荐难度：CF {{ activeTrack.ratingRange[0] }}–{{ activeTrack.ratingRange[1] }}</span>
        </div>
        <p class="small">{{ activeTrack.description }}</p>
        <div class="track-bar">
          <div class="bar"><div class="bar-in" :style="{ width: trackPercent + '%' }"></div></div>
          <span class="mono small">
            必达 {{ activeTrackProgress.requiredDone }}/{{ activeTrackProgress.requiredTotal }}（{{ trackPercent }}%）
            · 重点 {{ activeTrackProgress.focusDone }}/{{ activeTrackProgress.focusTotal }}
          </span>
          <button class="btn xs primary" @click="practiceTrack()">📚 按赛道去题库练习</button>
        </div>
        <p v-if="activeTrackProgress.nextIds.length" class="dim small">
          该赛道建议优先：
          <span v-for="id in activeTrackProgress.nextIds" :key="id" class="rec-pill">{{ nodeById.get(id)?.name }}</span>
        </p>
        <p v-else class="ok small">🎉 该赛道必达与重点节点均已达标</p>
      </div>
    </div>

    <div v-if="loading" class="empty">统计中…</div>
    <template v-else-if="report">
      <div ref="rootRef" class="tree">
        <svg class="edges" :width="svgSize.w" :height="svgSize.h" aria-hidden="true">
          <path
            v-for="e in visibleEdges"
            :key="`${e.from}-${e.to}`"
            :d="edgePath(e)"
            :class="{ active: isEdgeActive(e) }"
          />
        </svg>

        <div v-for="layer in layers" :key="layer.layer" class="layer">
          <div class="layer-head">
            <span class="layer-name">L{{ layer.layer }} · {{ layer.name }}</span>
            <span class="layer-count dim">（{{ layer.nodes.length }} 个知识点）</span>
          </div>
          <div class="layer-nodes">
            <button
              v-for="n in layer.nodes"
              v-show="!(onlyTrackNodes && activeTrackId) || isInTrack(n.id)"
              :key="n.id"
              class="node-card"
              :data-node="n.id"
              :class="{
                done: ['proficient', 'master'].includes(n.tier),
                locked: !n.depsReady && !['proficient', 'master'].includes(n.tier),
                recommended: isRecommended(n.id),
                selected: selectedId === n.id,
                'track-focus': !!activeTrackId && isFocusNode(n.id),
                'track-req': !!activeTrackId && isRequiredNode(n.id),
                'track-dim': !!activeTrackId && !isInTrack(n.id)
              }"
              :style="{ '--tc': TIER_META[n.tier].color }"
              :title="`${n.name}（${TIER_META[n.tier].label}）`"
              @mouseenter="focusId = n.id"
              @mouseleave="focusId = null"
              @click="selectNode(n)"
            >
              <span v-if="isRecommended(n.id)" class="star">★</span>
              <span v-if="!n.depsReady && !['proficient', 'master'].includes(n.tier)" class="lock">🔒</span>
              <span class="node-name">{{ n.name }}</span>
              <span class="node-meta">
                <span class="node-tier" :style="{ color: TIER_META[n.tier].color }">{{ TIER_META[n.tier].label }}</span>
                <span v-if="n.stats.acProblems > 0" class="node-ac mono">{{ n.stats.acProblems }} AC</span>
              </span>
              <!-- v1.9.1：单卡片快捷跳题库（stop 避免同时触发卡片选中的详情面板） -->
              <span
                class="card-go"
                role="button"
                tabindex="0"
                :title="n.tags.length ? `去题库练习「${n.name}」` : `「${n.name}」为综合节点，无关联标签`"
                @click.stop="practiceNode(n)"
                @keydown.enter.stop="practiceNode(n)"
              >📚</span>
            </button>
          </div>
        </div>
      </div>

    </template>

    <!-- 节点详情 -->
    <div v-if="selectedNode" class="detail">
      <div class="detail-head">
        <div>
          <h4>{{ selectedNode.name }}</h4>
          <span class="dim small">L{{ selectedNode.layer }} · {{ LAYER_NAMES[selectedNode.layer] }}</span>
        </div>
        <button class="btn ghost xs" @click="selectedId = null">✕</button>
      </div>

      <!-- v1.7 FR-11：知识点简介（仅详情面板） -->
      <p class="node-intro">{{ selectedNode.intro }}</p>

      <div class="tier-line">
        <span class="tier-badge" :style="{ background: TIER_META[selectedNode.tier].color }">{{ TIER_META[selectedNode.tier].label }}</span>
        <span v-if="isRecommended(selectedNode.id)" class="rec-badge">★ 推荐下一步</span>
        <span v-if="!selectedNode.depsReady" class="lock-badge">🔒 前置未达标</span>
        <span v-else-if="!['proficient', 'master'].includes(selectedNode.tier)" class="ok-badge">✓ 前置已满足，可以学</span>
      </div>

      <div class="stats">
        <div class="stat"><b>{{ selectedNode.stats.attempted }}</b><span>尝试题</span></div>
        <div class="stat"><b class="ok">{{ selectedNode.stats.acProblems }}</b><span>AC 题</span></div>
        <div class="stat"><b>{{ pct(selectedNode.stats.acc) }}</b><span>正确率</span></div>
        <div class="stat"><b>{{ selectedNode.stats.hardSolved }}</b><span>难题</span></div>
        <div class="stat"><b>{{ selectedNode.stats.lastActiveDays == null ? '—' : `${selectedNode.stats.lastActiveDays}天前` }}</b><span>最近练习</span></div>
      </div>

      <div class="meta-block">
        <div v-if="selectedNode.dependsOn.length" class="deps">
          <span class="dim small">前置：</span>
          <span v-for="d in selectedNode.dependsOn" :key="d" class="mini" :style="{ color: TIER_META[tierOf(d)].color }">
            {{ nodeById.get(d)?.name }}（{{ TIER_META[tierOf(d)].label }}）
          </span>
        </div>
        <div v-else class="deps"><span class="dim small">基础节点，无前置</span></div>
        <div class="tags">
          <span class="dim small">关联标签：</span>
          <span v-for="t in selectedNode.tags" :key="t" class="mini-tag">{{ t }}</span>
          <span v-if="selectedNode.tags.length === 0" class="dim small">（综合节点，无单一标签）</span>
        </div>
      </div>

      <!-- v1.9.1：单个知识点跳题库（选中该节点的关联标签并集） -->
      <div class="detail-actions">
        <button
          class="btn primary xs go-node-problems"
          :disabled="selectedNode.tags.length === 0"
          :title="
            selectedNode.tags.length
              ? `在题库中只选中「${selectedNode.name}」的 ${selectedNode.tags.length} 个关联标签`
              : '综合节点没有关联标签，无法直接筛题'
          "
          @click="practiceNode(selectedNode)"
        >
          📚 去题库练习该知识点（{{ selectedNode.tags.length }} 个关联标签）
        </button>
      </div>

      <p class="dim small tip">
        口径：按关联标签聚合练习记录，多标签题目会同时计入多个知识点；掌握度阈值可在服务端调整（docs/03 §12）。
      </p>
    </div>
  </div>
</template>

<style scoped>
.skill-page {
  padding: 16px 20px 60px;
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.head h3 {
  margin: 0 0 6px;
  font-size: 17px;
}
.lg {
  margin-right: 8px;
  font-size: 12px;
}
.go-problems {
  margin-left: 8px;
  vertical-align: middle;
}
/* v1.9.1：卡片快捷跳题库按钮（悬停显示） */
.card-go {
  position: absolute;
  top: 4px;
  right: 4px;
  font-size: 12px;
  line-height: 1;
  padding: 3px 5px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-side);
  opacity: 0;
  transition: opacity 0.12s ease;
  cursor: pointer;
}
.node-card:hover .card-go,
.node-card:focus-visible .card-go {
  opacity: 1;
}
.detail-actions {
  margin-top: 10px;
}
/* v1.10：比赛赛道面板 */
.track-panel {
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: 10px;
  padding: 10px 14px;
  margin-bottom: 12px;
}
.track-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.seg {
  border: 1px solid var(--border);
  background: var(--bg-side);
  color: var(--text-dim);
  border-radius: 14px;
  padding: 4px 12px;
  font-size: 12px;
  cursor: pointer;
}
.seg.on {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}
.only-track {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 8px;
}
.track-detail {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.track-info {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
}
.track-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.bar {
  width: 200px;
  height: 8px;
  border-radius: 4px;
  background: var(--bg-side);
  border: 1px solid var(--border);
  overflow: hidden;
}
.bar-in {
  height: 100%;
  background: var(--success, #3cb371);
}
.node-card.track-req {
  border-style: double;
  border-width: 3px;
}
.node-card.track-focus {
  box-shadow: 0 0 0 1px #ff8c0066 inset;
}
.node-card.track-dim {
  opacity: 0.35;
}
.go-node-problems:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.rec-pill {
  display: inline-block;
  border: 1px solid #ff8c0066;
  color: #ff8c00;
  border-radius: 10px;
  padding: 1px 8px;
  font-size: 12px;
  margin: 2px 4px 2px 0;
}
.ok {
  color: var(--success);
  font-size: 13px;
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
.btn.xs {
  padding: 2px 8px;
  font-size: 12px;
}
.btn.ghost {
  background: transparent;
}
.empty {
  color: var(--text-faint);
  text-align: center;
  padding: 48px 0;
}
.tree {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0;
  padding-bottom: 24px;
}
.edges {
  /* 尺寸由 :width/:height 属性（像素）驱动：.tree 高度为内容自适应，
     绝对定位子元素无法可靠使用百分比高度 */
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  overflow: visible;
}
.edges path {
  fill: none;
  stroke: #6f7490;
  stroke-width: 1.4;
  opacity: 0.45;
  transition: opacity 0.15s, stroke 0.15s;
}
.edges path.active {
  stroke: #8fb0ff;
  stroke-width: 2.2;
  opacity: 1;
}
.layer {
  /* 每层一个圆角面板，层名在顶部 → 视觉分组清晰 */
  background: #232338;
  border: 1px solid #2c2c46;
  border-radius: 12px;
  padding: 9px 12px 11px;
  margin-bottom: 10px;
}
.layer-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 8px;
}
.layer-name {
  font-size: 12.5px;
  font-weight: 700;
  letter-spacing: 0.3px;
}
.layer-count {
  font-size: 11px;
}
.layer-nodes {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.node-card {
  position: relative;
  box-sizing: border-box;
  display: inline-flex;
  flex-direction: column;
  justify-content: space-between;
  width: 134px;
  min-height: 62px;
  border: 1.5px solid var(--tc, var(--border));
  background: var(--surface);
  color: var(--text);
  border-radius: 9px;
  padding: 7px 10px;
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
  transition: transform 0.12s, box-shadow 0.12s;
}
.node-card:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
}
.node-card.selected {
  outline: 2px solid #fff3;
}
.node-card.done {
  opacity: 0.92;
}
.node-card.locked {
  opacity: 0.55;
  filter: grayscale(0.6);
}
.node-card.recommended {
  border-color: #ff8c00;
  box-shadow: 0 0 0 1px #ff8c00, 0 0 10px #ff8c0044;
}
.node-name {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 34px;
  font-weight: 600;
  line-height: 1.35;
  padding-right: 16px;
  overflow-wrap: anywhere;
}
.node-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-top: 4px;
}
.node-tier {
  font-size: 11px;
  white-space: nowrap;
}
.node-ac {
  font-size: 11px;
  color: var(--text-dim);
}
.star {
  position: absolute;
  top: 4px;
  right: 6px;
  color: #ff8c00;
  font-size: 13px;
}
.lock {
  position: absolute;
  top: 3px;
  right: 5px;
  font-size: 12px;
}
.detail {
  position: fixed;
  right: 14px;
  top: 64px;
  bottom: 14px;
  width: 380px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 14px 16px;
  overflow-y: auto;
  z-index: 80;
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-shadow: -4px 0 24px rgba(0, 0, 0, 0.35);
}
.detail-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}
.detail-head h4 {
  margin: 0 0 2px;
  font-size: 16px;
}
/* v1.7 FR-11：知识点简介 */
.node-intro {
  margin: 0;
  padding: 9px 11px;
  background: #26263c;
  border: 1px solid var(--border);
  border-left: 3px solid var(--primary);
  border-radius: 8px;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--text-dim);
}
.tier-line {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.tier-badge {
  color: #fff;
  border-radius: 10px;
  padding: 2px 10px;
  font-size: 12px;
  font-weight: 700;
}
.rec-badge {
  color: #ff8c00;
  font-size: 12px;
}
.lock-badge {
  color: var(--text-faint);
  font-size: 12px;
}
.ok-badge {
  color: var(--success);
  font-size: 12px;
}
.stats {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 6px;
}
.stat {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px 4px;
  text-align: center;
}
.stat b {
  display: block;
  font-size: 15px;
  font-family: var(--mono);
}
.stat b.ok {
  color: var(--success);
}
.stat span {
  font-size: 10.5px;
  color: var(--text-faint);
}
.meta-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.deps {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}
.mini {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 1px 8px;
  font-size: 12px;
}
.mini-tag {
  font-size: 11px;
  color: var(--text-dim);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 1px 6px;
}
/* v1.8 行内记录表单 */
.btn.primary {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}
.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.pname {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tip {
  line-height: 1.5;
}
.mono {
  font-family: var(--mono);
}
</style>
