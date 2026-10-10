<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import * as echarts from 'echarts'
import ChartBox from '@/components/common/ChartBox.vue'
import { invoke } from '@/api/ipc'
import { IpcChannels } from '@shared/channels'
import type { DifficultySourceStats, DifficultyStatsResult, ProblemSource, StatsResult } from '@shared/types'

const stats = ref<StatsResult | null>(null)
const loading = ref(true)

/** v1.9 FR-22：按题目难度标签统计（CF rating 分段 / 洛谷 0-7 / 力扣 1-3） */
const diffStats = ref<DifficultyStatsResult | null>(null)
const diffSource = ref<ProblemSource>('cf')
const DIFF_SOURCE_LABELS: Record<ProblemSource, string> = {
  cf: 'Codeforces（rating 分段）',
  luogu: '洛谷（难度 0–7）',
  leetcode: '力扣（简单/中等/困难）'
}

const activeDiff = computed<DifficultySourceStats | null>(() => diffStats.value?.[diffSource.value] ?? null)

const diffOption = computed<echarts.EChartsOption>(() => {
  const buckets = activeDiff.value?.buckets ?? []
  return {
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis' },
    legend: { data: ['已练题目', '已 AC'], textStyle: baseText },
    grid: { left: 44, right: 16, top: 36, bottom: 46 },
    xAxis: {
      type: 'category',
      data: buckets.map((b) => b.label),
      axisLabel: { color: AXIS_COLOR, rotate: buckets.length > 8 ? 38 : 0, fontSize: 11 },
      axisLine: { lineStyle: { color: SPLIT_COLOR } }
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: AXIS_COLOR },
      splitLine: { lineStyle: { color: SPLIT_COLOR } }
    },
    series: [
      {
        name: '已练题目',
        type: 'bar',
        data: buckets.map((b) => b.attempted),
        itemStyle: { color: '#1e90ff' }
      },
      {
        name: '已 AC',
        type: 'bar',
        data: buckets.map((b) => b.ac),
        itemStyle: { color: '#3cb371' }
      }
    ]
  }
})

const AXIS_COLOR = '#6c7086'
const SPLIT_COLOR = '#313244'

const baseText = { color: '#cdd6f4' }

const dailyOption = computed<echarts.EChartsOption>(() => ({
  backgroundColor: 'transparent',
  tooltip: { trigger: 'axis' },
  legend: { data: ['提交数', 'AC数'], textStyle: baseText },
  grid: { left: 44, right: 16, top: 36, bottom: 28 },
  xAxis: {
    type: 'category',
    data: (stats.value?.daily ?? []).map((d) => d.date.slice(5)),
    axisLabel: { color: AXIS_COLOR },
    axisLine: { lineStyle: { color: SPLIT_COLOR } }
  },
  yAxis: {
    type: 'value',
    axisLabel: { color: AXIS_COLOR },
    splitLine: { lineStyle: { color: SPLIT_COLOR } }
  },
  series: [
    {
      name: '提交数',
      type: 'bar',
      data: (stats.value?.daily ?? []).map((d) => d.count),
      itemStyle: { color: '#1e90ff' }
    },
    {
      name: 'AC数',
      type: 'bar',
      data: (stats.value?.daily ?? []).map((d) => d.acCount),
      itemStyle: { color: '#3cb371' }
    }
  ]
}))

const weeklyOption = computed<echarts.EChartsOption>(() => ({
  backgroundColor: 'transparent',
  tooltip: { trigger: 'axis' },
  legend: { data: ['提交数', 'AC数'], textStyle: baseText },
  grid: { left: 44, right: 16, top: 36, bottom: 28 },
  xAxis: {
    type: 'category',
    data: (stats.value?.weekly ?? []).map((w) => w.week),
    axisLabel: { color: AXIS_COLOR },
    axisLine: { lineStyle: { color: SPLIT_COLOR } }
  },
  yAxis: {
    type: 'value',
    axisLabel: { color: AXIS_COLOR },
    splitLine: { lineStyle: { color: SPLIT_COLOR } }
  },
  series: [
    {
      name: '提交数',
      type: 'bar',
      data: (stats.value?.weekly ?? []).map((w) => w.count),
      itemStyle: { color: '#1e90ff' }
    },
    {
      name: 'AC数',
      type: 'bar',
      data: (stats.value?.weekly ?? []).map((w) => w.acCount),
      itemStyle: { color: '#3cb371' }
    }
  ]
}))

const tagOption = computed<echarts.EChartsOption>(() => {
  const tags = [...(stats.value?.tagStats ?? [])].sort((a, b) => b.count - a.count).slice(0, 12)
  return {
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis' },
    legend: { data: ['练习次数', 'AC数'], textStyle: baseText },
    grid: { left: 80, right: 30, top: 36, bottom: 24 },
    xAxis: {
      type: 'value',
      axisLabel: { color: AXIS_COLOR },
      splitLine: { lineStyle: { color: SPLIT_COLOR } }
    },
    yAxis: {
      type: 'category',
      data: tags.map((t) => t.tag),
      axisLabel: { color: AXIS_COLOR },
      axisLine: { lineStyle: { color: SPLIT_COLOR } }
    },
    series: [
      {
        name: '练习次数',
        type: 'bar',
        data: tags.map((t) => t.count),
        itemStyle: { color: '#1e90ff' }
      },
      {
        name: 'AC数',
        type: 'bar',
        data: tags.map((t) => t.acCount),
        itemStyle: { color: '#3cb371' }
      }
    ]
  }
})

const hours = computed(() => {
  const s = (stats.value?.practiceSeconds ?? 0) / 3600
  return s.toFixed(1)
})

