<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js'
import 'highlight.js/styles/github-dark.css'
import { invoke } from '@/api/ipc'
import { useToast } from '@/composables/useToast'
import { tabIndentHandler, resolveIndent } from '@/composables/useTabIndent'
import { IpcChannels } from '@shared/channels'
import type { Note, PracticeRecord } from '@shared/types'

const md = new MarkdownIt({
  html: false,
  linkify: true,
  highlight: (str, lang) => {
    if (lang && hljs.getLanguage(lang)) {
      return `<pre class="hljs"><code>${hljs.highlight(str, { language: lang }).value}</code></pre>`
    }
    return `<pre class="hljs"><code>${hljs.highlightAuto(str).value}</code></pre>`
  }
})

const route = useRoute()
const router = useRouter()
const toast = useToast()

type Tab = 'notes' | 'mistakes'
const activeTab = ref<Tab>('notes')
const keyword = ref('')
const notes = ref<Note[]>([])

// 编辑器状态
const editing = ref(false)
const editor = ref({
  id: null as number | null,
  title: '',
  content: '',
  tags: [] as string[],
  problemId: null as string | null
})
const tagInput = ref('')
const previewHtml = ref('')
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null
/** v1.8.1：本次编辑会话中由自动保存首次创建的笔记 id（「取消」时回收，避免留下空笔记） */
const autoCreatedId = ref<number | null>(null)
const autoSaveMs = ref(2000)
const indent = ref('\t')

// 错题列表
const mistakes = ref<(PracticeRecord & { problemName?: string })[]>([])

const filteredNotes = computed(() => {
  if (!keyword.value) return notes.value
  const kw = keyword.value.toLowerCase()
  return notes.value.filter(
    (n) =>
      n.title.toLowerCase().includes(kw) ||
      n.content.toLowerCase().includes(kw) ||
      n.tags.some((t) => t.toLowerCase().includes(kw))
  )
})

async function loadNotes(): Promise<void> {
  notes.value = await invoke<Note[]>(IpcChannels.NotesList, {})
}

async function loadMistakes(): Promise<void> {
  const r = await invoke<{ total: number; items: PracticeRecord[] }>(IpcChannels.RecordsList, {
    mistakeOnly: true,
    page: 1,
    pageSize: 200
  })
  const withNames = await Promise.all(
    r.items.map(async (rec) => {
      try {
        const p = await invoke<{ name: string } | null>(IpcChannels.ProblemsGet, { id: rec.problemId })
        return { ...rec, problemName: p?.name }
      } catch {
        return rec
      }
    })
  )
  mistakes.value = withNames
}

/** 取消错题标记（保留练习记录） */
async function untagMistake(m: PracticeRecord): Promise<void> {
  try {
    await invoke(IpcChannels.RecordsUpdate, { id: m.id, isMistake: false })
    toast.success('已取消错题标记')
    await loadMistakes()
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  }
}

/** 手动删除错题记录 */
async function removeMistake(m: PracticeRecord): Promise<void> {
  if (!confirm(`删除这条练习记录（${m.problemId}，${m.createdAt.slice(0, 10)}）？`)) return
  try {
    await invoke(IpcChannels.RecordsDelete, { id: m.id })
    toast.success('记录已删除')
    await loadMistakes()
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  }
}

function startCreate(): void {
  autoCreatedId.value = null
  const problemId = (route.query.problemId as string) || null
  editor.value = { id: null, title: '', content: '', tags: [], problemId }
  previewHtml.value = ''
  editing.value = true
}

async function startEdit(n: Note): Promise<void> {
  autoCreatedId.value = null
  const full = await invoke<Note>(IpcChannels.NotesGet, { id: n.id })
  editor.value = {
    id: full.id,
    title: full.title,
    content: full.content,
    tags: full.tags,
    problemId: full.problemId
  }
  previewHtml.value = md.render(full.content)
  editing.value = true
}

function renderPreview(): void {
  previewHtml.value = md.render(editor.value.content)
}

async function save(): Promise<void> {
  if (!editor.value.title.trim()) {
    toast.error('请填写标题')
    return
  }
  try {
    if (editor.value.id == null) {
      await invoke<Note>(IpcChannels.NotesCreate, {
        title: editor.value.title,
        content: editor.value.content,
        tags: [...editor.value.tags],
        problemId: editor.value.problemId
      })
      toast.success('笔记已创建')
    } else {
      await invoke<Note>(IpcChannels.NotesUpdate, {
        id: editor.value.id,
        title: editor.value.title,
        content: editor.value.content,
        tags: [...editor.value.tags]
      })
      toast.success('笔记已保存')
    }
    editing.value = false
    autoCreatedId.value = null
    await loadNotes()
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  }
}

