<script setup lang="ts">
/**
 * 知识点选择器（v1.20 FR-41）。
 *
 * 背景：v1.13 起「知识点」就是标签分栏里的第一个 Tab，但它旁边还并排着 6 个按
 * 大类分组的**纯标签** Tab（算法基础 / 动态规划 / 图论 / 数据结构 / 字符串 / 其他）。
 * 于是同一个概念有两条入口：点知识点、或者自己在大类里翻标签。v1.20 把这些标签
 * 全部整合进知识点，筛选界面只保留「知识点」这一个维度 —— 本组件就是那唯一入口。
 *
 * 组件是**受控**的（选中态由父组件传入），只在点击时 emit：
 * - `toggle(node)`：父组件负责「选中/取消该节点的全部标签」并触发查询
 * - `clear()`：父组件负责清空全部知识点与标签
 * 这样题库页（走 store + 重新查询）与虚拟比赛页（只收集参数、点按钮才生成）
 * 可以共用同一套 UI，而各自维护自己的状态。
 */
import { computed } from 'vue'
import { CF_TAGS, LAYER_NAMES } from '@shared/skill-tree'
import { MASTERY_TIER_META } from '@shared/types'
import type { SkillNodeReport } from '@shared/types'

const props = withDefaults(
  defineProps<{
    /** 知识点列表（按层分组渲染） */
    skills: SkillNodeReport[]
    /** 已选知识点 id */
    selectedIds: string[]
    /** 已选标签（用于判断节点是否整体选中） */
    selectedTags: string[]
    /** 是否显示顶部的掌握度概览；题库页显示，紧凑场景（虚拟比赛）可关掉 */
    showSummary?: boolean
    /** 是否显示底部说明文字 */
    showTip?: boolean
    /** 空态提示 */
    emptyText?: string
  }>(),
  {
    showSummary: true,
    showTip: true,
    emptyText: '掌握情况加载中…（技能树统计未就绪）'
  }
)

const emit = defineEmits<{
  (e: 'toggle', node: SkillNodeReport): void
  (e: 'clear'): void
}>()

const TIER_TEXT: Record<string, string> = Object.fromEntries(
  Object.entries(MASTERY_TIER_META).map(([tier, meta]) => [tier, meta.label])
)
const TIER_DOT: Record<string, string> = Object.fromEntries(
  Object.entries(MASTERY_TIER_META).map(([tier, meta]) => [tier, meta.color])
)
const CF_TAG_SET = new Set(CF_TAGS.map((t) => t.toLowerCase()))

/** 综合节点（无关联标签）不参与筛题，如 final_sprint */
function isFilterable(n: SkillNodeReport): boolean {
  return n.tags.length > 0
}

function tierDot(tier: string): string {
  return TIER_DOT[tier] ?? '#6c7086'
}
function tierText(tier: string): string {
  return TIER_TEXT[tier] ?? tier
}

/** 节点选中态 = 它的全部关联标签都在已选里（标签是唯一状态源） */
function isOn(id: string): boolean {
  const n = props.skills.find((x) => x.id === id)
  if (!n || n.tags.length === 0) return false
  const tags = new Set(props.selectedTags)
  return n.tags.every((t) => tags.has(t))
}

/** 题源侧提示：帮助用户预期会筛出哪一侧的题 */
function nodeSourceHint(n: SkillNodeReport): string {
  if (!isFilterable(n)) return '综合节点：无关联标签，不参与筛题'
  const hasCf = n.tags.some((t) => CF_TAG_SET.has(t.toLowerCase()))
  const hasLuogu = n.tags.some((t) => !CF_TAG_SET.has(t.toLowerCase()))
  if (hasCf && hasLuogu) return '可筛出 Codeforces 与洛谷题'
  return hasCf ? '标签为 CF 侧：主要筛出 Codeforces 题' : '标签为洛谷侧：主要筛出洛谷题'
}

