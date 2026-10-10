<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import * as echarts from 'echarts'
import ChartBox from '@/components/common/ChartBox.vue'
import { invoke } from '@/api/ipc'
import { useToast } from '@/composables/useToast'
import { IpcChannels } from '@shared/channels'
import type { RatingBreakdown, RatingSnapshot } from '@shared/types'

const toast = useToast()
const loading = ref(true)
const recalcLoading = ref(false)
const data = ref<(RatingBreakdown & { history: RatingSnapshot[] }) | null>(null)

/** 横轴标签：「MM-DD HH:MM」；字段异常时不抛错（单个坏数据不应让整页空白） */
function axisLabel(h: RatingSnapshot): string {
  return (h?.createdAt ?? '').slice(5, 16)
}

const trendOption = computed<echarts.EChartsOption>(() => {
  const history = data.value?.history ?? []
  return {
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis' },
    grid: { left: 44, right: 20, top: 24, bottom: 28 },
    xAxis: {
      type: 'category',
      data: history.map(axisLabel),
      axisLabel: { color: '#6c7086' },
      axisLine: { lineStyle: { color: '#313244' } }
    },
    yAxis: {
      type: 'value',
      min: (v: { min: number }) => Math.max(800, Math.floor((v.min - 100) / 100) * 100),
      axisLabel: { color: '#6c7086' },
      splitLine: { lineStyle: { color: '#313244' } }
    },
    series: [
      {
        name: 'Rating',
        type: 'line',
        data: history.map((h) => h.rating),
        smooth: true,
        symbolSize: 7,
        lineStyle: { color: '#1e90ff', width: 2 },
        itemStyle: { color: '#1e90ff' },
        areaStyle: { color: 'rgba(30,144,255,0.15)' }
      }
    ]
  }
})

const cards = computed(() => {
  const b = data.value
  if (!b) return []
  return [
    { label: '练习分', value: b.practiceRating ?? '—' },
    { label: '比赛分', value: b.contestRating ?? '—' },
    { label: '正确率', value: b.accuracy != null ? `${b.accuracy}%` : '—' },
    { label: '有效练习题数', value: b.attemptCount },
    { label: '其中 AC', value: b.acCount }
  ]
})

/** 洛谷练习分展示色（粗略分档） */
const luoguScoreColor = computed(() => {
  const r = data.value?.luogu?.rating
  if (r == null) return '#6c7086'
  if (r < 1200) return '#3cb371'
  if (r < 1600) return '#1e90ff'
  if (r < 2000) return '#9370db'
  return '#ff8c00'
})

/** 力扣练习分展示色（v1.9 FR-23，沿用同一分档口径） */
const lcScoreColor = computed(() => {
  const r = data.value?.leetcode?.rating
  if (r == null) return '#6c7086'
  if (r < 1200) return '#3cb371'
  if (r < 1600) return '#1e90ff'
  if (r < 2000) return '#9370db'
  return '#ff8c00'
})

/** 力扣难度中文名（1 简单 / 2 中等 / 3 困难） */
const LC_LABELS: readonly string[] = ['', '简单', '中等', '困难']
function lcLabel(d: number): string {
  return LC_LABELS[d] ?? `难度${d}`
}

async function load(): Promise<void> {
  try {
    data.value = await invoke<RatingBreakdown & { history: RatingSnapshot[] }>(IpcChannels.RatingGet)
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  } finally {
    loading.value = false
  }
}

async function recalc(): Promise<void> {
  recalcLoading.value = true
  try {
    data.value = await invoke<RatingBreakdown & { history: RatingSnapshot[] }>(
      IpcChannels.RatingRecalc,
      { source: 'manual' }
    )
    toast.success('已重算并记录')
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  } finally {
    recalcLoading.value = false
  }
}

onMounted(() => void load())
</script>