async function removeNote(n: Note): Promise<void> {
  if (!confirm(`删除笔记「${n.title}」？`)) return
  try {
    await invoke(IpcChannels.NotesDelete, { id: n.id })
    toast.success('已删除')
    await loadNotes()
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  }
}

async function cancelEdit(): Promise<void> {
  editing.value = false
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer)
    autoSaveTimer = null
  }
  // v1.8.1：若本次编辑中曾自动创建笔记，取消时删除它（避免留下空笔记）
  if (autoCreatedId.value != null) {
    const id = autoCreatedId.value
    autoCreatedId.value = null
    try {
      await invoke(IpcChannels.NotesDelete, { id })
      await loadNotes()
    } catch {
      // 取消失败不打断用户操作
    }
  }
}

function addTag(): void {
  // 去除逗号，避免与存储分隔符冲突
  const t = tagInput.value.trim().replace(/[,，]/g, '')
  if (t && !editor.value.tags.includes(t)) editor.value.tags.push(t)
  tagInput.value = ''
}

watch(
  () => editor.value.content,
  () => {
    renderPreview()
    if (!editing.value) return
    if (autoSaveTimer) clearTimeout(autoSaveTimer)
    autoSaveTimer = setTimeout(() => {
      if (!editing.value) return
      const title = editor.value.title.trim()
      if (!title) return
      if (editor.value.id == null) {
        // v1.8.1：新建笔记在首次自动保存时即落库（此前仅对已存在笔记生效，直接关闭会丢内容）
        const payload = {
          title,
          content: editor.value.content,
          tags: [...editor.value.tags],
          problemId: editor.value.problemId
        }
        void invoke<Note>(IpcChannels.NotesCreate, payload)
          .then((created) => {
            if (editing.value && editor.value.id == null) {
              editor.value.id = created.id
              autoCreatedId.value = created.id
              void loadNotes()
            }
          })
          .catch(() => undefined)
      } else {
        void invoke(IpcChannels.NotesUpdate, {
          id: editor.value.id,
          title,
          content: editor.value.content,
          tags: [...editor.value.tags]
        }).catch(() => undefined)
      }
    }, autoSaveMs.value)
  }
)

onMounted(async () => {
  void loadNotes()
  void loadMistakes()
  // 读取设置（FR-7.1）：自动保存间隔 500–600000、Tab 缩进宽度
  try {
    const settings = await invoke<Record<string, string>>(IpcChannels.SettingsGetAll)
    const ms = Number(settings.noteAutoSaveMs)
    if (Number.isFinite(ms) && ms >= 500 && ms <= 600000) autoSaveMs.value = ms
    indent.value = resolveIndent(settings.editorIndent)
  } catch {
    // 读取失败用默认值
  }
  // 从题库页带 problemId 跳转时直接进入新建
  if (route.query.problemId) startCreate()
})

onBeforeUnmount(() => {
  if (autoSaveTimer) clearTimeout(autoSaveTimer)
})
</script>