const groups = computed(() => {
  const byLayer = new Map<number, SkillNodeReport[]>()
  for (const n of props.skills) {
    const arr = byLayer.get(n.layer) ?? []
    arr.push(n)
    byLayer.set(n.layer, arr)
  }
  return [...byLayer.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([layer, nodes]) => ({
      layer,
      name: LAYER_NAMES[layer] ?? `L${layer}`,
      nodes: nodes.slice().sort((a, b) => b.stats.acProblems - a.stats.acProblems)
    }))
})

const selectedCount = computed(() => props.selectedIds.length)

/** 按五档统计知识点数量，一眼看出薄弱面 */
const summary = computed(() => {
  const order = ['master', 'proficient', 'learning', 'newbie', 'untouched'] as const
  const counts = new Map<string, number>()
  for (const n of props.skills) counts.set(n.tier, (counts.get(n.tier) ?? 0) + 1)
  return order
    .filter((t) => (counts.get(t) ?? 0) > 0)
    .map((t) => ({ tier: t, label: tierText(t), count: counts.get(t) ?? 0 }))
})
</script>

<template>
  <div class="kn-picker">
    <div v-if="props.skills.length === 0" class="dim small">{{ props.emptyText }}</div>
    <template v-else>
      <div v-if="props.showSummary" class="kn-summary-line dim small">
        <span class="kn-sum-item">已选 {{ selectedCount }} 个知识点</span>
        <span v-for="s in summary" :key="s.tier" class="kn-sum-item">
          <span class="dot" :style="{ background: tierDot(s.tier) }" />{{ s.label }} {{ s.count }}
        </span>
        <button v-if="selectedCount > 0" class="btn ghost xs kn-clear" @click="emit('clear')">
          清空知识点
        </button>
      </div>
      <div v-for="g in groups" :key="g.layer" class="kn-group">
        <span class="kn-layer">L{{ g.layer }} · {{ g.name }}</span>
        <div class="kn-chips">
          <button
            v-for="n in g.nodes"
            :key="n.id"
            class="kn-chip"
            :class="{
              on: isOn(n.id),
              done: ['proficient', 'master'].includes(n.tier),
              disabled: !isFilterable(n)
            }"
            :disabled="!isFilterable(n)"
            :title="`${n.name}：${tierText(n.tier)} · 已练习 ${n.stats.attempted} 题 / 已 AC ${n.stats.acProblems} 题 · 关联标签 ${n.tags.length} 个 · ${nodeSourceHint(n)}`"
            @click="emit('toggle', n)"
          >
            <span class="dot" :style="{ background: tierDot(n.tier) }" />
            <span class="kn-name">{{ n.name }}</span>
            <span class="kn-stat mono">{{ n.stats.attempted }}/{{ n.stats.acProblems }}</span>
          </button>
        </div>
      </div>
      <p v-if="props.showTip" class="dim small kn-tip">
        点节点 = 勾选它关联的全部标签（再点取消）。数字含义：已练习题数 / 已 AC 题数；
        色点=掌握度（灰未开始 · 青初学 · 蓝练习中 · 绿基本掌握 · 金熟练）。
      </p>
    </template>
  </div>
</template>

<style scoped>
.kn-picker {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.kn-summary-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-bottom: 2px;
}
.kn-sum-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.kn-clear {
  margin-left: auto;
}
.kn-group {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.kn-layer {
  flex: 0 0 auto;
  min-width: 96px;
  padding-top: 4px;
  color: #6c7086;
  font-size: 12px;
}
.kn-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.kn-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: 999px;
  border: 1px solid #3b3f52;
  background: #262a3a;
  color: #cdd6f4;
  font-size: 12px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.kn-chip:hover {
  border-color: #6c8cff;
}
.kn-chip.on {
  border-color: #6c8cff;
  background: rgba(108, 140, 255, 0.18);
}
.kn-chip.disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.kn-chip .dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: 0 0 auto;
}
.kn-chip .kn-stat {
  color: #8b91a8;
  font-size: 11px;
}
.kn-tip {
  margin: 4px 0 0;
  line-height: 1.6;
}
</style>