<template>
  <div class="rating-page">
    <div v-if="loading" class="empty">加载中…</div>
    <template v-else>
      <!-- 主卡 -->
      <div class="hero">
        <div v-if="data?.finalRating != null" class="rating-num" :style="{ color: data.color ?? '#fff' }">
          {{ data.finalRating }}
        </div>
        <div v-else class="rating-num dim">—</div>
        <div class="title-badge" :style="data?.color ? { borderColor: data.color, color: data.color } : {}">
          {{ data?.title ?? '暂无数据' }}
        </div>
        <p class="disclaimer">
          ⚠️ 该分值为本地训练参考（0.7×练习分 + 0.3×比赛分），不代表真实 Codeforces 分值。
        </p>
        <button class="btn primary" :disabled="recalcLoading" @click="recalc()">
          {{ recalcLoading ? '计算中…' : '重新计算并记录' }}
        </button>
      </div>

      <!-- 分解卡 -->
      <div class="cards">
        <div v-for="c in cards" :key="c.label" class="card">
          <div class="num">{{ c.value }}</div>
          <div class="label">{{ c.label }}</div>
        </div>
      </div>

      <!-- 洛谷练习水平（v1.3 FR-6.6：独立显示，不并入 CF 综合） -->
      <div class="panel luogu-block">
        <h4>洛谷练习水平（独立参考，不计入上方 CF 综合分）</h4>
        <div v-if="data && data.luogu && data.luogu.attemptCount > 0" class="luogu-body">
          <div class="luogu-score" :style="{ color: luoguScoreColor }">
            {{ data.luogu.rating ?? '—' }}
          </div>
          <div class="luogu-meta">
            <span class="dim">洛谷练习分 = 难度折算均分 −（1 − 正确率）× 300</span>
            <span>有效题数：{{ data.luogu.attemptCount }}（AC {{ data.luogu.acCount }}，正确率 {{ data.luogu.accuracy ?? '—' }}%）</span>
            <div class="diff-chips">
              <span
                v-for="d in data.luogu.difficultyDist"
                :key="d.difficulty"
                class="chip"
                :class="{ on: d.ac > 0 }"
                :title="`洛谷难度 ${d.difficulty}：练习 ${d.total} 题 / AC ${d.ac} 题`"
              >
                难度{{ d.difficulty }} · {{ d.ac }}/{{ d.total }}
              </span>
            </div>
          </div>
        </div>
        <p v-else class="dim">
          暂无洛谷练习数据。在洛谷题上记录练习（或用「洛谷做题记录导入」导入 AC 记录）后，此处将显示独立于 Codeforces 的洛谷练习水平。
        </p>
        <p class="dim small">
          ⚠️ 洛谷无官方数值分值，此处为难度评级（入门~NOI）折算的同量级参考值，仅供个人训练对比，不代表任何官方排名。
        </p>
      </div>

      <!-- 力扣练习水平（v1.9 FR-23：独立显示，不并入 CF 综合） -->
      <div class="panel lc-block">
        <h4>力扣练习水平（独立参考，不计入上方 CF 综合分）</h4>
        <div v-if="data && data.leetcode && data.leetcode.attemptCount > 0" class="luogu-body">
          <div class="luogu-score" :style="{ color: lcScoreColor }">
            {{ data.leetcode.rating ?? '—' }}
          </div>
          <div class="luogu-meta">
            <span class="dim">力扣练习分 = 难度折算均分 −（1 − 正确率）× 300</span>
            <span>
              有效题数：{{ data.leetcode.attemptCount }}（AC {{ data.leetcode.acCount }}，正确率
              {{ data.leetcode.accuracy ?? '—' }}%）
            </span>
            <div class="diff-chips">
              <span
                v-for="d in data.leetcode.difficultyDist"
                :key="d.difficulty"
                class="chip lc"
                :class="{ on: d.ac > 0 }"
                :title="`力扣 ${lcLabel(d.difficulty)}：练习 ${d.total} 题 / AC ${d.ac} 题`"
              >
                {{ lcLabel(d.difficulty) }} · {{ d.ac }}/{{ d.total }}
              </span>
            </div>
          </div>
        </div>
        <p v-else class="dim">
          暂无力扣练习数据。在力扣题上记录练习（题库 → 数据源「力扣」）后，此处将显示独立于 Codeforces 的力扣练习水平。
        </p>
        <p class="dim small">
          ⚠️ 力扣无官方数值分值，此处为难度（简单/中等/困难）折算的同量级参考值，可在「设置」中调整折算分值。
        </p>
      </div>

      <!-- 趋势 -->
      <div class="panel">
        <h4>Rating 历史趋势</h4>
        <ChartBox v-if="data && data.history.length" :option="trendOption" height="280px" />
        <p v-else class="dim">还没有历史记录。点击「重新计算并记录」生成第一条。</p>
      </div>
    </template>
  </div>
</template>

<style scoped>
.rating-page {
  padding: 16px 20px;
}
.hero {
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: 12px;
  padding: 28px;
  text-align: center;
  margin-bottom: 14px;
}
.rating-num {
  font-size: 56px;
  font-weight: 800;
  font-family: var(--mono);
  line-height: 1.1;
}
.title-badge {
  display: inline-block;
  margin-top: 10px;
  border: 2px solid var(--border);
  border-radius: 20px;
  padding: 6px 22px;
  font-weight: 700;
  font-size: 16px;
}
.disclaimer {
  color: var(--text-faint);
  font-size: 12px;
  margin: 14px 0;
}
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
  margin-bottom: 14px;
}
.card {
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: 10px;
  padding: 14px 16px;
  text-align: center;
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
.panel {
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: 10px;
  padding: 14px 16px;
}
.luogu-block {
  margin-top: 14px;
  border-color: #e34c3944;
}
.lc-block {
  margin-top: 14px;
  border-color: #ffa11644;
}
.luogu-body {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  flex-wrap: wrap;
}
.luogu-score {
  font-size: 40px;
  font-weight: 800;
  font-family: var(--mono);
  line-height: 1.1;
}
.luogu-meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
}
.diff-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.chip {
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-dim);
  border-radius: 12px;
  padding: 2px 10px;
  font-size: 12px;
}
.chip.on {
  background: #e34c39;
  border-color: #e34c39;
  color: #fff;
}
.chip.lc.on {
  background: #ffa116;
  border-color: #ffa116;
  color: #1b1b1b;
}
.panel h4 {
  margin: 0 0 10px;
  font-size: 13px;
  color: var(--text-dim);
}
.btn {
  border: 1px solid var(--border);
  background: var(--bg-side);
  color: var(--text);
  border-radius: 6px;
  padding: 8px 18px;
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
.empty {
  color: var(--text-faint);
  text-align: center;
  padding: 48px 0;
}
</style>