<template>
  <div class="notes-page">
    <div class="toolbar">
      <div class="tabs">
        <button class="tab" :class="{ on: activeTab === 'notes' }" @click="activeTab = 'notes'">
          笔记（{{ notes.length }}）
        </button>
        <button class="tab" :class="{ on: activeTab === 'mistakes' }" @click="activeTab = 'mistakes'">
          错题（{{ mistakes.length }}）
        </button>
      </div>
      <div class="toolbar-right">
        <input v-model="keyword" class="input" placeholder="搜索标题 / 内容 / 标签" />
        <button class="btn primary" @click="startCreate()">＋ 新建笔记</button>
      </div>
    </div>

    <!-- 错题 Tab -->
    <div v-if="activeTab === 'mistakes'" class="mistake-list">
      <div v-if="mistakes.length === 0" class="empty">还没有错题记录。在题库页记录练习时勾选「标记为错题」即可收集到此处。</div>
      <div v-for="m in mistakes" :key="m.id" class="mistake-item">
        <span class="mono badge" :class="{ bad: m.status !== 'AC' }">{{ m.status }}</span>
        <div class="mistake-body">
          <div class="mono">{{ m.problemId }} <span class="dim">{{ m.problemName }}</span></div>
          <div class="dim small">{{ m.createdAt.slice(0, 16) }}<span v-if="m.note"> · {{ m.note }}</span></div>
        </div>
        <button class="btn xs ghost" @click="router.push({ path: '/problems', query: { q: m.problemId } })">去题库</button>
        <button class="btn xs ghost" @click="untagMistake(m)">取消标记</button>
        <button class="btn xs ghost danger" @click="removeMistake(m)">删除</button>
      </div>
    </div>

    <!-- 笔记列表 -->
    <div v-else-if="!editing" class="note-list">
      <div v-if="filteredNotes.length === 0" class="empty">暂无笔记。点击「＋ 新建笔记」开始记录题解与思路。</div>
      <div v-for="n in filteredNotes" :key="n.id" class="note-item" @click="startEdit(n)">
        <div class="note-title">
          {{ n.title }}
          <span v-if="n.problemId" class="mini-tag mono">{{ n.problemId }}</span>
        </div>
        <div class="note-meta">
          <span v-for="t in n.tags" :key="t" class="mini-tag">{{ t }}</span>
          <span class="dim">更新于 {{ n.updatedAt.slice(0, 16) }}</span>
          <button class="btn xs ghost danger" @click.stop="removeNote(n)">删除</button>
        </div>
      </div>
    </div>

    <!-- 编辑器 -->
    <div v-else class="editor">
      <div class="editor-toolbar">
        <input v-model="editor.title" class="input title-input" placeholder="笔记标题" />
        <div class="tag-edit">
          <input v-model="tagInput" class="input" placeholder="标签，回车添加" @keyup.enter="addTag" @blur="addTag" />
          <span v-for="t in editor.tags" :key="t" class="mini-tag" @click="editor.tags = editor.tags.filter((x) => x !== t)">
            {{ t }} ✕
          </span>
        </div>
        <span v-if="editor.problemId" class="mini-tag mono">关联题目: {{ editor.problemId }}</span>
        <div class="spacer" />
        <button class="btn ghost" @click="cancelEdit()">取消</button>
        <button class="btn primary" @click="save()">保存</button>
      </div>
      <div class="editor-body">
        <textarea
          v-model="editor.content"
          class="md-input"
          spellcheck="false"
          placeholder="支持 Markdown 语法，例如：&#10;## 思路&#10;```cpp&#10;// 代码&#10;```"
          @keydown="tabIndentHandler($event, () => editor.content, (v) => (editor.content = v), indent)"
        ></textarea>
        <div class="preview" v-html="previewHtml" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.notes-page {
  padding: 16px 20px;
}
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
  gap: 10px;
  flex-wrap: wrap;
}
.tabs {
  display: flex;
  gap: 6px;
}
.tab {
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-dim);
  border-radius: 8px;
  padding: 8px 16px;
  font-size: 13px;
  cursor: pointer;
}
.tab.on {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}
.toolbar-right {
  display: flex;
  gap: 8px;
  align-items: center;
}
.input {
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 6px;
  padding: 7px 10px;
  font-size: 13px;
  outline: none;
}
.input:focus {
  border-color: var(--primary);
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
.note-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.note-item {
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: 10px;
  padding: 12px 16px;
  cursor: pointer;
}
.note-item:hover {
  border-color: var(--primary);
}
.note-title {
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
}
.note-meta {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 6px;
  font-size: 12px;
}
.mini-tag {
  font-size: 11px;
  color: var(--text-dim);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 2px 8px;
  cursor: default;
}
.mistake-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.mistake-item {
  display: flex;
  align-items: center;
  gap: 12px;
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: 10px;
  padding: 10px 14px;
}
.badge {
  font-weight: 700;
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 5px;
  background: var(--success);
  color: #fff;
}
.badge.bad {
  background: var(--danger);
}
.mistake-body {
  flex: 1;
}
.small {
  font-size: 12px;
}
.empty {
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
  flex-wrap: wrap;
}
.title-input {
  min-width: 240px;
}
.tag-edit {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}
.spacer {
  flex: 1;
}
.editor-body {
  display: flex;
  gap: 10px;
  flex: 1;
  min-height: 0;
}
.md-input {
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
}
.md-input:focus {
  border-color: var(--primary);
}
.preview {
  flex: 1;
  overflow-y: auto;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 16px;
  line-height: 1.7;
}
.preview :deep(h1),
.preview :deep(h2),
.preview :deep(h3) {
  margin: 10px 0 6px;
}
.preview :deep(p) {
  margin: 6px 0;
}
.preview :deep(pre) {
  background: #16161e;
  border-radius: 6px;
  padding: 10px;
  overflow-x: auto;
  margin: 8px 0;
}
.preview :deep(code) {
  font-family: var(--mono);
  font-size: 12.5px;
}
.preview :deep(a) {
  color: var(--primary);
}
</style>
