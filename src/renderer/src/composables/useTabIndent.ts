import { nextTick } from 'vue'

/**
 * textarea Tab 键缩进（笔记 Markdown 编辑器与模板代码编辑器共用）。
 * - 无选区：在光标处插入缩进符（indent 参数：'\t' 或 N 个空格，来自设置）
 * - 有选区：每行行首插入缩进符
 * 自动恢复光标/选区位置，不影响 v-model 的自动保存联动。
 */
export function tabIndentHandler(
  e: KeyboardEvent,
  get: () => string,
  set: (v: string) => void,
  indent: string
): void {
  if (e.key !== 'Tab') return
  e.preventDefault()
  const el = e.target as HTMLTextAreaElement
  const start = el.selectionStart ?? 0
  const end = el.selectionEnd ?? 0
  const value = get()

  if (start === end) {
    const next = value.slice(0, start) + indent + value.slice(end)
    set(next)
    void nextTick(() => {
      el.selectionStart = el.selectionEnd = start + indent.length
    })
  } else {
    const sel = value.slice(start, end)
    const indented = sel
      .split('\n')
      .map((line) => indent + line)
      .join('\n')
    const next = value.slice(0, start) + indented + value.slice(end)
    set(next)
    void nextTick(() => {
      el.selectionStart = start
      el.selectionEnd = start + indented.length
    })
  }
}

/** 由设置值（'tab' | '2' | '4' | '8'）解析实际缩进字符串 */
export function resolveIndent(setting: string | undefined): string {
  switch (setting) {
    case '2':
      return '  '
    case '4':
      return '    '
    case '8':
      return '        '
    default:
      return '\t'
  }
}