onMounted(async () => {
  try {
    stats.value = await invoke<StatsResult>(IpcChannels.RecordsStats, { days: 30 })
  } catch {
    stats.value = null
  } finally {
    loading.value = false
  }
  try {
    diffStats.value = await invoke<DifficultyStatsResult>(IpcChannels.StatsDifficulty)
  } catch {
    diffStats.value = null
  }
})

// 默认切到「已练题目最多」的题源，避免打开就是空图
watch(diffStats, (v) => {
  if (!v) return
  const totals: [ProblemSource, number][] = [
    ['cf', v.cf.attempted],
    ['luogu', v.luogu.attempted],
    ['leetcode', v.leetcode.attempted]
  ]
  const best = totals.filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])[0]
  if (best) diffSource.value = best[0]
})
</script>

<template>
  <div class="stats-page">
    <div v-if="loading" class="empty">加载中…</div>
    <template v-else>
      <!-- 总览卡片 -->
      <div class="cards">
        <div class="card">
          <div class="card-num">{{ stats?.totalAttempts ?? 0 }}</div>
          <div class="card-label">总提交次数</div>
        </div>
        <div class="card">
          <div class="card-num success">{{ stats?.acCount ?? 0 }}</div>
          <div class="card-label">AC 数</div>
        </div>
        <div class="card">
          <div class="card-num">{{ stats?.accuracy ?? '—' }}%</div>
          <div class="card-label">通过率</div>
        </div>
        <div class="card">
          <div class="card-num">{{ stats?.distinctProblems ?? 0 }}</div>
          <div class="card-label">练习题目数（去重）</div>
        </div>
        <div class="card">
          <div class="card-num">{{ hours }}</div>
          <div class="card-label">累计练习时长（小时）</div>
        </div>
      </div>

      <!-- 图表 -->
      <div class="charts">
        <div class="chart-card">
          <h4>近 30 天刷题趋势</h4>
          <ChartBox :option="dailyOption" />
        </div>
        <div class="chart-card">
          <h4>近 12 周刷题趋势</h4>
          <ChartBox :option="weeklyOption" />
        </div>
        <div class="chart-card wide">
          <h4>知识点分布（近 90 天）</h4>
          <ChartBox :option="tagOption" height="300px" />
        </div>
      </div>

      <!-- v1.9 FR-22：按题目难度标签统计 -->
      <div class="panel diff-panel">
        <div class="diff-head">
          <h4>难度分布（按题源）</h4>
          <div class="diff-tabs">
            <button
              v-for="s in (['cf', 'luogu', 'leetcode'] as ProblemSource[])"
              :key="s"
              class="seg"
              :class="{ on: diffSource === s }"
              @click="diffSource = s"
            >
              {{ DIFF_SOURCE_LABELS[s] }}
            </button>
          </div>
        </div>

        <div v-if="activeDiff && activeDiff.attempted > 0" class="diff-body">
          <ChartBox :option="diffOption" height="300px" />
          <table class="table diff-table">
            <thead>
              <tr>
                <th>难度档</th>
                <th class="num">已练题目</th>
                <th class="num">已 AC</th>
                <th class="num">AC 率</th>
                <th class="num">占比</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="b in activeDiff.buckets" :key="b.key" :class="{ zero: b.attempted === 0 }">
                <td>{{ b.label }}</td>
                <td class="num mono">{{ b.attempted }}</td>
                <td class="num mono">{{ b.ac }}</td>
                <td class="num mono">{{ b.acRate != null ? b.acRate + '%' : '—' }}</td>
                <td class="num mono">{{ b.share }}%</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td>合计</td>
                <td class="num mono">{{ activeDiff.attempted }}</td>
                <td class="num mono">{{ activeDiff.ac }}</td>
                <td class="num mono">
                  {{ activeDiff.attempted > 0 ? Math.round((activeDiff.ac / activeDiff.attempted) * 1000) / 10 + '%' : '—' }}
                </td>
                <td class="num mono">100%</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p v-else class="dim">
          该题源还没有练习记录。先到「题库」记录练习（或在力扣/洛谷题上记录结果），此处会按难度档汇总通过情况。
        </p>
      </div>
    </template>
  </div>
</template>

<style scoped>
.stats-page {
  padding: 16px 20px;
}
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}
.card {
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: 10px;
  padding: 16px;
}
.card-num {
  font-size: 26px;
  font-weight: 700;
  font-family: var(--mono);
}
.card-num.success {
  color: var(--success);
}
.card-label {
  color: var(--text-faint);
  font-size: 12px;
  margin-top: 4px;
}
.charts {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.chart-card {
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: 10px;
  padding: 14px 16px;
}
.chart-card.wide {
  grid-column: 1 / -1;
}
.chart-card h4 {
  font-size: 13px;
  color: var(--text-dim);
  margin: 0 0 10px;
}
/* v1.9：难度分布板块 */
.diff-panel {
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: 10px;
  padding: 14px 16px;
  margin-top: 12px;
}
.diff-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.diff-head h4 {
  font-size: 13px;
  color: var(--text-dim);
  margin: 0;
}
.diff-tabs {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.seg {
  border: 1px solid var(--border);
  background: var(--bg-side);
  color: var(--text-dim);
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}
.seg.on {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}
.diff-table {
  margin-top: 12px;
  width: 100%;
}
.diff-table th,
.diff-table td {
  padding: 6px 10px;
  font-size: 13px;
}
.diff-table .num {
  text-align: right;
}
.diff-table tr.zero {
  color: var(--text-faint);
}
.diff-table tfoot td {
  font-weight: 700;
  border-top: 1px solid var(--border);
}
.empty {
  color: var(--text-faint);
  text-align: center;
  padding: 48px 0;
}
</style>
