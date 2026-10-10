<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import hljs from 'highlight.js'
import 'highlight.js/styles/github-dark.css'
import { invoke } from '@/api/ipc'
import { useToast } from '@/composables/useToast'
import { tabIndentHandler, resolveIndent } from '@/composables/useTabIndent'
import { IpcChannels } from '@shared/channels'
import type { Template } from '@shared/types'

const toast = useToast()
const templates = ref<Template[]>([])
const keyword = ref('')
const selectedCategory = ref('全部')
const indent = ref('\t')

const editing = ref(false)
const editor = ref({
  id: null as number | null,
  category: '',
  title: '',
  language: 'C++',
  description: '',
  code: ''
})

const categories = computed(() => {
  const set = new Set(templates.value.map((t) => t.category))
  return ['全部', ...Array.from(set).sort()]
})

const filtered = computed(() => {
  let list = templates.value
  if (selectedCategory.value !== '全部') {
    list = list.filter((t) => t.category === selectedCategory.value)
  }
  if (keyword.value) {
    const kw = keyword.value.toLowerCase()
    list = list.filter(
      (t) =>
        t.title.toLowerCase().includes(kw) ||
        t.description.toLowerCase().includes(kw) ||
        t.category.toLowerCase().includes(kw)
    )
  }
  return list
})

const codeHtml = computed(() => {
  if (!editor.value.code) return ''
  try {
    return hljs.highlight(editor.value.code, { language: 'cpp' }).value
  } catch {
    return hljs.highlightAuto(editor.value.code).value
  }
})

async function load(): Promise<void> {
  templates.value = await invoke<Template[]>(IpcChannels.TemplatesList, { keyword: keyword.value || undefined })
}

function startCreate(): void {
  editor.value = {
    id: null,
    category: selectedCategory.value === '全部' ? '' : selectedCategory.value,
    title: '',
    language: 'C++',
    description: '',
    code: ''
  }
  editing.value = true
}

function startEdit(t: Template): void {
  editor.value = {
    id: t.id,
    category: t.category,
    title: t.title,
    language: t.language,
    description: t.description,
    code: t.code
  }
  editing.value = true
}

async function save(): Promise<void> {
  if (!editor.value.title.trim() || !editor.value.code.trim()) {
    toast.error('标题与代码不能为空')
    return
  }
  const payload = {
    category: editor.value.category,
    title: editor.value.title,
    language: editor.value.language,
    description: editor.value.description,
    code: editor.value.code
  }
  try {
    if (editor.value.id == null) {
      await invoke<Template>(IpcChannels.TemplatesCreate, payload)
      toast.success('模板已创建')
    } else {
      await invoke<Template>(IpcChannels.TemplatesUpdate, { id: editor.value.id, ...payload })
      toast.success('模板已保存')
    }
    editing.value = false
    await load()
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  }
}

async function removeTemplate(t: Template): Promise<void> {
  if (!confirm(`删除模板「${t.title}」？`)) return
  try {
    await invoke(IpcChannels.TemplatesDelete, { id: t.id })
    toast.success('已删除')
    await load()
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  }
}

async function copyCode(t: Template): Promise<void> {
  try {
    await invoke(IpcChannels.TemplatesCopy, { id: t.id })
    toast.success('已复制到剪贴板')
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  }
}

onMounted(async () => {
  await load()
  // 读取 Tab 缩进设置（FR-7.1）
  try {
    const settings = await invoke<Record<string, string>>(IpcChannels.SettingsGetAll)
    indent.value = resolveIndent(settings.editorIndent)
  } catch {
    // 默认制表符
  }
})
</script>

