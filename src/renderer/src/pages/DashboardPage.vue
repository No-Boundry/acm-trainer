<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { invoke } from '@/api/ipc'
import { useUserStore } from '@/stores/user'
import { IpcChannels } from '@shared/channels'
import type { PracticeRecord, RatingBreakdown, RatingSnapshot, StatsResult } from '@shared/types'

const user = useUserStore()
const stats = ref<StatsResult | null>(null)
const rating = ref<(RatingBreakdown & { history: RatingSnapshot[] }) | null>(null)
const recent = ref<PracticeRecord[]>([])
const loading = ref(true)

onMounted(async () => {
  if (!user.loaded) void user.load()
  try {
    const [s, r, rec] = await Promise.all([
      invoke<StatsResult>(IpcChannels.RecordsStats, { days: 30 }),
      invoke<RatingBreakdown & { history: RatingSnapshot[] }>(IpcChannels.RatingGet).catch(() => null),
      invoke<{ total: number; items: PracticeRecord[] }>(IpcChannels.RecordsList, {
        page: 1,
        pageSize: 8
      })
    ])
    stats.value = s
    rating.value = r
    recent.value = rec.items
  } finally {
    loading.value = false
  }
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
