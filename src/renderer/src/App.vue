<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { invoke } from './api/ipc'
import { IpcChannels } from '@shared/channels'
import { useUserStore } from './stores/user'
import { useToast } from './composables/useToast'

const route = useRoute()
const user = useUserStore()
const { toasts, info: toastInfo } = useToast()

const pingResult = ref('未检测')
const appVersion = ref('')

onMounted(async () => {
  void user.load()
  try {
    const data = await invoke<{ pong: string; version: string }>(IpcChannels.Ping)
    pingResult.value = data.pong
    appVersion.value = data.version
  } catch (e) {
    pingResult.value = `IPC 调用失败: ${e instanceof Error ? e.message : String(e)}`
  }
  void checkSyncReminder()
})

/** FR-1.10：开启同步提醒且距上次 CF 同步 > 24h 时提示 */
async function checkSyncReminder(): Promise<void> {
  try {
    const settings = await invoke<Record<string, string>>(IpcChannels.SettingsGetAll)
    if (settings.syncReminderEnabled !== 'true') return
    const last = await invoke<{ cf: string | null; luogu: string | null }>(
      IpcChannels.ProblemsLastSync
    )
    const fetchedAt = last.cf
    if (!fetchedAt) {
      toastInfo('题库尚未同步，前往「题库」页点击同步按钮')
      return
    }
    const t = new Date(fetchedAt.replace(' ', 'T')).getTime()
    // 解析失败或时间在未来（时钟超前机器导出的备份）时不做提醒
    if (Number.isNaN(t) || t > Date.now() + 5 * 60 * 1000) return
    if (Date.now() - t > 24 * 3600 * 1000) {
      toastInfo('距上次同步 Codeforces 题库已超过 24 小时，建议重新同步')
    }
  } catch {
    // 提示失败静默
  }
}

const navItems = [
  { path: '/dashboard', label: '首页', icon: '🏠' },
  { path: '/problems', label: '题库', icon: '📚' },
  { path: '/lists', label: '题单/计划', icon: '📋' },
  { path: '/skills', label: '学习路径', icon: '🗺️' },
  { path: '/reference', label: 'STL 速查', icon: '📘' },
  { path: '/stats', label: '统计', icon: '📊' },
  { path: '/notes', label: '笔记/错题', icon: '📝' },
  { path: '/templates', label: '模板库', icon: '🧩' },
  { path: '/contests', label: '虚拟比赛', icon: '⚔️' },
  { path: '/rating', label: '水平评估', icon: '🏅' },
  { path: '/settings', label: '设置', icon: '⚙️' }
]
</script>

<template>
  <div class="layout">
    <aside class="sidebar">
      <div class="brand">
        <span class="brand-mark">A</span>
        <span class="brand-name">ACM-Trainer</span>
      </div>
      <nav>
        <RouterLink
          v-for="item in navItems"
          :key="item.path"
          :to="item.path"
          class="nav-item"
          :class="{ active: route.path === item.path }"
        >
          <span class="nav-icon">{{ item.icon }}</span>
          <span class="nav-label">{{ item.label }}</span>
        </RouterLink>
      </nav>
      <!-- 用户资料（v1.4） -->
      <RouterLink to="/settings" class="user-card" :title="'点击到设置修改资料'">
        <span v-if="user.avatarUrl" class="avatar"><img :src="user.avatarUrl" alt="头像" /></span>
        <span v-else class="avatar default">🎓</span>
        <span class="user-name">{{ user.name || '未设置昵称' }}</span>
      </RouterLink>
      <div class="status">
        <span class="dot" /> {{ pingResult }}
        <span v-if="appVersion" class="version">v{{ appVersion }}</span>
      </div>
    </aside>

    <div class="main-col">
      <header class="topbar">
        <h2>{{ route.meta.title ?? 'ACM-Trainer' }}</h2>
      </header>
      <main class="content">
        <RouterView />
      </main>
    </div>

    <!-- 全局 toast -->
    <Teleport to="body">
      <div class="toast-wrap">
        <TransitionGroup name="toast">
          <div v-for="t in toasts" :key="t.id" class="toast" :class="t.type">
            {{ t.message }}
          </div>
        </TransitionGroup>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.layout {
  display: flex;
  height: 100vh;
}
.sidebar {
  width: 200px;
  flex-shrink: 0;
  background: var(--bg-side);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  padding: 16px 10px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 8px 18px;
}
.brand-mark {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  background: var(--primary);
  color: #fff;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
}
.brand-name {
  font-weight: 600;
  font-size: 14px;
}
nav {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: 8px;
  color: var(--text-dim);
  text-decoration: none;
  font-size: 13px;
  transition: background 0.15s;
}
.nav-item:hover {
  background: var(--surface);
}
.nav-item.active {
  background: var(--primary);
  color: #fff;
}
.nav-icon {
  font-size: 15px;
}
.user-card {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border-radius: 8px;
  text-decoration: none;
  color: var(--text);
  margin-top: auto;
}
.user-card:hover {
  background: var(--surface);
}
.avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--surface);
}
.avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.avatar.default {
  font-size: 16px;
  background: #313244;
}
.user-name {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.status {
  font-size: 11px;
  color: var(--text-faint);
  padding: 8px;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--success);
  display: inline-block;
}
.version {
  margin-left: auto;
}
.main-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.topbar {
  height: 52px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  border-bottom: 1px solid var(--border);
  background: var(--bg);
}
.topbar h2 {
  font-size: 16px;
  font-weight: 600;
}
.content {
  flex: 1;
  overflow: auto;
}
.toast-wrap {
  position: fixed;
  top: 64px;
  right: 20px;
  z-index: 999;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.toast {
  background: var(--surface);
  border: 1px solid var(--border);
  border-left: 3px solid var(--primary);
  color: var(--text);
  border-radius: 8px;
  padding: 10px 16px;
  font-size: 13px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
}
.toast.success {
  border-left-color: var(--success);
}
.toast.error {
  border-left-color: var(--danger);
}
.toast-enter-active,
.toast-leave-active {
  transition: all 0.25s;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(20px);
}
</style>
