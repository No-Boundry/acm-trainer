<script setup lang="ts">
import { computed, ref } from 'vue'
import { invoke } from '@/api/ipc'
import { IpcChannels } from '@shared/channels'
import { useToast } from '@/composables/useToast'
import {
  STL_CATEGORIES,
  STL_ENTRIES,
  groupStlEntries,
  searchStlEntries,
  type StlCategory
} from '@shared/stl-reference'

/**
 * STL 速查（v1.8.2 FR-18）：竞赛常用 STL 参考资料。
 * 支持关键字搜索、分类过滤、代码一键复制、复杂度与常见坑展示、跳转 cppreference。
 */
const toast = useToast()

const keyword = ref('')
const activeCat = ref<StlCategory | 'all'>('all')
const copiedId = ref<string | null>(null)

const filtered = computed(() => searchStlEntries(keyword.value))
const groups = computed(() =>
  groupStlEntries(activeCat.value === 'all' ? filtered.value : filtered.value.filter((e) => e.category === activeCat.value))
)
const total = computed(() => filtered.value.length)

function catCount(key: StlCategory): number {
  return filtered.value.filter((e) => e.category === key).length
}

async function copyCode(entry: { id: string; code: string }): Promise<void> {
  try {
    await navigator.clipboard.writeText(entry.code)
    copiedId.value = entry.id
    setTimeout(() => {
      if (copiedId.value === entry.id) copiedId.value = null
    }, 1500)
  } catch {
    toast.error('复制失败：可手动选中代码复制')
  }
}

async function openUrl(url: string): Promise<void> {
  try {
    await invoke(IpcChannels.AppOpenExternal, { url })
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  }
}

function reset(): void {
  keyword.value = ''
  activeCat.value = 'all'
}
</script>

<template>
  <div class="ref-page">
    <div class="head">
      <div>
        <h3>📘 STL 速查</h3>
        <p class="dim small">
          竞赛常用 STL 参考资料（C++17）：容器 / 算法 / 复杂度 / 技巧与坑。共
          {{ STL_ENTRIES.length }} 条，当前显示 {{ total }} 条。
        </p>
      </div>
      <div class="head-actions">
        <input
          v-model="keyword"
          class="input search"
          placeholder="搜索：vector / 二分 / 迭代器失效 / 去重 …"
        />
        <button class="btn ghost" @click="reset()">重置</button>
      </div>
    </div>

    <!-- 分类 -->
    <div class="cats">
      <button class="cat" :class="{ on: activeCat === 'all' }" @click="activeCat = 'all'">
        全部 <span class="cnt">{{ total }}</span>
      </button>
      <button
        v-for="c in STL_CATEGORIES"
        :key="c.key"
        class="cat"
        :class="{ on: activeCat === c.key }"
        :title="c.hint"
        @click="activeCat = c.key"
      >
        {{ c.label }} <span class="cnt">{{ catCount(c.key) }}</span>
      </button>
    </div>

    <div v-if="groups.length === 0" class="empty">没有匹配的条目（试试更短的关键字，如「map」「sort」）</div>

    <div v-for="g in groups" :key="g.meta.key" class="group">
      <h4 class="group-head">
        {{ g.meta.label }}
        <span class="dim small">{{ g.meta.hint }}</span>
      </h4>
      <div class="entries">
        <div v-for="e in g.items" :key="e.id" class="entry">
          <div class="entry-head">
            <b class="mono">{{ e.name }}</b>
            <span v-if="e.complexity" class="cplx">{{ e.complexity }}</span>
            <span class="grow" />
            <button class="btn xs" @click="copyCode(e)">{{ copiedId === e.id ? '✓ 已复制' : '复制代码' }}</button>
            <button v-if="e.url" class="btn ghost xs" @click="openUrl(e.url)">cppreference ↗</button>
          </div>
          <p class="summary">{{ e.summary }}</p>
          <pre class="code"><code>{{ e.code }}</code></pre>
          <p v-if="e.pitfalls" class="pitfall"><span class="warn-tag">注意</span>{{ e.pitfalls }}</p>
        </div>
      </div>
    </div>

    <p class="dim small foot">
      提示：本页内容随应用内置（无需联网）；点「cppreference ↗」会调用系统浏览器打开官方文档。
      相关模块：「模板库」可保存自己的代码模板，「学习路径」可按知识点练题。
    </p>
  </div>
</template>

<style scoped>
.ref-page {
  padding: 16px 20px 60px;
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.head h3 {
  margin: 0 0 6px;
  font-size: 17px;
}
.head-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}
.input {
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 13px;
  outline: none;
}
.input:focus {
  border-color: var(--primary);
}
.search {
  width: 320px;
}
.cats {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}
.cat {
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-dim);
  border-radius: 14px;
  padding: 4px 12px;
  font-size: 12px;
  cursor: pointer;
}
.cat:hover {
  border-color: var(--primary);
}
.cat.on {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}
.cnt {
  opacity: 0.75;
  margin-left: 4px;
  font-size: 11px;
}
.empty {
  padding: 24px;
  text-align: center;
  color: var(--text-faint);
  border: 1px dashed var(--border);
  border-radius: 10px;
}
.group {
  margin-bottom: 18px;
}
.group-head {
  margin: 0 0 8px;
  font-size: 14px;
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.entries {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.entry {
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: 10px;
  padding: 10px 12px;
}
.entry-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.entry-head b {
  font-size: 13.5px;
}
.grow {
  flex: 1;
}
.cplx {
  font-size: 11px;
  color: var(--text-faint);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 1px 6px;
}
.summary {
  margin: 6px 0;
  font-size: 12.5px;
  color: var(--text-dim);
  line-height: 1.6;
}
.code {
  margin: 6px 0 0;
  background: #1c1c2e;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 10px;
  overflow: auto;
  font-family: var(--mono);
  font-size: 12px;
  line-height: 1.55;
  max-height: 320px;
}
.pitfall {
  margin: 8px 0 0;
  font-size: 12px;
  color: #e5c07b;
  line-height: 1.6;
}
.warn-tag {
  display: inline-block;
  background: #4b3a13;
  color: #ffcc66;
  border-radius: 4px;
  padding: 0 6px;
  margin-right: 6px;
  font-size: 11px;
}
.foot {
  margin-top: 16px;
  line-height: 1.7;
}
.btn {
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 12px;
  cursor: pointer;
}
.btn.xs {
  padding: 3px 9px;
  font-size: 11.5px;
}
.btn.ghost {
  background: transparent;
}
.mono {
  font-family: var(--mono);
}
.dim {
  color: var(--text-faint);
}
.small {
  font-size: 11.5px;
}
</style>