<template>
  <div class="templates-page">
    <div class="toolbar">
      <input v-model="keyword" class="input" placeholder="搜索模板…" @keyup.enter="load()" />
      <button class="btn ghost" @click="load()">搜索</button>
      <div class="spacer" />
      <button class="btn primary" @click="startCreate()">＋ 新建模板</button>
    </div>

    <div class="cat-bar">
      <button
        v-for="c in categories"
        :key="c"
        class="chip"
        :class="{ on: selectedCategory === c }"
        @click="selectedCategory = c"
      >
        {{ c }}
      </button>
    </div>

    <!-- 模板列表 -->
    <div v-if="!editing" class="tpl-grid">
      <div v-for="t in filtered" :key="t.id" class="tpl-card">
        <div class="tpl-head">
          <span class="tpl-title">{{ t.title }}</span>
          <span class="mini-tag">{{ t.category }}</span>
        </div>
        <p v-if="t.description" class="tpl-desc">{{ t.description }}</p>
        <div class="tpl-actions">
          <button class="btn xs" @click="startEdit(t)">编辑</button>
          <button class="btn xs primary" @click="copyCode(t)">复制</button>
          <button class="btn xs ghost danger" @click="removeTemplate(t)">删除</button>
        </div>
      </div>
      <div v-if="filtered.length === 0" class="empty">
        暂无模板。把常用算法（Dijkstra、KMP、线段树…）整理到这里，比赛时一键复制。
      </div>
    </div>

    <!-- 编辑器 -->
    <div v-else class="editor">
      <div class="editor-toolbar">
        <input v-model="editor.title" class="input title-input" placeholder="模板标题，如：Dijkstra(堆优化)" />
        <input v-model="editor.category" class="input" placeholder="分类，如：图论" />
        <select v-model="editor.language" class="select">
          <option>C++</option>
          <option>Python</option>
          <option>C</option>
        </select>
        <div class="spacer" />
        <button class="btn ghost" @click="editing = false">取消</button>
        <button class="btn primary" @click="save()">保存</button>
      </div>
      <input v-model="editor.description" class="input" placeholder="用途说明（可选）" />
      <div class="editor-body">
        <textarea
          v-model="editor.code"
          class="code-input"
          spellcheck="false"
          placeholder="// 粘贴你的算法模板代码"
          @keydown="tabIndentHandler($event, () => editor.code, (v) => (editor.code = v), indent)"
        ></textarea>
        <div class="code-preview">
          <pre v-html="codeHtml" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.templates-page {
  padding: 16px 20px;
}
.toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 12px;
}
.input,
.select {
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 6px;
  padding: 7px 10px;
  font-size: 13px;
  outline: none;
}
.select {
  min-width: 90px;
}
.input:focus {
  border-color: var(--primary);
}
.spacer {
  flex: 1;
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
.btn.primary {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}
.btn.ghost {
  background: transparent;
}
.btn.xs {
  padding: 3px 9px;
  font-size: 12px;
}
.btn.danger {
  color: var(--danger);
}
.cat-bar {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.chip {
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-dim);
  border-radius: 12px;
  padding: 3px 12px;
  font-size: 12px;
  cursor: pointer;
}
.chip.on {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}
.tpl-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 12px;
}
.tpl-card {
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: 10px;
  padding: 14px 16px;
}
.tpl-head {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: space-between;
}
.tpl-title {
  font-weight: 600;
}
.mini-tag {
  font-size: 11px;
  color: var(--text-dim);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 2px 8px;
}
.tpl-desc {
  color: var(--text-dim);
  font-size: 12px;
  margin: 8px 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tpl-actions {
  display: flex;
  gap: 6px;
}
.empty {
  grid-column: 1 / -1;
  color: var(--text-faint);
  text-align: center;
  padding: 48px 0;
}
.editor {
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: calc(100vh - 130px);
}
.editor-toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
}
.title-input {
  min-width: 220px;
}
.editor-body {
  display: flex;
  gap: 10px;
  flex: 1;
  min-height: 0;
}
.code-input {
  flex: 1;
  resize: none;
  background: var(--bg-side);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 8px;
  padding: 12px;
  font-family: var(--mono);
  font-size: 13px;
  line-height: 1.6;
  outline: none;
  white-space: pre;
}
.code-input:focus {
  border-color: var(--primary);
}
.code-preview {
  flex: 1;
  overflow: auto;
  background: #16161e;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
}
.code-preview pre {
  font-family: var(--mono);
  font-size: 12.5px;
  line-height: 1.6;
}
</style>
